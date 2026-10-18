import { and, desc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  activitiesTable,
  leadsTable,
  projectsTable,
  reportsTable,
  tasksTable,
  workflowsTable,
  automationLogsTable,
} from "@workspace/db";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";

type Recommendation = {
  problem: string;
  analysis: string;
  recommendation: string;
  expectedImpact: string;
  risks: string[];
  actionPlan: string[];
};

type ExecutiveBriefing = {
  date: string;
  summary: string;
  highestPriorityTasks: { title: string; items: string[]; priority: string };
  blockedProjects: { title: string; items: string[]; priority: string };
  upcomingDeadlines: { title: string; items: string[]; priority: string };
  followUpsRequired: { title: string; items: string[]; priority: string };
  businessHealthSummary: { title: string; items: string[]; priority: string };
  aiRecommendations: { title: string; items: string[]; priority: string };
  suggestedFocus: string;
  generatedAt: string;
};

class BriefingService {
  async buildFounderBriefing(): Promise<ExecutiveBriefing> {
    const [
      highPriorityTasks,
      overdueTasks,
      blockedProjects,
      upcomingDeadlines,
      followUps,
      recentReports,
      leadUpdates,
      workflowStatus,
      brainContext,
    ] = await Promise.all([
      this.getHighPriorityTasks(),
      this.getOverdueTasks(),
      this.getBlockedProjects(),
      this.getUpcomingDeadlines(),
      this.getFollowUps(),
      this.getRecentReports(),
      this.getLeadUpdates(),
      this.getWorkflowStatus(),
      this.getBrainContext(),
    ]);

    const aiSections = await this.generateAISections({
      highPriorityTasks,
      blockedProjects,
      upcomingDeadlines,
      followUps,
      recentReports,
      leadUpdates,
      workflowStatus,
      brainContext,
    });

    return {
      date: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
      summary: aiSections.summary,
      highestPriorityTasks: { title: "Highest-Priority Tasks", items: highPriorityTasks, priority: "critical" },
      blockedProjects: { title: "Blocked Projects", items: blockedProjects, priority: "high" },
      upcomingDeadlines: { title: "Upcoming Deadlines", items: upcomingDeadlines, priority: "high" },
      followUpsRequired: { title: "Follow-Ups Required", items: followUps, priority: "medium" },
      businessHealthSummary: { title: "Business Health", items: aiSections.healthSummary, priority: "medium" },
      aiRecommendations: { title: "AI Recommendations", items: aiSections.recommendations, priority: "medium" },
      suggestedFocus: aiSections.suggestedFocus,
      generatedAt: new Date().toISOString(),
    };
  }

  private async getHighPriorityTasks(): Promise<string[]> {
    const tasks = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          isNull(tasksTable.deletedAt),
          isNotNull(tasksTable.dueDate),
          lte(tasksTable.dueDate, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        ),
      )
      .orderBy(desc(tasksTable.priority))
      .limit(5);

