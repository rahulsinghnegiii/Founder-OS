import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq } from "drizzle-orm";
import { db, agentsTable, departmentsTable } from "@workspace/db";
import { ListAgentsResponse, GetAgentParams, GetAgentResponse } from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";
import { z } from "zod/v4";

const CreateAgentBody = z.object({
  name: z.string(),
  slug: z.string(),
  departmentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(["active","idle","busy","offline","error"]).default("idle"),
  modelTier: z.enum(["lightweight","standard","premium"]).default("standard"),
  capabilities: z.array(z.string()).default([]),
});

const UpdateAgentBody = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  departmentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(["active","idle","busy","offline","error"]).optional(),
  modelTier: z.enum(["lightweight","standard","premium"]).optional(),
  capabilities: z.array(z.string()).optional(),
});

const router = Router();

router.get("/agents", async (_req, res): Promise<void> => {
  const agents = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      slug: agentsTable.slug,
      description: agentsTable.description,
      departmentId: agentsTable.departmentId,
      departmentName: departmentsTable.name,
      status: agentsTable.status,
      modelTier: agentsTable.modelTier,
      capabilities: agentsTable.capabilities,
      lastActiveAt: agentsTable.lastActiveAt,
      createdAt: agentsTable.createdAt,
    })
    .from(agentsTable)
    .leftJoin(departmentsTable, eq(agentsTable.departmentId, departmentsTable.id))
    .orderBy(agentsTable.name);
  res.json(ListAgentsResponse.parse(toJson(agents)));
});

router.get("/agents/:id", async (req, res): Promise<void> => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [agent] = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      slug: agentsTable.slug,
      description: agentsTable.description,
      departmentId: agentsTable.departmentId,
      departmentName: departmentsTable.name,
      status: agentsTable.status,
      modelTier: agentsTable.modelTier,
      capabilities: agentsTable.capabilities,
      lastActiveAt: agentsTable.lastActiveAt,
      createdAt: agentsTable.createdAt,
    })
    .from(agentsTable)
    .leftJoin(departmentsTable, eq(agentsTable.departmentId, departmentsTable.id))
    .where(eq(agentsTable.id, params.data.id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(GetAgentResponse.parse(toJson(agent)));
});

router.post("/agents", async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [agent] = await db.insert(agentsTable).values(parsed.data).returning();
  await logActivity({ entityType: "agent", entityId: agent.id, action: "created", details: { name: agent.name } });
  res.status(201).json(GetAgentResponse.parse(toJson({ ...agent, departmentName: null })));
});

router.patch("/agents/:id", async (req, res): Promise<void> => {
  const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [agent] = await db.update(agentsTable).set(parsed.data).where(eq(agentsTable.id, agentId)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(GetAgentResponse.parse(toJson({ ...agent, departmentName: null })));
});

export default router;
