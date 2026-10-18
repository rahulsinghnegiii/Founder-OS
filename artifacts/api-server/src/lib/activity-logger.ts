import { db, activitiesTable } from "@workspace/db";
import { logger } from "./logger";
import { publishOperationalEvent } from "./event-bus";

export async function logActivity(params: {
  entityType: string;
  entityId?: string;
  action: string;
  actorName?: string;
  actorType?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const [activity] = await db.insert(activitiesTable).values({
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      actorName: params.actorName ?? "Founder",
      actorType: params.actorType ?? "user",
      details: params.details,
    }).returning();

    publishOperationalEvent("activity.created", {
      activityId: activity.id,
      entityType: activity.entityType,
      entityId: activity.entityId ?? null,
      action: activity.action,
      actorName: activity.actorName ?? null,
      actorType: activity.actorType ?? null,
      details: (activity.details as Record<string, unknown> | null) ?? null,
      createdAt: activity.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to log activity");
  }
}
