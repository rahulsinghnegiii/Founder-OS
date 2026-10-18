import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  activitiesTable,
  agentsTable,
  automationLogsTable,
  db,
  leadsTable,
  opportunitiesTable,
  projectsTable,
  revenueTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";

import { behavioralIntelligenceService } from "./behavioral-intelligence";
import { memoryService } from "./memory-service";
import { predictiveEngineService, type OperationalPrediction } from "./predictive-engine";

type Recommendation = {
  problem: string;
  analysis: string;
  recommendation: string;
  expectedImpact: string;
  risks: string[];
  actionPlan: string[];
};

class OperationalIntelligenceService {
  async buildFounderBriefing(): Promise<{
    date: string;
    summary: string;
    topPriorities: string[];
    alerts: string[];
    opportunities: string[];
    recommendations: string[];
    structuredRecommendations: Recommendation[];
    predictions: OperationalPrediction[];
    decisionIQ: {
      leverageScore: number;
      alignmentScore: number;
      leverageAnalysis: string;
      alignmentAnalysis: string;
    };
    behavioralProfile?: any;
  }> {
    let highScoreLeads: Array<{ id: string; name: string; score: number | null; status: string | null }> = [];
    let recentOpportunities: Array<{ title: string; value: string | null }> = [];
    let predictions: any[] = [];
    let founderProfile = "No founder profile established yet.";
    let behavioralData: any = null;
    let metrics: Record<string, any> = {};

    try {
      const [
        overdueTasks,
        highScoreLeadsRaw,
        activeProjects,
        failedWorkflows,
        recentOpportunitiesRaw,
        activeAgents,
        monthlyRevenue,
        predictionsRaw,
        founderProfileRaw,
        behavioralDataRaw,
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(isNull(tasksTable.deletedAt), sql`${tasksTable.dueDate} < now()`, sql`${tasksTable.status} not in ('done','cancelled')`)),
        db.select({ id: leadsTable.id, name: leadsTable.name, score: leadsTable.score, status: leadsTable.status }).from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${leadsTable.score} >= 70`)).orderBy(desc(leadsTable.score)).limit(5),
        db.select({ count: sql<number>`count(*)::int` }).from(projectsTable).where(and(isNull(projectsTable.deletedAt), eq(projectsTable.status, "active"))),
        db.select({ count: sql<number>`count(*)::int` }).from(automationLogsTable).where(eq(automationLogsTable.status, "failed")),
        db.select({ title: opportunitiesTable.title, value: opportunitiesTable.value }).from(opportunitiesTable).orderBy(desc(opportunitiesTable.createdAt)).limit(3),
        db.select({ count: sql<number>`count(*)::int` }).from(agentsTable).where(sql`${agentsTable.status} in ('active','busy')`),
        db.select({ amount: revenueTable.amount }).from(revenueTable).where(eq(revenueTable.status, "received")),
        predictiveEngineService.generatePredictions(),
        memoryService.getFounderProfile(),
        behavioralIntelligenceService.detectOverload(),
      ]);

      highScoreLeads = highScoreLeadsRaw;
      recentOpportunities = recentOpportunitiesRaw;
      predictions = predictionsRaw;
      founderProfile = founderProfileRaw;
      behavioralData = behavioralDataRaw;

      const revenueThisMonth = monthlyRevenue.reduce((sum, row) => sum + Number(row.amount), 0);

      metrics = {
        overdueTasks: overdueTasks[0]?.count ?? 0,
        highScoreLeads: highScoreLeads.length,
        activeProjects: activeProjects[0]?.count ?? 0,
        failedWorkflows: failedWorkflows[0]?.count ?? 0,
        activeAgents: activeAgents[0]?.count ?? 0,
        revenueThisMonth,
        recentOpportunities: recentOpportunities.map((o) => o.title),
        predictions,
        behavioralData,
      };
    } catch (err) {
      logger.error({ err }, "Failed to gather operational metrics for briefing");
      metrics = {
        overdueTasks: 0, highScoreLeads: 0, activeProjects: 0,
        failedWorkflows: 0, activeAgents: 0, revenueThisMonth: 0,
        recentOpportunities: [], predictions: [], behavioralData: null,
      };
    }

    try {
      const result = await callAI(
        [
          {
            role: "system",
            content: `You are the Strategic Intelligence engine for FounderOS. Analyze the operational metrics, behavioral data, and the founder's long-term profile to provide a strategic briefing.
            
            COGNITIVE LOAD REDUCTION GUIDELINES:
            - If behavioral data indicates high context switching or overload, your tone should be calmer and more directive.
            - Prioritize "One Critical Move" in the topPriorities.
            - Reduce noise by grouping operational alerts into themes.
            
            Decision IQ consists of:
            - "leverageScore": 0-100, how much operational leverage the founder currently has.
            - "alignmentScore": 0-100, how well current execution aligns with the strategic profile.
            
            Return a JSON object:
            {
              "summary": "...",
              "topPriorities": ["..."],
              "alerts": ["..."],
              "opportunities": ["..."],
              "structuredRecommendations": [...],
              "decisionIQ": {
                "leverageScore": 85,
                "alignmentScore": 92,
                "leverageAnalysis": "...",
                "alignmentAnalysis": "..."
              }
            }`,
          },
          {
            role: "user",
            content: `Metrics & Behavior:\n${JSON.stringify(metrics, null, 2)}\n\nFounder Profile:\n${founderProfile}`,
          },
        ],
        { jsonMode: true },
      );

      const data = JSON.parse(result.reply);

      return {
        date: new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        summary: data.summary,
        topPriorities: data.topPriorities,
        alerts: data.alerts,
        opportunities: data.opportunities,
        recommendations: data.structuredRecommendations.map((r: Recommendation) => r.recommendation),
        structuredRecommendations: data.structuredRecommendations,
        predictions: data.predictions || predictions,
        decisionIQ: data.decisionIQ || {
          leverageScore: 70,
          alignmentScore: 75,
          leverageAnalysis: "Leverage is stable based on current task velocity.",
          alignmentAnalysis: "Strategic alignment is consistent with past patterns.",
        },
        behavioralProfile: metrics.behavioralData,
      };
    } catch (err) {
      logger.error({ err }, "AI briefing generation failed, falling back to basic briefing.");
      // Fallback logic (original code)
      return this.buildFallbackBriefing(metrics, highScoreLeads, recentOpportunities);
    }
  }

  private buildFallbackBriefing(metrics: any, highScoreLeads: any[], recentOpportunities: any[]) {
    const alerts: string[] = [];
    if (metrics.overdueTasks > 0) alerts.push(`${metrics.overdueTasks} tasks are overdue.`);
    if (metrics.failedWorkflows > 0) alerts.push(`${metrics.failedWorkflows} workflows failed.`);
    
    return {
      date: new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      summary: "FounderOS is stable. System metrics are within normal operational parameters.",
      topPriorities: ["Clear bottlenecks", "Review warm leads"],
      alerts: alerts.length > 0 ? alerts : ["No critical disruptions."],
      opportunities: recentOpportunities.map((o) => o.title),
      recommendations: ["Audit overdue tasks"],
      structuredRecommendations: [],
      predictions: metrics.predictions || [],
      decisionIQ: {
        leverageScore: 50,
        alignmentScore: 50,
        leverageAnalysis: "Decision intelligence is currently in fallback mode.",
        alignmentAnalysis: "Strategic alignment analysis is unavailable.",
      },
      behavioralProfile: metrics.behavioralData,
    };
  }

  async generateOperationalSummary(): Promise<{
    summary: string;
    recentActivities: Array<{ action: string; entityType: string; actorName: string | null }>;
  }> {
    const recentActivities = await db.select({
      action: activitiesTable.action,
      entityType: activitiesTable.entityType,
      actorName: activitiesTable.actorName,
    }).from(activitiesTable).orderBy(desc(activitiesTable.createdAt)).limit(8);

    const briefing = await this.buildFounderBriefing();

    return {
      summary: briefing.summary,
      recentActivities,
    };
  }

  private buildRecommendations(metrics: {
    overdueTasks: number;
    failedWorkflows: number;
    highScoreLeads: number;
    activeProjects: number;
    revenueThisMonth: number;
  }): Recommendation[] {
    const recommendations: Recommendation[] = [];

    if (metrics.highScoreLeads > 0) {
      recommendations.push({
        problem: "Qualified revenue opportunities are present but decay quickly if founder attention lags.",
        analysis: `${metrics.highScoreLeads} high-score lead(s) are already in the pipeline, which means timing now matters more than volume.`,
        recommendation: "Review the warmest opportunities first and let Sales own the rest of the follow-up motion.",
        expectedImpact: "Higher conversion probability and less pipeline drift.",
        risks: ["Founder may spend too much time inside sales execution.", "Low-quality personalization could weaken trust."],
        actionPlan: ["Review top two qualified leads.", "Delegate draft follow-up to Sales.", "Approve or personalize only the critical responses."],
      });
    }

    if (metrics.overdueTasks > 0) {
      recommendations.push({
        problem: "Execution drag is building inside the task system.",
        analysis: `${metrics.overdueTasks} overdue task(s) suggest Operations is carrying unresolved commitments that may hide bottlenecks.`,
        recommendation: "Clear overdue work before opening new execution fronts.",
        expectedImpact: "Restores operational tempo and sharper project confidence.",
        risks: ["Short-term opportunity work may slow down for a day.", "Some tasks may need to be intentionally cancelled rather than completed."],
        actionPlan: ["Audit overdue tasks.", "Escalate real blockers.", "Cancel low-value tasks that no longer matter."],
      });
    }

    if (metrics.failedWorkflows > 0) {
      recommendations.push({
        problem: "Workflow failures reduce trust in autonomous execution.",
        analysis: `${metrics.failedWorkflows} failed workflow run(s) indicate automation is not consistently carrying operational load.`,
        recommendation: "Stabilize workflow reliability before adding more automation complexity.",
        expectedImpact: "Stronger confidence in automated execution and fewer silent breakdowns.",
        risks: ["Repair work may feel slower than building new workflows.", "Underlying process issues may surface."],
        actionPlan: ["Inspect failed workflow logs.", "Re-run or repair broken steps.", "Add alerts around recurring failure patterns."],
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        problem: "No immediate operational pressure is visible, which can lead to unfocused founder effort.",
        analysis: "Stable systems can still waste momentum when priorities are too diffuse.",
        recommendation: "Use the calm window to tighten a single high-leverage initiative.",
        expectedImpact: "Cleaner strategic focus and stronger progress compounding.",
        risks: ["Calm periods can hide weak pipeline generation.", "Over-optimizing one area can starve another."],
        actionPlan: ["Pick one major objective.", "Assign clear departmental support.", "Measure progress at end of day."],
      });
    }

    return recommendations.slice(0, 3);
  }
}

export const operationalIntelligenceService = new OperationalIntelligenceService();
