import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq } from "drizzle-orm";
import { db, opportunitiesTable, leadsTable } from "@workspace/db";
import {
  ListOpportunitiesResponse,
  ListOpportunitiesQueryParams,
  CreateOpportunityBody,
  GetOpportunityParams,
  GetOpportunityResponse,
  UpdateOpportunityParams,
  UpdateOpportunityBody,
  UpdateOpportunityResponse,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";

const router = Router();

const withLead = async (id: string) => {
  const [row] = await db
    .select({ id: opportunitiesTable.id, leadId: opportunitiesTable.leadId, leadName: leadsTable.name, title: opportunitiesTable.title, description: opportunitiesTable.description, status: opportunitiesTable.status, value: opportunitiesTable.value, probability: opportunitiesTable.probability, expectedCloseDate: opportunitiesTable.expectedCloseDate, discoveredByAgentId: opportunitiesTable.discoveredByAgentId, createdAt: opportunitiesTable.createdAt, updatedAt: opportunitiesTable.updatedAt })
    .from(opportunitiesTable).leftJoin(leadsTable, eq(opportunitiesTable.leadId, leadsTable.id)).where(eq(opportunitiesTable.id, id));
  return row ? { ...row, value: row.value ? Number(row.value) : null } : null;
};

router.get("/opportunities", async (req, res): Promise<void> => {
  const query = ListOpportunitiesQueryParams.safeParse(req.query);
  const rows = await db
    .select({ id: opportunitiesTable.id, leadId: opportunitiesTable.leadId, leadName: leadsTable.name, title: opportunitiesTable.title, description: opportunitiesTable.description, status: opportunitiesTable.status, value: opportunitiesTable.value, probability: opportunitiesTable.probability, expectedCloseDate: opportunitiesTable.expectedCloseDate, discoveredByAgentId: opportunitiesTable.discoveredByAgentId, createdAt: opportunitiesTable.createdAt, updatedAt: opportunitiesTable.updatedAt })
    .from(opportunitiesTable).leftJoin(leadsTable, eq(opportunitiesTable.leadId, leadsTable.id)).orderBy(opportunitiesTable.createdAt);
  const filtered = rows.filter((r) => !query.success || !query.data.status || r.status === query.data.status);
  res.json(ListOpportunitiesResponse.parse(toJson(filtered.map((r) => ({ ...r, value: r.value ? Number(r.value) : null })))));
});

router.post("/opportunities", async (req, res): Promise<void> => {
  const parsed = CreateOpportunityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const insertData = { ...parsed.data, value: parsed.data.value != null ? String(parsed.data.value) : undefined };
  const [opp] = await db.insert(opportunitiesTable).values(insertData).returning();
  await logActivity({ entityType: "opportunity", entityId: opp.id, action: "created", details: { title: opp.title } });
  res.status(201).json(GetOpportunityResponse.parse(toJson({ ...opp, leadName: null, value: opp.value ? Number(opp.value) : null })));
});

router.get("/opportunities/:id", async (req, res): Promise<void> => {
  const params = GetOpportunityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const row = await withLead(params.data.id);
  if (!row) { res.status(404).json({ error: "Opportunity not found" }); return; }
  res.json(GetOpportunityResponse.parse(toJson(row)));
});

router.patch("/opportunities/:id", async (req, res): Promise<void> => {
  const params = UpdateOpportunityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateOpportunityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData = { ...parsed.data, value: parsed.data.value != null ? String(parsed.data.value) : undefined };
  const [opp] = await db.update(opportunitiesTable).set(updateData).where(eq(opportunitiesTable.id, params.data.id)).returning();
  if (!opp) { res.status(404).json({ error: "Opportunity not found" }); return; }
  res.json(UpdateOpportunityResponse.parse(toJson({ ...opp, leadName: null, value: opp.value ? Number(opp.value) : null })));
});

export default router;
