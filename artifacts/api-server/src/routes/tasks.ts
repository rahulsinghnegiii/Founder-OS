import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, and, isNull } from "drizzle-orm";
import { db, tasksTable, projectsTable } from "@workspace/db";
import {
  ListTasksResponse,
  ListTasksQueryParams,
  CreateTaskBody,
  GetTaskParams,
  GetTaskResponse,
  UpdateTaskParams,
  UpdateTaskBody,
  UpdateTaskResponse,
  DeleteTaskParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";

const router = Router();

router.get("/tasks", async (req, res): Promise<void> => {
  const query = ListTasksQueryParams.safeParse(req.query);
  const conditions = [isNull(tasksTable.deletedAt)];
  if (query.success && query.data.status) conditions.push(eq(tasksTable.status, query.data.status));
  if (query.success && query.data.priority) conditions.push(eq(tasksTable.priority, query.data.priority));
  if (query.success && query.data.projectId) conditions.push(eq(tasksTable.projectId, query.data.projectId));

  const rows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      projectId: tasksTable.projectId,
      projectTitle: projectsTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
      dueDate: tasksTable.dueDate,
      completedAt: tasksTable.completedAt,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
    })
    .from(tasksTable)
    .leftJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(tasksTable.createdAt);

  res.json(ListTasksResponse.parse(toJson(rows)));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const insertData = { ...parsed.data, dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined };
  const [task] = await db.insert(tasksTable).values(insertData).returning();
  await logActivity({ entityType: "task", entityId: task.id, action: "created", details: { title: task.title } });
  res.status(201).json(GetTaskResponse.parse(toJson({ ...task, projectTitle: null })));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      description: tasksTable.description,
      projectId: tasksTable.projectId,
      projectTitle: projectsTable.title,
      status: tasksTable.status,
      priority: tasksTable.priority,
      dueDate: tasksTable.dueDate,
      completedAt: tasksTable.completedAt,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
    })
    .from(tasksTable)
    .leftJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
    .where(eq(tasksTable.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(GetTaskResponse.parse(toJson(row)));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {
    ...parsed.data,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : undefined,
  };
  if (parsed.data.status === "done" && !parsed.data.completedAt) updateData.completedAt = new Date();
  const [task] = await db.update(tasksTable).set(updateData).where(eq(tasksTable.id, params.data.id)).returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  await logActivity({ entityType: "task", entityId: task.id, action: "updated", details: { status: task.status } });
  res.json(UpdateTaskResponse.parse(toJson({ ...task, projectTitle: null })));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.update(tasksTable).set({ deletedAt: new Date() }).where(eq(tasksTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
