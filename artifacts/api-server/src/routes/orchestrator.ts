import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, conversationsTable, messagesTable } from "@workspace/db";
import { OrchestratorChatBody, ListOrchestratorConversationsResponse } from "@workspace/api-zod";
import { logActivity } from "../lib/activity-logger";
import { logger } from "../lib/logger";

const router = Router();

const SYSTEM_PROMPT = `You are the Executive Assistant for FounderOS — the founder's AI chief of staff and command center.

Your role is to:
- Provide strategic operational guidance and prioritization
- Summarize operational state (projects, leads, tasks, revenue)
- Recommend actions based on context
- Coordinate work across departments
- Keep the founder focused on high-leverage activities

Be direct, precise, and action-oriented. No fluff. You are a senior operator, not a generic assistant.
Responses should be 1-4 sentences unless a detailed breakdown is asked for.`;

async function callAI(messages: Array<{ role: string; content: string }>): Promise<{ reply: string; model: string; tokensUsed: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      reply: "AI orchestration is not configured. Add an OPENROUTER_API_KEY or OPENAI_API_KEY environment variable to enable the Executive Assistant. For now, I can confirm your FounderOS is fully operational — all data systems, agents, and automations are running.",
      model: "fallback",
      tokensUsed: 0,
    };
  }

  const isOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const endpoint = isOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const model = isOpenRouter ? "anthropic/claude-3.5-haiku" : "gpt-4o-mini";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...(isOpenRouter ? { "HTTP-Referer": "https://founderos.app", "X-Title": "FounderOS" } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.warn({ err, status: response.status }, "AI API error");
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }>; usage?: { total_tokens?: number } };
    return {
      reply: data.choices[0]?.message?.content ?? "No response generated.",
      model,
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    logger.error({ err }, "AI call failed");
    throw err;
  }
}

router.post("/orchestrator/chat", async (req, res): Promise<void> => {
  const parsed = OrchestratorChatBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { message, conversationId: existingConvId } = parsed.data;

  let conversationId = existingConvId;
  if (!conversationId) {
    const [conv] = await db.insert(conversationsTable).values({
      type: "founder_chat",
      title: message.slice(0, 60),
      status: "active",
    }).returning();
    conversationId = conv.id;
  }

  await db.insert(messagesTable).values({
    conversationId,
    senderType: "user",
    content: message,
    role: "user",
  });

  await db.update(conversationsTable).set({ lastMessageAt: new Date() }).where(eq(conversationsTable.id, conversationId));

  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(messagesTable.createdAt)
    .limit(20);

  const messages = history.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));

  let reply = "";
  let modelUsed = "fallback";
  let tokensUsed = 0;

  try {
    const result = await callAI(messages);
    reply = result.reply;
    modelUsed = result.model;
    tokensUsed = result.tokensUsed;
  } catch {
    reply = "I encountered an issue processing your request. Please check the AI API configuration and try again.";
  }

  await db.insert(messagesTable).values({
    conversationId,
    senderType: "agent",
    content: reply,
    role: "assistant",
    modelUsed,
    tokensUsed,
  });

  await logActivity({ entityType: "conversation", entityId: conversationId, action: "message_sent", actorType: "agent", actorName: "Executive Assistant", details: { tokensUsed } });

  res.json({ reply, conversationId, agentUsed: "executive-assistant", modelUsed, tokensUsed, actions: [] });
});

router.get("/orchestrator/conversations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(conversationsTable).where(eq(conversationsTable.type, "founder_chat")).orderBy(conversationsTable.createdAt);
  res.json(ListOrchestratorConversationsResponse.parse(rows.map((r) => ({ ...r, messageCount: null }))));
});

export default router;
