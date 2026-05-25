import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db, leadsTable } from "@workspace/db";
import {
  ListLeadsResponse,
  ListLeadsQueryParams,
  CreateLeadBody,
  GetLeadParams,
  GetLeadResponse,
  UpdateLeadParams,
  UpdateLeadBody,
  UpdateLeadResponse,
  DeleteLeadParams,
  GetLeadPipelineResponse,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";

const router = Router();

const PIPELINE_STAGES = [
  { status: "new", label: "New" },
  { status: "contacted", label: "Contacted" },
  { status: "qualified", label: "Qualified" },
  { status: "proposal", label: "Proposal Sent" },
  { status: "won", label: "Won" },
  { status: "lost", label: "Lost" },
];

router.get("/leads", async (req, res): Promise<void> => {
  const query = ListLeadsQueryParams.safeParse(req.query);
  const conditions = [isNull(leadsTable.deletedAt)];
  if (query.success && query.data.status) conditions.push(eq(leadsTable.status, query.data.status));
  const leads = await db.select().from(leadsTable).where(and(...conditions)).orderBy(leadsTable.createdAt);
  res.json(ListLeadsResponse.parse(toJson(leads.map((l) => ({ ...l, estimatedValue: l.estimatedValue ? Number(l.estimatedValue) : null })))));
});

router.post("/leads", async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const insertData = { ...parsed.data, estimatedValue: parsed.data.estimatedValue != null ? String(parsed.data.estimatedValue) : undefined };
  const [lead] = await db.insert(leadsTable).values(insertData).returning();
  await logActivity({ entityType: "lead", entityId: lead.id, action: "created", details: { name: lead.name } });
  res.status(201).json(GetLeadResponse.parse(toJson({ ...lead, estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null })));
});

router.get("/leads/pipeline", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      status: leadsTable.status,
      count: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${leadsTable.estimatedValue}), 0)::float`,
    })
    .from(leadsTable)
    .where(isNull(leadsTable.deletedAt))
    .groupBy(leadsTable.status);

  const map: Record<string, { count: number; value: number }> = {};
  let totalLeads = 0;
  let totalValue = 0;
  for (const r of rows) {
    map[r.status] = { count: r.count, value: r.value };
    totalLeads += r.count;
    totalValue += r.value;
  }

  const stages = PIPELINE_STAGES.map((s) => ({
    status: s.status,
    label: s.label,
    count: map[s.status]?.count ?? 0,
    value: map[s.status]?.value ?? 0,
  }));

  res.json(GetLeadPipelineResponse.parse(toJson({ totalLeads, totalValue, stages })));
});

router.get("/leads/:id", async (req, res): Promise<void> => {
  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!lead || lead.deletedAt) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(GetLeadResponse.parse(toJson({ ...lead, estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null })));
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const params = UpdateLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData = { ...parsed.data, estimatedValue: parsed.data.estimatedValue != null ? String(parsed.data.estimatedValue) : undefined };
  const [lead] = await db.update(leadsTable).set(updateData).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  await logActivity({ entityType: "lead", entityId: lead.id, action: "updated", details: { status: lead.status } });
  res.json(UpdateLeadResponse.parse(toJson({ ...lead, estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null })));
});

router.delete("/leads/:id", async (req, res): Promise<void> => {
  const params = DeleteLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.update(leadsTable).set({ deletedAt: new Date() }).where(eq(leadsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
