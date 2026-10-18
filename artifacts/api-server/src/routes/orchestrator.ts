import { Router } from "express";
import { z } from "zod/v4";
import { orchestratorService } from "../services/orchestrator-service";
import { conversationRepository } from "../services/conversation-repository";
import { logger } from "../lib/logger";

const router = Router();

router.post("/orchestrator/chat", async (req, res): Promise<void> => {
  const Body = z.object({
    message: z.string().min(1),
    conversationId: z.string().nullish(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { message, conversationId } = parsed.data;

  try {
    const result = await orchestratorService.handleFounderMessage({
      message,
      conversationId: conversationId ?? null,
    });

    res.json({
      reply: result.reply,
      conversationId: result.conversationId,
      agentUsed: "executive-assistant",
      modelUsed: result.modelUsed,
      tokensUsed: result.tokensUsed,
      actions: result.actions,
    });
  } catch (err) {
    logger.error({ err }, "Orchestrator route handler error");
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Orchestration failed: ${message}` });
  }
});

const SessionQuery = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

// List sessions with optional search + status filter.
router.get("/orchestrator/sessions", async (req, res): Promise<void> => {
  const parsed = SessionQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const sessions = await conversationRepository.listSessions({
      q: parsed.data.q,
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    res.json({ sessions });
  } catch (err) {
    logger.error({ err }, "list sessions failed");
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

const SessionPatch = z.object({
  title: z.string().optional(),
  pinned: z.boolean().optional(),
  status: z.string().optional(),
});

router.patch("/orchestrator/sessions/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const parsed = SessionPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const { title, pinned, status } = parsed.data;
    if (title !== undefined) await conversationRepository.renameSession(id, title);
    if (pinned !== undefined) await conversationRepository.setPinned(id, pinned);
    if (status !== undefined) await conversationRepository.setStatus(id, status);
    const session = await conversationRepository.getSession(id);
    res.json({ session });
  } catch (err) {
    logger.error({ err }, "patch session failed");
    res.status(500).json({ error: "Failed to update session" });
  }
});

router.delete("/orchestrator/sessions/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    await conversationRepository.deleteSession(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete session failed");
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
