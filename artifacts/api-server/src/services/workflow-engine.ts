import { and, eq, sql } from "drizzle-orm";
import {
  automationLogsTable,
  db,
  leadsTable,
  reportsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import { logActivity } from "../lib/activity-logger";
import { publishOperationalEvent, eventBus } from "../lib/event-bus";
import { memoryService } from "./memory-service";
import { createOperationalNotification } from "./notification-service";
import { agentRuntime } from "./agent-runtime";

type WorkflowStep = Record<string, unknown> & {
  type?: string;
  action?: string;
  retries?: number;
};

type TriggerPayload = {
  workflowId?: string;
  logId?: string;
  data?: Record<string, unknown>;
};

function getStepType(step: WorkflowStep): string {
  return String(step.type ?? step.action ?? "log_activity");
}

function interpolate(template: unknown, data: Record<string, unknown>): string {
  const source = String(template ?? "");
  return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = data[key];
    return value == null ? "" : String(value);
  });
}

class WorkflowEngine {
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const triggerEvents = [
      "lead.created",
      "lead.won",
      "proposal.sent",
      "project.updated",
      "opportunity.discovered",
      "task.created",
      "task.deleted",
      "department.created",
      "department.renamed",
    ];

    for (const triggerEvent of triggerEvents) {
      eventBus.on(triggerEvent, async (payload) => {
        await this.handleTriggeredEvent(triggerEvent, (payload as TriggerPayload | undefined)?.data ?? (payload as Record<string, unknown> | undefined) ?? {});
      });
    }
  }

  async handleTriggeredEvent(triggerEvent: string, triggerData: Record<string, unknown>): Promise<void> {
    const workflows = await db.select().from(workflowsTable).where(and(eq(workflowsTable.triggerEvent, triggerEvent), eq(workflowsTable.isActive, true)));

    for (const workflow of workflows) {
      await this.executeWorkflow(workflow, triggerData);
    }
  }

  async triggerById(workflowId: string, triggerData: Record<string, unknown>): Promise<typeof automationLogsTable.$inferSelect> {
    const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, workflowId));
    if (!workflow) {
      throw new Error("Workflow not found");
    }

    return this.executeWorkflow(workflow, triggerData);
  }

  private async executeWorkflow(
    workflow: typeof workflowsTable.$inferSelect,
    triggerData: Record<string, unknown>,
  ): Promise<typeof automationLogsTable.$inferSelect> {
    const [log] = await db.insert(automationLogsTable).values({
      workflowId: workflow.id,
      triggerData,
      status: "running",
      startedAt: new Date(),
      stepsExecuted: [],
    }).returning();

    publishOperationalEvent("workflow.execution.started", {
      workflowId: workflow.id,
      logId: log.id,
      triggerEvent: workflow.triggerEvent,
      triggerData,
    });

    await db.update(workflowsTable).set({
      runCount: sql`${workflowsTable.runCount} + 1`,
      lastTriggeredAt: new Date(),
    }).where(eq(workflowsTable.id, workflow.id));

    const steps = Array.isArray(workflow.steps) ? (workflow.steps as WorkflowStep[]) : [];
    const executedSteps: Record<string, unknown>[] = [];

    try {
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const result = await this.executeStepWithRetry(step, {
          workflow,
          triggerData,
          stepIndex: index,
        });
        executedSteps.push(result);
      }

      const [updated] = await db.update(automationLogsTable).set({
        status: "success",
        completedAt: new Date(),
        stepsExecuted: executedSteps,
      }).where(eq(automationLogsTable.id, log.id)).returning();

      await logActivity({
        entityType: "workflow",
        entityId: workflow.id,
        action: "executed",
        actorType: "system",
        actorName: "Workflow Engine",
        details: {
          workflow: workflow.name,
          triggerEvent: workflow.triggerEvent,
          steps: executedSteps.length,
        },
      });

      publishOperationalEvent("workflow.execution.completed", {
        workflowId: workflow.id,
        logId: log.id,
        stepsExecuted: executedSteps,
      });

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown workflow failure";

      const [failed] = await db.update(automationLogsTable).set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: message,
        stepsExecuted: executedSteps,
      }).where(eq(automationLogsTable.id, log.id)).returning();

      await createOperationalNotification({
        type: "alert",
        title: `Workflow failed: ${workflow.name}`,
        body: message,
        priority: "high",
        metadata: {
          workflowId: workflow.id,
          logId: log.id,
        },
      });

      await logActivity({
        entityType: "workflow",
        entityId: workflow.id,
        action: "failed",
        actorType: "system",
        actorName: "Workflow Engine",
        details: {
          workflow: workflow.name,
          error: message,
        },
      });

      publishOperationalEvent("workflow.execution.failed", {
        workflowId: workflow.id,
        logId: log.id,
        error: message,
      });

      return failed;
    }
  }

  private async executeStepWithRetry(
    step: WorkflowStep,
    context: {
      workflow: typeof workflowsTable.$inferSelect;
      triggerData: Record<string, unknown>;
      stepIndex: number;
    },
  ): Promise<Record<string, unknown>> {
    const retries = Number(step.retries ?? 2);
    let attempt = 0;

    while (attempt <= retries) {
      attempt += 1;
      try {
        await this.executeStep(step, context);
        return {
          index: context.stepIndex,
          type: getStepType(step),
          status: "success",
          attempts: attempt,
        };
      } catch (error) {
        if (attempt > retries) {
          throw error;
        }
      }
    }

    return {
      index: context.stepIndex,
      type: getStepType(step),
      status: "unknown",
      attempts: attempt,
    };
  }

  private async executeStep(
    step: WorkflowStep,
    context: {
      workflow: typeof workflowsTable.$inferSelect;
      triggerData: Record<string, unknown>;
      stepIndex: number;
    },
  ): Promise<void> {
    const stepType = getStepType(step);

    switch (stepType) {
      case "notification.create":
      case "create_notification":
        await createOperationalNotification({
          type: String(step.notificationType ?? "info") as "info" | "warning" | "alert" | "success",
          title: interpolate(step.title ?? `${context.workflow.name} executed`, context.triggerData),
          body: interpolate(step.body ?? "", context.triggerData),
          priority: String(step.priority ?? "medium") as "low" | "medium" | "high" | "urgent",
          metadata: {
            workflowId: context.workflow.id,
            stepIndex: context.stepIndex,
            triggerData: context.triggerData,
          },
        });
        return;

      case "activity.log":
      case "log_activity":
        await logActivity({
          entityType: String(step.entityType ?? "workflow"),
          entityId: typeof step.entityId === "string" ? step.entityId : context.workflow.id,
          action: String(step.actionName ?? "workflow_step_executed"),
          actorType: "system",
          actorName: "Workflow Engine",
          details: {
            workflow: context.workflow.name,
            triggerData: context.triggerData,
          },
        });
        return;

      case "memory.write":
      case "write_memory":
        await memoryService.createMemory({
          entityType: String(step.entityType ?? "workflow"),
          entityId: typeof step.entityId === "string" ? step.entityId : context.workflow.id,
          key: String(step.key ?? "short_term:workflow_note"),
          scope: String(step.scope ?? "short_term") as "short_term" | "long_term",
          value: interpolate(step.value ?? JSON.stringify(context.triggerData), context.triggerData),
        });
        return;

      case "lead.update_status":
      case "update_lead_status":
        if (typeof step.leadId !== "string" && typeof context.triggerData.leadId !== "string") {
          throw new Error("Lead update step requires a leadId");
        }
        await db.update(leadsTable).set({
          status: String(step.status ?? "contacted"),
          updatedAt: new Date(),
        }).where(eq(leadsTable.id, String(step.leadId ?? context.triggerData.leadId)));
        return;

      case "task.create":
      case "create_task":
        await db.insert(tasksTable).values({
          projectId: typeof step.projectId === "string" ? step.projectId : null,
          title: interpolate(step.title ?? `${context.workflow.name} follow-up`, context.triggerData),
          description: interpolate(step.description ?? "Generated by workflow engine.", context.triggerData),
          priority: String(step.priority ?? "medium"),
          status: "todo",
        });
        return;

      case "report.create":
      case "create_report":
        await db.insert(reportsTable).values({
          title: interpolate(step.title ?? `${context.workflow.name} Report`, context.triggerData),
          type: String(step.reportType ?? "operational"),
          content: interpolate(step.content ?? JSON.stringify(context.triggerData, null, 2), context.triggerData),
          metadata: {
            workflowId: context.workflow.id,
            triggerData: context.triggerData,
          },
        });
        return;

      case "agent.delegate":
      case "delegate_to_agent":
        const department = String(step.department ?? "Executive Assistant");
        const objective = interpolate(step.objective ?? `Follow up on ${context.workflow.name}`, context.triggerData);
        const memoryContext = await memoryService.buildContextBlock({
          query: objective,
          limit: 4,
        });

        await agentRuntime.executeDelegation({
          department,
          objective,
          priority: String(step.priority ?? "medium") as "low" | "medium" | "high" | "urgent",
          context: `Workflow="${context.workflow.name}". Trigger="${context.workflow.triggerEvent}"`,
          memoryContext,
          relatedEntities: [{ entityType: "workflow", entityId: context.workflow.id }],
          trigger: "workflow_engine",
        });
        return;

      default:
        await logActivity({
          entityType: "workflow",
          entityId: context.workflow.id,
          action: "step_skipped",
          actorType: "system",
          actorName: "Workflow Engine",
          details: {
            workflow: context.workflow.name,
            stepType,
          },
        });
    }
  }
}

export const workflowEngine = new WorkflowEngine();
