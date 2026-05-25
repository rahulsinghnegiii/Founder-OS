import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq } from "drizzle-orm";
import { db, departmentsTable, agentsTable } from "@workspace/db";
import {
  ListDepartmentsResponse,
  GetDepartmentParams,
  GetDepartmentResponse,
  UpdateDepartmentParams,
  UpdateDepartmentBody,
  UpdateDepartmentResponse,
  CreateDepartmentBody,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";

const router = Router();

router.get("/departments", async (req, res): Promise<void> => {
  const depts = await db.select().from(departmentsTable).orderBy(departmentsTable.name);
  const counts = await db.select({ departmentId: agentsTable.departmentId }).from(agentsTable);
  const countMap: Record<string, number> = {};
  for (const row of counts) {
    if (row.departmentId) countMap[row.departmentId] = (countMap[row.departmentId] ?? 0) + 1;
  }
  const result = depts.map((d) => ({ ...d, agentCount: countMap[d.id] ?? 0 }));
  res.json(ListDepartmentsResponse.parse(toJson(result)));
});

router.post("/departments", async (req, res): Promise<void> => {
  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [dept] = await db.insert(departmentsTable).values(parsed.data).returning();
  await logActivity({ entityType: "department", entityId: dept.id, action: "created", details: { name: dept.name } });
  res.status(201).json(GetDepartmentResponse.parse(toJson({ ...dept, agentCount: 0 })));
});

router.get("/departments/:id", async (req, res): Promise<void> => {
  const params = GetDepartmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, params.data.id));
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  const agents = await db.select().from(agentsTable).where(eq(agentsTable.departmentId, dept.id));
  res.json(GetDepartmentResponse.parse(toJson({ ...dept, agentCount: agents.length })));
});

router.patch("/departments/:id", async (req, res): Promise<void> => {
  const params = UpdateDepartmentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateDepartmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [dept] = await db.update(departmentsTable).set(parsed.data).where(eq(departmentsTable.id, params.data.id)).returning();
  if (!dept) { res.status(404).json({ error: "Department not found" }); return; }
  res.json(UpdateDepartmentResponse.parse(toJson({ ...dept, agentCount: 0 })));
});

export default router;
