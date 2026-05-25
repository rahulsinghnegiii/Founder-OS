import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, desc } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { ListNotificationsResponse, ListNotificationsQueryParams } from "@workspace/api-zod";
import { z } from "zod/v4";

const CreateNotificationBody = z.object({
  type: z.enum(["info","warning","alert","success"]).default("info"),
  title: z.string(),
  message: z.string(),
  priority: z.enum(["low","medium","high","urgent"]).default("medium"),
  entityType: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
});

const router = Router();

router.get("/notifications", async (req, res): Promise<void> => {
  const query = ListNotificationsQueryParams.safeParse(req.query);
  let rows;
  if (query.success && query.data.unreadOnly) {
    rows = await db.select().from(notificationsTable).where(eq(notificationsTable.isRead, false)).orderBy(desc(notificationsTable.createdAt)).limit(50);
  } else {
    rows = await db.select().from(notificationsTable).orderBy(desc(notificationsTable.createdAt)).limit(50);
  }
  res.json(ListNotificationsResponse.parse(toJson(rows)));
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [notif] = await db.update(notificationsTable).set({ isRead: true, readAt: new Date() }).where(eq(notificationsTable.id, raw)).returning();
  if (!notif) { res.status(404).json({ error: "Notification not found" }); return; }
  res.json(notif);
});

router.post("/notifications/read-all", async (_req, res): Promise<void> => {
  const result = await db.update(notificationsTable).set({ isRead: true, readAt: new Date() }).where(eq(notificationsTable.isRead, false)).returning();
  res.json({ count: result.length });
});

router.post("/notifications", async (req, res): Promise<void> => {
  const parsed = CreateNotificationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [notif] = await db.insert(notificationsTable).values(parsed.data).returning();
  res.status(201).json(toJson(notif));
});

export default router;
