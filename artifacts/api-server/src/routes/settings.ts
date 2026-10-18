import { Router, type IRouter } from "express";
import { providerFactory } from "../lib/ai/providers";
import { MODEL_REGISTRY } from "../lib/ai/models";
import { callAI } from "../lib/ai";
import { authRequired } from "../lib/auth";

const router: IRouter = Router();

router.get("/settings/providers", (_req, res) => {
  const active = providerFactory.getActive();
  const providers = providerFactory.getAvailableProviders();
  const models = MODEL_REGISTRY.filter((m) => m.provider === active.name || active.name === "none").map((m) => ({
    id: m.id,
    provider: m.provider,
    displayName: m.displayName,
    tier: m.tier,
    contextWindow: m.contextWindow,
    supportsJson: m.supportsJson,
    suitableFor: [] as string[],
    costPer1kInput: m.costPer1kInput,
    costPer1kOutput: m.costPer1kOutput,
  }));

  res.json({
    active,
    providers,
    models,
    authRequired: authRequired(),
    note:
      active.name === "none"
        ? "No AI provider configured. Add one key to .env (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OLLAMA_BASE_URL) and restart."
        : `Keys are read from the server environment, never from the browser. Override the model with ${active.name.toUpperCase()}_MODEL or pick a provider explicitly with AI_PROVIDER.`,
  });
});

/** Round-trip a tiny prompt through the active provider so setup problems surface in the UI. */
router.post("/settings/providers/test", async (_req, res) => {
  const active = providerFactory.getActive();
  const result = await callAI(
    [
      { role: "system", content: "You are a connectivity check. Reply with the single word OK." },
      { role: "user", content: "Ping" },
    ],
    // Reasoning models spend output tokens before answering; keep headroom.
    { maxTokens: 1024 },
  );
  res.json({
    success: !result.error,
    provider: active.name,
    model: result.model,
    latencyMs: result.latencyMs,
    reply: result.error ? null : result.reply.slice(0, 200),
    error: result.error ?? null,
  });
});

router.post("/settings/providers/config", (_req, res) => {
  res.status(400).json({
    success: false,
    error: "Provider credentials are configured through environment variables, not the API. Edit .env and restart the server.",
  });
});

export default router;
