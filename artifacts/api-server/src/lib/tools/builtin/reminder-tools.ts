import { z } from "zod/v4";
import { db, remindersTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { ReminderCreateArgs } from "./types";
import { safeDate } from "./date";

const reminderCreateTool: Tool = {
  name: "reminder.create",
  description: "Set a reminder for the founder. Use when the founder says 'remind me', 'set a reminder', or wants to be prompted about something later.",
  parametersDescription:
    '{ "title": string (required), "note"?: string, "dueAt"?: string (ISO datetime) }',
  parameters: z.object({
    title: z.string().min(1),
    note: z.string().optional(),
    dueAt: z.string().optional(),
  }),
  async execute(args) {
    const a = args as ReminderCreateArgs;
    const [created] = await db
      .insert(remindersTable)
      .values({
        title: a.title,
        note: a.note ?? null,
        ...(a.dueAt ? { dueAt: safeDate(a.dueAt) } : {}),
        done: false,
      })
      .returning();

    await logActivity({
      entityType: "reminder",
      entityId: created.id,
      action: "created",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "reminder.create", title: created.title, dueAt: created.dueAt },
    });

    const when = created.dueAt
      ? ` for ${created.dueAt.toLocaleString()}`
      : "";
    return {
      ok: true,
      message: `Reminder set: "${created.title}"${when}.`,
      data: created,
    };
  },
};

toolRegistry.register(reminderCreateTool);
