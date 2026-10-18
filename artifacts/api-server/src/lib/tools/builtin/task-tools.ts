import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, tasksTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { TaskCreateArgs, TaskDeleteArgs, TaskUpdateArgs } from "./types";
import { safeDate } from "./date";

const priorityEnum = z.enum(["low", "medium", "high", "critical"]);
const statusEnum = z.enum(["todo", "in_progress", "review", "done", "cancelled"]);

const taskCreateTool: Tool = {
  name: "task.create",
  description: "Create a new task. Optionally attach it to a project and set priority/status/due date.",
  parametersDescription:
    '{ "title": string (required), "description"?: string, "priority"?: "low"|"medium"|"high"|"critical", "status"?: "todo"|"in_progress"|"review"|"done"|"cancelled", "projectId"?: string, "dueDate"?: string (ISO date) }',
  parameters: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: priorityEnum.optional(),
    status: statusEnum.optional(),
    projectId: z.string().optional(),
    dueDate: z.string().optional(),
  }),
  async execute(args) {
    const a = args as TaskCreateArgs;
    const [created] = await db
      .insert(tasksTable)
      .values({
        title: a.title,
        priority: a.priority ?? "medium",
        status: a.status ?? "todo",
        ...(a.description ? { description: a.description } : {}),
        ...(a.projectId ? { projectId: a.projectId } : {}),
        ...(a.dueDate ? { dueDate: safeDate(a.dueDate) } : {}),
      })
      .returning();

    await logActivity({
      entityType: "task",
      entityId: created.id,
      action: "created",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "task.create", title: created.title, priority: created.priority },
    });

    return {
      ok: true,
      message: `Created task "${created.title}" (${created.priority}).`,
      data: created,
    };
  },
};

const taskUpdateTool: Tool = {
  name: "task.update",
  description: "Update an existing task: change status, priority, title, description, or due date. Identify by id.",
  parametersDescription:
    '{ "id": string (required), "status"?: "todo"|"in_progress"|"review"|"done"|"cancelled", "priority"?: "low"|"medium"|"high"|"critical", "title"?: string, "dueDate"?: string (ISO date) }',
  parameters: z.object({
    id: z.string().min(1),
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
    title: z.string().optional(),
    dueDate: z.string().optional(),
  }),
  async execute(args) {
    const a = args as TaskUpdateArgs;
    const [existing] = await db
      .select({ id: tasksTable.id, title: tasksTable.title })
      .from(tasksTable)
      .where(eq(tasksTable.id, a.id))
      .limit(1);

    if (!existing) {
      return { ok: false, message: `Task ${a.id} not found.` };
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (a.status) patch.status = a.status;
    if (a.priority) patch.priority = a.priority;
    if (a.title) patch.title = a.title;
    if (a.dueDate) patch.dueDate = safeDate(a.dueDate);

    const [updated] = await db
      .update(tasksTable)
      .set(patch)
      .where(eq(tasksTable.id, a.id))
      .returning();

    await logActivity({
      entityType: "task",
      entityId: a.id,
      action: "updated",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "task.update", status: updated.status, priority: updated.priority },
    });

    return {
      ok: true,
      message: `Updated task "${updated.title}"${a.status ? ` → ${updated.status}` : ""}.`,
      data: updated,
    };
  },
};

const taskDeleteTool: Tool = {
  name: "task.delete",
  description: "Delete a task by its id. Uses a soft delete so references remain intact.",
  parametersDescription: '{ "id": string (required, the task id) }',
  parameters: z.object({
    id: z.string().min(1),
  }),
  async execute(args) {
    const a = args as TaskDeleteArgs;
    const [existing] = await db
      .select({ id: tasksTable.id, title: tasksTable.title })
      .from(tasksTable)
      .where(eq(tasksTable.id, a.id))
      .limit(1);

    if (!existing) {
      return { ok: false, message: `Task ${a.id} not found.` };
    }

    await db
      .update(tasksTable)
      .set({ deletedAt: new Date() })
      .where(eq(tasksTable.id, a.id));

    await logActivity({
      entityType: "task",
      entityId: a.id,
      action: "deleted",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "task.delete", title: existing.title },
    });

    return {
      ok: true,
      message: `Deleted task "${existing.title}".`,
      data: { id: a.id },
    };
  },
};

toolRegistry.register(taskCreateTool);
toolRegistry.register(taskUpdateTool);
toolRegistry.register(taskDeleteTool);