    return tasks.map((t) => `${t.title} (${t.priority}${t.dueDate ? `, due ${new Date(t.dueDate).toLocaleDateString()}` : ""})`);
  }

  private async getOverdueTasks(): Promise<string[]> {
    const tasks = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          isNull(tasksTable.deletedAt),
          isNotNull(tasksTable.dueDate),
          lte(tasksTable.dueDate, new Date()),
          sql`${tasksTable.status} NOT IN ('done', 'cancelled')`,
        ),
      )
      .limit(5);

    return tasks.map((t) => `${t.title} (${t.priority}, was due ${new Date(t.dueDate!).toLocaleDateString()})`);
  }

  private async getBlockedProjects(): Promise<string[]> {
    const projects = await db
      .select()
      .from(projectsTable)
      .where(and(isNull(projectsTable.deletedAt), eq(projectsTable.status, "blocked")))
      .limit(5);

    return projects.map((p) => `${p.title} — ${p.description ?? "No details"}`);
  }

  private async getUpcomingDeadlines(): Promise<string[]> {
    const tasks = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          isNull(tasksTable.deletedAt),
          isNotNull(tasksTable.dueDate),
          lte(tasksTable.dueDate, new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
          sql`${tasksTable.status} NOT IN ('done', 'cancelled')`,
        ),
      )
      .orderBy(tasksTable.dueDate)
      .limit(8);

    return tasks.map((t) => `${t.title} — due ${new Date(t.dueDate!).toLocaleDateString()} (${t.priority})`);
  }

  private async getFollowUps(): Promise<string[]> {
    const leads = await db
      .select()
      .from(leadsTable)
      .where(
        and(
          isNull(leadsTable.deletedAt),
          sql`${leadsTable.status} IN ('qualified', 'proposal', 'contacted')`,
        ),
      )
      .orderBy(desc(leadsTable.lastContactedAt))
      .limit(5);

    return leads.map((l) => `${l.name} (${l.company}) — ${l.status}, last contact: ${l.lastContactedAt ? new Date(l.lastContactedAt).toLocaleDateString() : "never"}`);
  }

  private async getRecentReports(): Promise<string[]> {
    const reports = await db
      .select()
      .from(reportsTable)
      .orderBy(desc(reportsTable.createdAt))
      .limit(3);

    return reports.map((r) => `${r.title} (${r.type})`);
  }

  private async getLeadUpdates(): Promise<string[]> {
    const recentActivity = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.entityType, "lead"))
      .orderBy(desc(activitiesTable.createdAt))
      .limit(5);

    return recentActivity.map((a) => `${a.action} on ${a.entityType} ${a.entityId} by ${a.actorName ?? "system"}`);
  }

  private async getWorkflowStatus(): Promise<string[]> {
    const failed = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(automationLogsTable)
      .where(eq(automationLogsTable.status, "failed"));

    const active = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowsTable)
      .where(eq(workflowsTable.isActive, true));

    return [
      `Active workflows: ${active[0]?.count ?? 0}`,
      `Failed runs (needs attention): ${failed[0]?.count ?? 0}`,
    ];
  }

  private async getBrainContext(): Promise<string> {
    const { companyBrain } = await import("./company-brain");
    return companyBrain.getContext("daily executive briefing");
  }

  private async generateAISections(data: {
    highPriorityTasks: string[];
    blockedProjects: string[];
    upcomingDeadlines: string[];
    followUps: string[];
    recentReports: string[];
    leadUpdates: string[];
    workflowStatus: string[];
    brainContext: string;
  }): Promise<{
    summary: string;
    healthSummary: string[];
    recommendations: string[];
    suggestedFocus: string;
  }> {
    const prompt = `You are the FounderOS Executive Briefing AI. Generate a concise daily briefing for a founder.

DATA:
High-Priority Tasks: ${data.highPriorityTasks.join("; ") || "None"}
Blocked Projects: ${data.blockedProjects.join("; ") || "None"}
Upcoming Deadlines: ${data.upcomingDeadlines.join("; ") || "None"}
Follow-Ups Needed: ${data.followUps.join("; ") || "None"}
Recent Reports: ${data.recentReports.join("; ") || "None"}
Lead Updates: ${data.leadUpdates.join("; ") || "None"}
Workflow Status: ${data.workflowStatus.join("; ")}
Company Brain Context: ${data.brainContext}

Return ONLY a JSON object with this exact schema:
{
  "summary": "2-3 sentence executive summary of today's state",
  "healthSummary": ["string", "..."],
  "recommendations": ["string", "..."],
  "suggestedFocus": "One clear focus area for today"
}`;

    try {
      const result = await callAI(
        [
          { role: "system", content: prompt },
          { role: "user", content: "Generate today's executive briefing." },
        ],
        { jsonMode: true },
      );
      const parsed = JSON.parse(result.reply);
      return {
        summary: parsed.summary,
        healthSummary: parsed.healthSummary || [],
        recommendations: parsed.recommendations || [],
        suggestedFocus: parsed.suggestedFocus || "Complete the highest-priority task and reassess.",
      };
    } catch (err) {
      logger.error({ err }, "AI briefing generation failed, using fallback");
      return {
        summary: "Briefing generated with limited AI analysis.",
        healthSummary: ["Fallback mode active."],
        recommendations: ["Review high-priority tasks manually."],
        suggestedFocus: "Complete the highest-priority task and reassess.",
      };
    }
  }
}

export const briefingService = new BriefingService();