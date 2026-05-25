import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq } from "drizzle-orm";
import { db, workflowsTable, automationLogsTable } from "@workspace/db";
import {
  ListWorkflowsResponse,
  CreateWorkflowBody,
  GetWorkflowParams,
  GetWorkflowResponse,
  UpdateWorkflowParams,
  UpdateWorkflowBody,
  UpdateWorkflowResponse,
  DeleteWorkflowParams,
  ListWorkflowLogsParams,
  ListWorkflowLogsResponse,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";
import { eventBus } from "../lib/event-bus";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/workflows", async (_req, res): Promise<void> => {
  const workflows = await db.select().from(workflowsTable).orderBy(workflowsTable.createdAt);
  res.json(ListWorkflowsResponse.parse(toJson(workflows)));
});

router.post("/workflows", async (req, res): Promise<void> => {
  const parsed = CreateWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [wf] = await db.insert(workflowsTable).values(parsed.data).returning();
  res.status(201).json(GetWorkflowResponse.parse(toJson(wf)));
});

router.get("/workflows/:id", async (req, res): Promise<void> => {
  const params = GetWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [wf] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, params.data.id));
  if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(GetWorkflowResponse.parse(toJson(wf)));
});

router.patch("/workflows/:id", async (req, res): Promise<void> => {
  const params = UpdateWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [wf] = await db.update(workflowsTable).set(parsed.data).where(eq(workflowsTable.id, params.data.id)).returning();
  if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(UpdateWorkflowResponse.parse(toJson(wf)));
});

router.delete("/workflows/:id", async (req, res): Promise<void> => {
  const params = DeleteWorkflowParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.delete(workflowsTable).where(eq(workflowsTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/workflows/:id/trigger", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [wf] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, raw));
  if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }

  const [log] = await db.insert(automationLogsTable).values({
    workflowId: wf.id,
    triggerData: req.body?.data ?? {},
    status: "running",
    startedAt: new Date(),
  }).returning();

  await db.update(workflowsTable).set({ runCount: sql`${workflowsTable.runCount} + 1`, lastTriggeredAt: new Date() }).where(eq(workflowsTable.id, wf.id));
  eventBus.emit(wf.triggerEvent, { workflowId: wf.id, logId: log.id, data: req.body?.data });

  const [updated] = await db.update(automationLogsTable).set({ status: "success", completedAt: new Date() }).where(eq(automationLogsTable.id, log.id)).returning();
  await logActivity({ entityType: "workflow", entityId: wf.id, action: "triggered", details: { name: wf.name } });
  res.json(updated);
});

router.get("/workflows/:id/logs", async (req, res): Promise<void> => {
  const params = ListWorkflowLogsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const logs = await db.select().from(automationLogsTable).where(eq(automationLogsTable.workflowId, params.data.id)).orderBy(automationLogsTable.createdAt);
  res.json(ListWorkflowLogsResponse.parse(toJson(logs)));
});

export default router;
