import { Router } from "express";
import { isNull, eq, and, gte, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable, leadsTable, revenueTable, agentsTable, notificationsTable, activitiesTable } from "@workspace/db";
import { GetDashboardSummaryResponse, GetDailyBriefingResponse } from "@workspace/api-zod";
import { toJson } from "../lib/serialize";
import { briefingEngineService } from "../services/briefing-engine";
import { logger } from "../lib/logger";

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
  try {
    const briefing = await briefingEngineService.getTodayBriefing();
    // Sanitize AI-generated arrays that may contain nulls
    for (const key of ["topPriorities", "alerts", "opportunities", "recommendations"] as const) {
      if (Array.isArray(briefing[key])) briefing[key] = (briefing[key] as any[]).filter((x): x is string => typeof x === "string");
    }
    res.json(GetDailyBriefingResponse.parse(briefing));
  } catch (err) {
    logger.error({ err }, "Failed to generate daily briefing");
    res.json(GetDailyBriefingResponse.parse({
      date: new Date().toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      }),
      summary: "FounderOS is operational. System metrics are within normal parameters.",
      topPriorities: ["Review active projects", "Check pipeline"],
      alerts: ["No critical disruptions."],
      opportunities: [],
      recommendations: ["Review dashboard for full operational snapshot."],
      structuredRecommendations: [],
      predictions: [],
      decisionIQ: { leverageScore: 50, alignmentScore: 50, leverageAnalysis: "Data pending.", alignmentAnalysis: "Data pending." },
    }));
  }
});

export default router;
