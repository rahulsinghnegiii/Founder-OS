import { db, activitiesTable } from "@workspace/db";
import { logger } from "./logger";

export async function logActivity(params: {
  entityType: string;
  entityId?: string;
  action: string;
  actorName?: string;
  actorType?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(activitiesTable).values({
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      actorName: params.actorName ?? "Founder",
      actorType: params.actorType ?? "user",
      details: params.details,
    });
  } catch (err) {
    logger.error({ err }, "Failed to log activity");
  }
}
