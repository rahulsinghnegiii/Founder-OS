import { db, tasksTable, leadsTable, automationLogsTable } from "@workspace/db";
import { and, eq, isNull, sql, desc } from "drizzle-orm";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";

export type OperationalPrediction = {
  type: "bottleneck" | "drift" | "decay" | "instability";
  title: string;
  probability: number;
  impact: "low" | "medium" | "high" | "critical";
  analysis: string;
  mitigationPlan: string[];
};

class PredictiveEngineService {
  async generatePredictions(): Promise<OperationalPrediction[]> {
    logger.info("Generating operational predictions");

    const [overdueCount, taskVelocity, leadStagnation, workflowFailures] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(tasksTable).where(and(isNull(tasksTable.deletedAt), sql`${tasksTable.dueDate} < now()`, sql`${tasksTable.status} not in ('done','cancelled')`)),
      db.select().from(tasksTable).where(eq(tasksTable.status, "done")).orderBy(desc(tasksTable.updatedAt)).limit(20),
      db.select().from(leadsTable).where(and(isNull(leadsTable.deletedAt), eq(leadsTable.status, "new"))).orderBy(desc(leadsTable.createdAt)).limit(10),
      db.select().from(automationLogsTable).where(eq(automationLogsTable.status, "failed")).orderBy(desc(automationLogsTable.createdAt)).limit(10),
    ]);

    const rawData = {
      overdueCount: overdueCount[0]?.count ?? 0,
      recentTaskCompletionCount: taskVelocity.length,
      stagnantNewLeads: leadStagnation.length,
      recentWorkflowFailures: workflowFailures.length,
    };

    try {
      const result = await callAI(
        [
          {
            role: "system",
            content: `You are the Predictive Operations Engine for FounderOS. Your job is to analyze raw operational data and predict potential issues (bottlenecks, drift, lead decay, system instability).
            Return a JSON object:
            {
              "predictions": [
                {
                  "type": "bottleneck" | "drift" | "decay" | "instability",
                  "title": "...",
                  "probability": 0.0 to 1.0,
                  "impact": "low" | "medium" | "high" | "critical",
                  "analysis": "A one-sentence explanation of the prediction.",
                  "mitigationPlan": ["Step 1", "Step 2"]
                }
              ]
            }`,
          },
          {
            role: "user",
            content: `Operational Data:\n${JSON.stringify(rawData, null, 2)}`,
          },
        ],
        { jsonMode: true }
      );

      const data = JSON.parse(result.reply);
      return data.predictions as OperationalPrediction[];
    } catch (err) {
      logger.error({ err }, "Predictive engine failed");
      return [];
    }
  }
}

export const predictiveEngineService = new PredictiveEngineService();
