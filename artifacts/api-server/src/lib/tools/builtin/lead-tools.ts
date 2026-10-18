import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, leadsTable } from "@workspace/db";
import { logActivity } from "../../activity-logger";
import { publishOperationalEvent } from "../../event-bus";
import { toolRegistry } from "../registry";
import type { Tool } from "../types";
import type { LeadCreateArgs, LeadUpdateArgs } from "./types";

const statusEnum = z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"]);

const leadCreateTool: Tool = {
  name: "lead.create",
  description: "Capture a new lead/prospect in the CRM. Use when the founder meets someone, gets a referral, or wants to track a potential customer.",
  parametersDescription:
    '{ "name": string (required), "company"?: string, "email"?: string, "phone"?: string, "source"?: string, "estimatedValue"?: number, "notes"?: string }',
  parameters: z.object({
    name: z.string().min(1),
    company: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    source: z.string().optional(),
    estimatedValue: z.coerce.number().optional(),
    notes: z.string().optional(),
  }),
  async execute(args) {
    const a = args as LeadCreateArgs;
    const [created] = await db
      .insert(leadsTable)
      .values({
        name: a.name,
        company: a.company ?? null,
        email: a.email ?? null,
        phone: a.phone ?? null,
        source: a.source ?? null,
        notes: a.notes ?? null,
        ...(a.estimatedValue != null ? { estimatedValue: String(a.estimatedValue) } : {}),
        status: "new",
      })
      .returning();

    await logActivity({
      entityType: "lead",
      entityId: created.id,
      action: "created",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "lead.create", name: created.name, company: created.company },
    });
    publishOperationalEvent("lead.created", { leadId: created.id, name: created.name, company: created.company });

    const bits = [created.company, created.email].filter(Boolean).join(" · ");
    return {
      ok: true,
      message: `Added lead "${created.name}"${bits ? ` (${bits})` : ""} to the CRM.`,
      data: created,
    };
  },
};

const leadUpdateTool: Tool = {
  name: "lead.update",
  description: "Update an existing lead, e.g. move it to 'qualified' or 'won', set a score, or attach notes. Identify the lead by id or name.",
  parametersDescription:
    '{ "id"?: string, "name"?: string (current name), "status"?: "new"|"contacted"|"qualified"|"proposal"|"won"|"lost", "score"?: number, "notes"?: string }',
  parameters: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    status: statusEnum.optional(),
    score: z.number().optional(),
    notes: z.string().optional(),
  }),
  async execute(args) {
    const a = args as LeadUpdateArgs;
    if (!a.id && !a.name) {
      return { ok: false, message: "Provide either 'id' or 'name' to identify the lead." };
    }

    const [lead] = a.id
      ? await db.select().from(leadsTable).where(eq(leadsTable.id, a.id)).limit(1)
      : await db.select().from(leadsTable).where(eq(leadsTable.name, a.name!)).limit(1);

    if (!lead) {
      return { ok: false, message: `Lead not found.` };
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (a.status) patch.status = a.status;
    if (a.score != null) patch.score = a.score;
    if (a.notes != null) patch.notes = a.notes;

    const [updated] = await db
      .update(leadsTable)
      .set(patch)
      .where(eq(leadsTable.id, lead.id))
      .returning();

    await logActivity({
      entityType: "lead",
      entityId: updated.id,
      action: "updated",
      actorType: "system",
      actorName: "Command Executor",
      details: { tool: "lead.update", status: updated.status, score: updated.score },
    });

    const statusNote = a.status ? ` → ${updated.status}` : "";
    return {
      ok: true,
      message: `Updated lead "${updated.name}"${statusNote}.`,
      data: updated,
    };
  },
};

toolRegistry.register(leadCreateTool);
toolRegistry.register(leadUpdateTool);
