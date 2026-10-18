import { db, notificationsTable } from "@workspace/db";
import { publishOperationalEvent } from "../lib/event-bus";

export async function createOperationalNotification(params: {
  type?: "info" | "warning" | "alert" | "success";
  title: string;
  body?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const [notification] = await db.insert(notificationsTable).values({
    type: params.type ?? "info",
    title: params.title,
    body: params.body ?? null,
    priority: params.priority ?? "medium",
    actionUrl: params.actionUrl ?? null,
    metadata: params.metadata,
  }).returning();

  publishOperationalEvent("notification.created", {
    notificationId: notification.id,
    title: notification.title,
    priority: notification.priority,
    createdAt: notification.createdAt.toISOString(),
    metadata: (notification.metadata as Record<string, unknown> | null) ?? null,
  });

  return notification.id;
}
