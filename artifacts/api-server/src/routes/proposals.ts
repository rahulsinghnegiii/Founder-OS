import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, and } from "drizzle-orm";
import { db, proposalsTable, leadsTable } from "@workspace/db";
import {
  ListProposalsResponse,
  ListProposalsQueryParams,
  CreateProposalBody,
  GetProposalParams,
  GetProposalResponse,
  UpdateProposalParams,
  UpdateProposalBody,
  UpdateProposalResponse,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";
import { eventBus } from "../lib/event-bus";

const router = Router();

router.get("/proposals", async (req, res): Promise<void> => {
  const query = ListProposalsQueryParams.safeParse(req.query);
  const rows = await db
    .select({
      id: proposalsTable.id,
      leadId: proposalsTable.leadId,
      leadName: leadsTable.name,
      title: proposalsTable.title,
      status: proposalsTable.status,
      value: proposalsTable.value,
      content: proposalsTable.content,
      sentAt: proposalsTable.sentAt,
      responseAt: proposalsTable.responseAt,
      createdAt: proposalsTable.createdAt,
      updatedAt: proposalsTable.updatedAt,
    })
    .from(proposalsTable)
    .leftJoin(leadsTable, eq(proposalsTable.leadId, leadsTable.id))
    .orderBy(proposalsTable.createdAt);
  const filtered = rows.filter((r) => {
    if (query.success && query.data.status && r.status !== query.data.status) return false;
    if (query.success && query.data.leadId && r.leadId !== query.data.leadId) return false;
    return true;
  });
  res.json(ListProposalsResponse.parse(toJson(filtered.map((r) => ({ ...r, value: r.value ? Number(r.value) : null })))));
});

router.post("/proposals", async (req, res): Promise<void> => {
  const parsed = CreateProposalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const insertData = { ...parsed.data, value: parsed.data.value != null ? String(parsed.data.value) : undefined };
  const [proposal] = await db.insert(proposalsTable).values(insertData).returning();
  if (proposal.status === "sent") {
    eventBus.emit("proposal.sent", { proposalId: proposal.id, leadId: proposal.leadId });
  }
  await logActivity({ entityType: "proposal", entityId: proposal.id, action: "created", details: { title: proposal.title } });
  res.status(201).json(GetProposalResponse.parse(toJson({ ...proposal, leadName: null, value: proposal.value ? Number(proposal.value) : null })));
});

router.get("/proposals/:id", async (req, res): Promise<void> => {
  const params = GetProposalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db
    .select({ id: proposalsTable.id, leadId: proposalsTable.leadId, leadName: leadsTable.name, title: proposalsTable.title, status: proposalsTable.status, value: proposalsTable.value, content: proposalsTable.content, sentAt: proposalsTable.sentAt, responseAt: proposalsTable.responseAt, createdAt: proposalsTable.createdAt, updatedAt: proposalsTable.updatedAt })
    .from(proposalsTable).leftJoin(leadsTable, eq(proposalsTable.leadId, leadsTable.id)).where(eq(proposalsTable.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Proposal not found" }); return; }
  res.json(GetProposalResponse.parse(toJson({ ...row, value: row.value ? Number(row.value) : null })));
});

router.patch("/proposals/:id", async (req, res): Promise<void> => {
  const params = UpdateProposalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateProposalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData = {
    ...parsed.data,
    value: parsed.data.value != null ? String(parsed.data.value) : undefined,
    sentAt: parsed.data.sentAt ? new Date(parsed.data.sentAt) : undefined,
    responseAt: parsed.data.responseAt ? new Date(parsed.data.responseAt) : undefined,
  };
  const [proposal] = await db.update(proposalsTable).set(updateData).where(eq(proposalsTable.id, params.data.id)).returning();
  if (!proposal) { res.status(404).json({ error: "Proposal not found" }); return; }
  if (parsed.data.status === "sent") {
    eventBus.emit("proposal.sent", { proposalId: proposal.id, leadId: proposal.leadId });
  }
  res.json(UpdateProposalResponse.parse(toJson({ ...proposal, leadName: null, value: proposal.value ? Number(proposal.value) : null })));
});

export default router;
