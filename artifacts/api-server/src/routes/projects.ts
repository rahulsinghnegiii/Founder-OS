import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, isNull, and, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable } from "@workspace/db";
import {
  ListProjectsResponse,
  ListProjectsQueryParams,
  CreateProjectBody,
  GetProjectParams,
  GetProjectResponse,
  UpdateProjectParams,
  UpdateProjectBody,
  UpdateProjectResponse,
  DeleteProjectParams,
  ListProjectTasksParams,
  ListProjectTasksResponse,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";

const router = Router();

router.get("/projects", async (req, res): Promise<void> => {
  const query = ListProjectsQueryParams.safeParse(req.query);
  const conditions = [isNull(projectsTable.deletedAt)];
  if (query.success && query.data.status) conditions.push(eq(projectsTable.status, query.data.status));
  if (query.success && query.data.priority) conditions.push(eq(projectsTable.priority, query.data.priority));

  const projects = await db.select().from(projectsTable).where(and(...conditions)).orderBy(projectsTable.createdAt);

  const taskCounts = await db
    .select({
      projectId: tasksTable.projectId,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'done')::int`,
    })
    .from(tasksTable)
    .where(isNull(tasksTable.deletedAt))
    .groupBy(tasksTable.projectId);

  const countMap: Record<string, { total: number; completed: number }> = {};
  for (const row of taskCounts) {
    if (row.projectId) countMap[row.projectId] = { total: row.total, completed: row.completed };
  }

  const result = projects.map((p) => ({
    ...p,
    taskCount: countMap[p.id]?.total ?? 0,
    completedTaskCount: countMap[p.id]?.completed ?? 0,
  }));
  res.json(ListProjectsResponse.parse(toJson(result)));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [project] = await db.insert(projectsTable).values(parsed.data).returning();
  await logActivity({ entityType: "project", entityId: project.id, action: "created", details: { title: project.title } });
  res.status(201).json(GetProjectResponse.parse(toJson({ ...project, taskCount: 0, completedTaskCount: 0 })));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project || project.deletedAt) { res.status(404).json({ error: "Project not found" }); return; }
  const tasks = await db.select().from(tasksTable).where(and(eq(tasksTable.projectId, project.id), isNull(tasksTable.deletedAt)));
  const completed = tasks.filter((t) => t.status === "done").length;
  res.json(GetProjectResponse.parse(toJson({ ...project, taskCount: tasks.length, completedTaskCount: completed })));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData = {
    ...parsed.data,
    completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : undefined,
  };
  const [project] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, params.data.id)).returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  await logActivity({ entityType: "project", entityId: project.id, action: "updated", details: { title: project.title, status: project.status } });
  res.json(UpdateProjectResponse.parse(toJson({ ...project, taskCount: 0, completedTaskCount: 0 })));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.update(projectsTable).set({ deletedAt: new Date() }).where(eq(projectsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/projects/:id/tasks", async (req, res): Promise<void> => {
  const params = ListProjectTasksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.projectId, params.data.id), isNull(tasksTable.deletedAt)))
    .orderBy(tasksTable.createdAt);
  const withProject = tasks.map((t) => ({ ...t, projectTitle: null }));
  res.json(ListProjectTasksResponse.parse(toJson(withProject)));
});

export default router;
