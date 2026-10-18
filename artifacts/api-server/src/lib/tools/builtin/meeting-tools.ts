import { z } from "zod/v4";
import { db, meetingsTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { MeetingCreateArgs } from "./types";
import { safeDate } from "./date";

const meetingCreateTool: Tool = {
  name: "meeting.create",
  description: "Schedule a meeting or call. Use when the founder wants to book time, set up a catch-up, or log a meeting with someone.",
  parametersDescription:
    '{ "title": string (required), "attendee"?: string, "scheduledAt"?: string (ISO datetime), "location"?: string, "notes"?: string }',
  parameters: z.object({
    title: z.string().min(1),
    attendee: z.string().optional(),
    scheduledAt: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
  }),
  async execute(args) {
    const a = args as MeetingCreateArgs;
    const [created] = await db
      .insert(meetingsTable)
      .values({
        title: a.title,
        attendee: a.attendee ?? null,
        location: a.location ?? null,
        notes: a.notes ?? null,
        ...(a.scheduledAt ? { scheduledAt: safeDate(a.scheduledAt) } : {}),
      })
      .returning();

    await logActivity({
      entityType: "meeting",
      entityId: created.id,
      action: "created",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "meeting.create", title: created.title, attendee: created.attendee },
    });

    const when = created.scheduledAt
      ? ` at ${created.scheduledAt.toLocaleString()}`
      : "";
    const who = created.attendee ? ` with ${created.attendee}` : "";
    return {
      ok: true,
      message: `Meeting scheduled: "${created.title}"${who}${when}.`,
      data: created,
    };
  },
};

toolRegistry.register(meetingCreateTool);
