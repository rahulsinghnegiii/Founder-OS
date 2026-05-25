import { Router } from "express";
import { isNull, eq, and, gte, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable, leadsTable, revenueTable, agentsTable, notificationsTable, activitiesTable } from "@workspace/db";
import { GetDashboardSummaryResponse, GetDailyBriefingResponse } from "@workspace/api-zod";
import { toJson } from "../lib/serialize";

const router = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [
    activeProjects,
    openTasks,
    totalLeads,
    revenue,
    activeAgents,
    unreadNotifications,
    urgentAlerts,
    recentActivities,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(projectsTable).where(and(eq(projectsTable.status, "active"), isNull(projectsTable.deletedAt))),
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(sql`${tasksTable.status} not in ('done','cancelled')`, isNull(tasksTable.deletedAt))),
    db.select({ count: sql<number>`count(*)::int` }).from(leadsTable).where(isNull(leadsTable.deletedAt)),
    db.select({ amount: revenueTable.amount }).from(revenueTable).where(eq(revenueTable.status, "received")),
    db.select({ count: sql<number>`count(*)::int` }).from(agentsTable).where(sql`${agentsTable.status} in ('active','busy')`),
    db.select({ count: sql<number>`count(*)::int` }).from(notificationsTable).where(eq(notificationsTable.isRead, false)),
    db.select({ count: sql<number>`count(*)::int` }).from(notificationsTable).where(and(eq(notificationsTable.isRead, false), eq(notificationsTable.priority, "urgent"))),
    db.select().from(activitiesTable).orderBy(sql`${activitiesTable.createdAt} desc`).limit(10),
  ]);

  const revenueThisMonth = revenue.reduce((acc, r) => acc + Number(r.amount), 0);

  const projectsByStatus = await db
    .select({ status: projectsTable.status, count: sql<number>`count(*)::int` })
    .from(projectsTable).where(isNull(projectsTable.deletedAt)).groupBy(projectsTable.status);

  const tasksByPriority = await db
    .select({ status: tasksTable.priority, count: sql<number>`count(*)::int` })
    .from(tasksTable).where(and(sql`${tasksTable.status} not in ('done','cancelled')`, isNull(tasksTable.deletedAt))).groupBy(tasksTable.priority);

  const leadsByStatus = await db
    .select({ status: leadsTable.status, count: sql<number>`count(*)::int` })
    .from(leadsTable).where(isNull(leadsTable.deletedAt)).groupBy(leadsTable.status);

  res.json(GetDashboardSummaryResponse.parse(toJson({
    activeProjects: activeProjects[0]?.count ?? 0,
    openTasks: openTasks[0]?.count ?? 0,
    totalLeads: totalLeads[0]?.count ?? 0,
    revenueThisMonth,
    activeAgents: activeAgents[0]?.count ?? 0,
    unreadNotifications: unreadNotifications[0]?.count ?? 0,
    urgentAlerts: urgentAlerts[0]?.count ?? 0,
    projectsByStatus,
    tasksByPriority,
    leadsByStatus,
    recentActivities: recentActivities.map((a) => ({ ...a, details: a.details as Record<string, unknown> | null })),
  })));
});

router.get("/dashboard/briefing", async (_req, res): Promise<void> => {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const [overdueTasks, hotLeads, qualifiedLeads] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
      .where(and(isNull(tasksTable.deletedAt), sql`${tasksTable.dueDate} < now()`, sql`${tasksTable.status} not in ('done','cancelled')`)),
    db.select().from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${leadsTable.score} >= 70`)).limit(3),
    db.select({ count: sql<number>`count(*)::int` }).from(leadsTable)
      .where(and(isNull(leadsTable.deletedAt), eq(leadsTable.status, "qualified"))),
  ]);
  const openOpps = qualifiedLeads;

  const priorities = [
    "Review and prioritize open tasks in your project board",
    "Follow up with qualified leads in your pipeline",
    "Check automation workflows are running correctly",
  ];
  const alerts: string[] = [];
  if (overdueTasks[0]?.count > 0) alerts.push(`${overdueTasks[0].count} task(s) are past their due date`);
  if (hotLeads.length > 0) alerts.push(`${hotLeads.length} high-score lead(s) ready for follow-up: ${hotLeads.map((l) => l.name).join(", ")}`);

  res.json(GetDailyBriefingResponse.parse({
    date: today,
    summary: "Your FounderOS is fully operational. All agents are standing by. Review your priorities below to maximize execution today.",
    topPriorities: priorities,
    alerts: alerts.length ? alerts : ["No urgent alerts — operations running smoothly"],
    opportunities: ["Explore automation workflows to reduce manual work", "Review revenue pipeline to identify quick wins"],
    recommendations: ["Set up your first automation workflow for lead notifications", "Add your Q2 projects and break them into actionable tasks"],
  }));
});

export default router;
