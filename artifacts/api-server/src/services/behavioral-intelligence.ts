import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { activitiesTable, db, tasksTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { memoryService } from "./memory-service";

export type BehavioralPatterns = {
  contextSwitchingIndex: number; // 0-100, higher = more fragmented
  executionVelocity: number; // Tasks per day (7-day avg)
  focusConsistency: number; // 0-100, how often founder works on high-priority items
  lastAnalysisAt: string;
};

export type OverloadState = {
  isOverloaded: boolean;
  score: number; // 0-100
  primaryStressors: string[];
  recommendation: string;
};

class BehavioralIntelligenceService {
  /**
   * Analyzes activity logs and task completions to understand founder work patterns.
   */
  async analyzeWorkPatterns(): Promise<BehavioralPatterns> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [recentActivities, completedTasks] = await Promise.all([
        db
          .select({
            entityType: activitiesTable.entityType,
            createdAt: activitiesTable.createdAt,
          })
          .from(activitiesTable)
          .where(gte(activitiesTable.createdAt, sevenDaysAgo))
          .orderBy(desc(activitiesTable.createdAt)),
        db
          .select({
            id: tasksTable.id,
            priority: tasksTable.priority,
            completedAt: tasksTable.completedAt,
          })
          .from(tasksTable)
          .where(and(gte(tasksTable.completedAt, sevenDaysAgo), isNotNull(tasksTable.completedAt))),
      ]);

      const activityByHour: Record<string, Set<string>> = {};
      recentActivities.forEach((act) => {
        const hourKey = act.createdAt.toISOString().slice(0, 13);
        if (!activityByHour[hourKey]) activityByHour[hourKey] = new Set();
        activityByHour[hourKey].add(act.entityType);
      });

      const switchingScores = Object.values(activityByHour).map((types) => {
        return Math.min(100, (types.size / 4) * 100);
      });

      const contextSwitchingIndex = switchingScores.length > 0
        ? switchingScores.reduce((a, b) => a + b, 0) / switchingScores.length
        : 0;

      const executionVelocity = completedTasks.length / 7;

      const highPriorityCount = completedTasks.filter(
        (t) => t.priority === "high" || t.priority === "urgent"
      ).length;
      const focusConsistency = completedTasks.length > 0
        ? (highPriorityCount / completedTasks.length) * 100
        : 0;

      const patterns: BehavioralPatterns = {
        contextSwitchingIndex: Math.round(contextSwitchingIndex),
        executionVelocity: Number(executionVelocity.toFixed(2)),
        focusConsistency: Math.round(focusConsistency),
        lastAnalysisAt: new Date().toISOString(),
      };

      await memoryService.createMemory({
        entityType: "founder_behavior",
        key: "short_term:work_patterns",
        scope: "short_term",
        value: JSON.stringify(patterns),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      });

      return patterns;
    } catch (err) {
      logger.error({ err }, "Work pattern analysis failed");
      return {
        contextSwitchingIndex: 0,
        executionVelocity: 0,
        focusConsistency: 0,
        lastAnalysisAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Detects if the founder is currently over-leveraged or reaching burnout thresholds.
   */
  async detectOverload(): Promise<OverloadState> {
    try {
      const patterns = await this.analyzeWorkPatterns();
      
      const [overdueCount, totalOpenCount] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(isNull(tasksTable.deletedAt), sql`${tasksTable.dueDate} < now()`, sql`${tasksTable.status} not in ('done','cancelled')`)),
        db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(isNull(tasksTable.deletedAt), sql`${tasksTable.status} not in ('done','cancelled')`)),
      ]);

      const overdue = overdueCount[0]?.count ?? 0;
      const open = totalOpenCount[0]?.count ?? 0;

      let score = 0;
      const stressors: string[] = [];

      if (patterns.contextSwitchingIndex > 60) {
        score += 30;
        stressors.push("High context switching / fragmentation");
      }
      if (overdue > 5) {
        score += 20;
        stressors.push(`${overdue} overdue tasks`);
      }
      if (open > 20) {
        score += 15;
        stressors.push("High volume of active commitments");
      }
      if (patterns.focusConsistency < 40 && patterns.executionVelocity > 0) {
        score += 20;
        stressors.push("Focus drift (low priority work dominates)");
      }

      let recommendation = "Operational load is within healthy parameters. Maintain current tempo.";
      if (score > 70) {
        recommendation = "CRITICAL: Severe fragmentation detected. Activate 'Focus Mode' and delegate all non-essential activities.";
      } else if (score > 40) {
        recommendation = "WARNING: Cognitive load is increasing. Recommend batching similar activities and clearing the overdue backlog.";
      }

      const state: OverloadState = {
        isOverloaded: score > 40,
        score,
        primaryStressors: stressors,
        recommendation,
      };

      await memoryService.createMemory({
        entityType: "founder_behavior",
        key: "short_term:overload_state",
        scope: "short_term",
        value: JSON.stringify(state),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 1),
      });

      return state;
    } catch (err) {
      logger.error({ err }, "Behavioral intelligence overload detection failed");
      return {
        isOverloaded: false,
        score: 0,
        primaryStressors: [],
        recommendation: "Behavioral analysis is currently unavailable.",
      };
    }
  }

  async getLatestBehavioralProfile(): Promise<{ patterns: BehavioralPatterns; overload: OverloadState } | null> {
    const memories = await memoryService.listMemories({
      entityType: "founder_behavior",
      limit: 10,
    });

    const patternsMem = memories.find((m) => m.key === "short_term:work_patterns");
    const overloadMem = memories.find((m) => m.key === "short_term:overload_state");

    if (!patternsMem || !overloadMem) return null;

    return {
      patterns: JSON.parse(patternsMem.value),
      overload: JSON.parse(overloadMem.value),
    };
  }
}

export const behavioralIntelligenceService = new BehavioralIntelligenceService();
