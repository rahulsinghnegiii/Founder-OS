import { z } from "zod/v4";
import { db, notesTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { NoteCreateArgs } from "./types";

const noteCreateTool: Tool = {
  name: "note.create",
  description: "Capture a note or memory. Use when the founder wants to remember something, jot down context, or attach a note to an entity.",
  parametersDescription:
    '{ "content": string (required), "title"?: string, "entityType"?: string, "entityId"?: string }',
  parameters: z.object({
    content: z.string().min(1),
    title: z.string().optional(),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
  }),
  async execute(args) {
    const a = args as NoteCreateArgs;
    const [created] = await db
      .insert(notesTable)
      .values({
        content: a.content,
        title: a.title ?? null,
        entityType: a.entityType ?? null,
        entityId: a.entityId ?? null,
      })
      .returning();

    await logActivity({
      entityType: "note",
      entityId: created.id,
      action: "created",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "note.create", title: created.title },
    });

    return {
      ok: true,
      message: `Saved your note${created.title ? ` "${created.title}"` : ""}.`,
      data: created,
    };
  },
};

toolRegistry.register(noteCreateTool);
