import { eq, sql } from "drizzle-orm";
import { db, reportsTable } from "@workspace/db";
import { operationalIntelligenceService } from "./operational-intelligence";
import { logger } from "../lib/logger";

class BriefingEngineService {
  async getTodayBriefing(): Promise<any> {
    const today = new Date().toISOString().split("T")[0];
    const cacheKey = `daily-briefing-${today}`;

    try {
      const [existing] = await db
        .select()
        .from(reportsTable)
        .where(eq(reportsTable.cacheKey, cacheKey))
        .limit(1);

      if (existing) {
        return JSON.parse(existing.content || "{}");
      }
    } catch (err) {
      logger.warn({ err }, "Failed to read cached briefing, generating fresh");
    }

    logger.info({ today }, "Generating fresh daily briefing");
    const briefing = await operationalIntelligenceService.buildFounderBriefing();

    try {
      await db.insert(reportsTable).values({
        title: `Daily Briefing - ${briefing.date}`,
        type: "daily_briefing",
        content: JSON.stringify(briefing),
        cacheKey,
        metadata: {
          generatedAt: new Date().toISOString(),
          metrics: {
            summary: briefing.summary,
            priorityCount: briefing.topPriorities.length,
          },
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to cache daily briefing");
    }

    return briefing;
  }
}

export const briefingEngineService = new BriefingEngineService();
