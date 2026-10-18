import { z } from "zod/v4";
import { db, projectsTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { ProjectCreateArgs } from "./types";

const priorityEnum = z.enum(["low", "medium", "high", "critical"]);
const statusEnum = z.enum(["planning", "active", "on_hold", "completed", "cancelled"]);

const projectCreateTool: Tool = {
  name: "project.create",
  description: "Create a new project/initiative. Use when the founder wants to start a new body of work, launch, or track a goal.",
  parametersDescription:
    '{ "title": string (required), "description"?: string, "priority"?: "low"|"medium"|"high"|"critical", "status"?: "planning"|"active"|"on_hold"|"completed"|"cancelled", "startDate"?: string (ISO date), "dueDate"?: string (ISO date) }',
  parameters: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: priorityEnum.optional(),
    status: statusEnum.optional(),
    startDate: z.string().optional(),
    dueDate: z.string().optional(),
  }),
  async execute(args) {
    const a = args as ProjectCreateArgs;
    const [created] = await db
      .insert(projectsTable)
      .values({
        title: a.title,
        description: a.description ?? null,
        priority: a.priority ?? "medium",
        status: a.status ?? "planning",
        ...(a.startDate ? { startDate: a.startDate } : {}),
        ...(a.dueDate ? { dueDate: a.dueDate } : {}),
      })
      .returning();

    await logActivity({
      entityType: "project",
      entityId: created.id,
      action: "created",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "project.create", title: created.title, priority: created.priority },
    });

    return {
      ok: true,
      message: `Created project "${created.title}" (${created.priority}).`,
      data: created,
    };
  },
};

toolRegistry.register(projectCreateTool);
