import { and, desc, eq } from "drizzle-orm";
import { db, executionJobsTable, plansTable, tasksTable, workflowsTable } from "@workspace/db";
import { companyBrain } from "./company-brain";
import { publishOperationalEvent } from "../lib/event-bus";
import { logger } from "../lib/logger";

type ExecutionResult = {
  tasksCreated: number;
  workflowsCreated: number;
  departmentsDelegated: string[];
  remindersCreated: number;
  eventsEmitted: number;
  errors: string[];
};

class ExecutionEngine {
  async executePlan(planId: string): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      tasksCreated: 0,
      workflowsCreated: 0,
      departmentsDelegated: [],
      remindersCreated: 0,
      eventsEmitted: 0,
      errors: [],
    };

    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
    if (!plan) {
      result.errors.push(`Plan ${planId} not found`);
      return result;
    }

    const [job] = await db
      .insert(executionJobsTable)
      .values({
        planId,
        status: "running",
        payload: { goal: plan.goal },
      })
      .returning();

    try {
      // 1. Create tasks from plan phases
      const tasksCreated = await this.createTasksFromPlan(plan);
      result.tasksCreated = tasksCreated;

      // 2. Delegate to departments
      const departments = await this.delegateToDepartments(plan);
      result.departmentsDelegated = departments;

      // 3. Create reminders for key milestones
      const reminders = await this.createReminders(plan);
      result.remindersCreated = reminders;

      // 4. Emit execution events
      await this.emitExecutionEvents(plan, result);
      result.eventsEmitted = 1;

      await db
        .update(executionJobsTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          result,
        })
        .where(eq(executionJobsTable.id, job.id));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      await db
        .update(executionJobsTable)
        .set({ status: "failed", error: message, completedAt: new Date(), result })
        .where(eq(executionJobsTable.id, job.id));
      logger.error({ err, planId }, "Plan execution failed");
      return result;
    }
  }

  private async createTasksFromPlan(plan: typeof plansTable.$inferSelect): Promise<number> {
    const tasks = (plan.phases as any[])?.flatMap((phase: any, phaseIndex: number) =>
      (phase.deliverables || []).map((deliverable: string, i: number) => ({
        title: deliverable,
        description: `Phase ${phaseIndex + 1}: ${phase.name} - ${deliverable}`,
        department: phase.departments?.[i % (phase.departments?.length || 1)] || "Operations",
        priority: phaseIndex === 0 ? "high" : "medium",
        estimatedDays: 2 + phaseIndex,
        dueDate: new Date(Date.now() + (phaseIndex + 1) * 7 * 24 * 60 * 60 * 1000),
        planId: plan.id,
      }))
    ) || [];

    if (tasks.length === 0) return 0;

    const created = await db.insert(tasksTable).values(tasks).returning();
    return created.length;
  }

  private async delegateToDepartments(plan: typeof plansTable.$inferSelect): Promise<string[]> {
    const departments = [...new Set((plan.phases as any[])?.flatMap((p: any) => p.departments || []) || [])];
    const uniqueDepts = [...new Set(departments)];

    for (const dept of uniqueDepts) {
      await companyBrain.remember({
        entityType: "department_delegation",
        entityId: plan.id,
        category: "Delegation",
        key: `delegation:${plan.id}:${dept}`,
        value: `Delegated ${plan.goal} to ${dept}`,
        source: "execution-engine",
        confidence: 0.9,
      });
    }

    return uniqueDepts;
  }

  private async createReminders(plan: typeof plansTable.$inferSelect): Promise<number> {
    const reminders = (plan.phases as any[])?.flatMap((phase: any, i: number) => [
      { title: `Start Phase ${i + 1}: ${phase.name}`, dueDate: new Date(Date.now() + i * 7 * 24 * 60 * 60 * 1000) },
      { title: `Review Phase ${i + 1} progress`, dueDate: new Date(Date.now() + (i + 0.5) * 7 * 24 * 60 * 60 * 1000) },
    ]) || [];

    let created = 0;
    for (const r of reminders) {
      await companyBrain.remember({
        entityType: "reminder",
        entityId: `${plan.id}-reminder-${created}`,
        category: "Reminder",
        key: `reminder:${plan.id}:${created}`,
        value: r.title,
        source: "execution-engine",
      });
      created++;
    }
    return created;
  }

  private async emitExecutionEvents(plan: typeof plansTable.$inferSelect, result: ExecutionResult): Promise<void> {
    publishOperationalEvent("plan.execution.started", {
      planId: plan.id,
      goal: plan.goal,
      tasksCreated: result.tasksCreated,
      departments: result.departmentsDelegated,
    });

    publishOperationalEvent("plan.execution.completed", {
      planId: plan.id,
      goal: plan.goal,
      ...result,
    });
  }

  async getExecutionHistory(planId: string) {
    return db
      .select()
      .from(executionJobsTable)
      .where(eq(executionJobsTable.planId, planId))
      .orderBy(desc(executionJobsTable.createdAt));
  }
}

export const executionEngine = new ExecutionEngine();