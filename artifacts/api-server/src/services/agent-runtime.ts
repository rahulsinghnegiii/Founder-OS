import { and, eq } from "drizzle-orm";
import { db, agentsTable, departmentsTable } from "@workspace/db";
import { logActivity } from "../lib/activity-logger";
import { publishOperationalEvent } from "../lib/event-bus";
import { memoryService } from "./memory-service";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";

export type AgentDelegationTask = {
  department: string;
  objective: string;
  priority: "low" | "medium" | "high" | "urgent";
  context: string;
  memoryContext?: string;
  relatedEntities: Array<{ entityType: string; entityId?: string | null }>;
  trigger: string;
};

export type AgentExecutionResult = {
  department: string;
  agentName: string;
  summary: string;
  worklog: string[];
  nextSteps: string[];
  telemetry: {
    status: "completed" | "idle";
    contextHits: number;
  };
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

abstract class BaseAgent {
  constructor(
    protected readonly department: string,
    protected readonly agentRow: typeof agentsTable.$inferSelect | null,
  ) {}

  protected get agentName(): string {
    return this.agentRow?.name ?? `${this.department} Agent`;
  }

  protected async setLifecycleStatus(status: "busy" | "active" | "idle" | "error"): Promise<void> {
    if (!this.agentRow) return;

    await db.update(agentsTable).set({
      status,
      lastActiveAt: new Date(),
    }).where(eq(agentsTable.id, this.agentRow.id));
  }

  async execute(task: AgentDelegationTask): Promise<AgentExecutionResult> {
    await this.setLifecycleStatus("busy");

    await logActivity({
      entityType: "agent",
      entityId: this.agentRow?.id,
      action: "execution_started",
      actorType: "agent",
      actorName: this.agentName,
      details: {
        department: this.department,
        trigger: task.trigger,
        objective: task.objective,
        priority: task.priority,
      },
    });

    publishOperationalEvent("agent.execution.started", {
      agentId: this.agentRow?.id ?? null,
      agentName: this.agentName,
      department: this.department,
      objective: task.objective,
      priority: task.priority,
    });

    const result = await this.run(task);

    await this.setLifecycleStatus("active");

    await logActivity({
      entityType: "agent",
      entityId: this.agentRow?.id,
      action: "execution_completed",
      actorType: "agent",
      actorName: this.agentName,
      details: {
        department: this.department,
        summary: result.summary,
        nextSteps: result.nextSteps,
      },
    });

    await memoryService.writeActionMemories({
      agentId: this.agentRow?.id ?? null,
      summary: `${this.agentName}: ${result.summary}`,
      relatedEntities: task.relatedEntities,
    });

    await this.setLifecycleStatus("idle");

    publishOperationalEvent("agent.execution.completed", {
      agentId: this.agentRow?.id ?? null,
      agentName: this.agentName,
      department: this.department,
      summary: result.summary,
    });

    return result;
  }

  protected abstract run(task: AgentDelegationTask): Promise<AgentExecutionResult>;
}

class DepartmentAgent extends BaseAgent {
  protected async run(task: AgentDelegationTask): Promise<AgentExecutionResult> {
    const contextHits = task.memoryContext ? task.memoryContext.split("\n").filter(Boolean).length : 0;

    try {
      const result = await callAI(
        [
          {
            role: "system",
            content: `You are the ${this.department} Agent. Respond in JSON only:
{
  "summary": "1 sentence, what you did and why.",
  "worklog": ["1 short step"],
  "nextSteps": ["1 next action"]
}`,
          },
          {
            role: "user",
            content: `Objective: ${task.objective}\nPriority: ${task.priority}\nMemory Context:\n${task.memoryContext ?? "No specific memory context provided."}`,
          },
        ],
        { jsonMode: true },
      );

      const data = JSON.parse(result.reply) as {
        summary: string;
        worklog: string[];
        nextSteps: string[];
      };

      return {
        department: this.department,
        agentName: this.agentName,
        summary: data.summary,
        worklog: data.worklog,
        nextSteps: data.nextSteps,
        telemetry: {
          status: "completed",
          contextHits,
        },
      };
    } catch (err) {
      logger.error({ err }, `Agent ${this.agentName} failed AI execution.`);
      return {
        department: this.department,
        agentName: this.agentName,
        summary: `The ${this.department} Agent processed the request but encountered an internal analysis issue. Execution state remains stable.`,
        worklog: ["Task accepted", "Internal analysis failed", "Falling back to safe state"],
        nextSteps: ["Retry the request", "Check system logs"],
        telemetry: {
          status: "idle",
          contextHits,
        },
      };
    }
  }
}

class AgentRuntime {
  async executeDelegation(task: AgentDelegationTask): Promise<AgentExecutionResult> {
    const departmentSlug = slugify(task.department);
    const [department] = await db.select().from(departmentsTable).where(eq(departmentsTable.slug, departmentSlug)).limit(1);
    const [agent] = department
      ? await db.select().from(agentsTable).where(and(eq(agentsTable.departmentId, department.id), eq(agentsTable.status, "idle"))).limit(1)
      : await db.select().from(agentsTable).where(eq(agentsTable.slug, departmentSlug)).limit(1);

    const runtimeAgent = new DepartmentAgent(task.department, agent ?? null);
    return runtimeAgent.execute(task);
  }
}

export const agentRuntime = new AgentRuntime();
