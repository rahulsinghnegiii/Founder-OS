import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, sql } from "drizzle-orm";
import { db, conversationsTable, messagesTable, leadsTable } from "@workspace/db";
import {
  ListConversationsResponse,
  ListConversationsQueryParams,
  CreateConversationBody,
  GetConversationParams,
  GetConversationResponse,
  ListMessagesParams,
  ListMessagesResponse,
  CreateMessageParams,
  CreateMessageBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/conversations", async (req, res): Promise<void> => {
  const query = ListConversationsQueryParams.safeParse(req.query);
  let rows;
  if (query.success && query.data.type) {
    rows = await db.select().from(conversationsTable).where(eq(conversationsTable.type, query.data.type)).orderBy(conversationsTable.createdAt);
  } else {
    rows = await db.select().from(conversationsTable).orderBy(conversationsTable.createdAt);
  }
  const withCount = await Promise.all(
    rows.map(async (c) => {
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).where(eq(messagesTable.conversationId, c.id));
      return { ...c, messageCount: count };
    })
  );
  res.json(ListConversationsResponse.parse(toJson(withCount)));
});

router.post("/conversations", async (req, res): Promise<void> => {
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [conv] = await db.insert(conversationsTable).values(parsed.data).returning();
  res.status(201).json(GetConversationResponse.parse(toJson({ ...conv, messageCount: 0 })));
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).where(eq(messagesTable.conversationId, conv.id));
  res.json(GetConversationResponse.parse(toJson({ ...conv, messageCount: count })));
});

router.get("/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const messages = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, params.data.id)).orderBy(messagesTable.createdAt);
  res.json(ListMessagesResponse.parse(toJson(messages)));
});

router.post("/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = CreateMessageParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [msg] = await db.insert(messagesTable).values({ ...parsed.data, conversationId: params.data.id, senderType: "user" }).returning();
  await db.update(conversationsTable).set({ lastMessageAt: new Date() }).where(eq(conversationsTable.id, params.data.id));
  res.status(201).json(msg);
});

export default router;
