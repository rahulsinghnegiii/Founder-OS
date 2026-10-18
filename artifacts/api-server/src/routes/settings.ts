import { Router, type IRouter } from "express";
import { providerFactory } from "../lib/ai/providers";
import { MODEL_REGISTRY } from "../lib/ai/models";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/settings/providers", (_req, res) => {
  const available = providerFactory.getAvailableProviders();
  const models = MODEL_REGISTRY.map((m) => ({
    id: m.id,
    provider: m.provider,
    displayName: m.displayName,
    tier: m.tier,
    contextWindow: m.contextWindow,
    supportsJson: m.supportsJson,
    suitableFor: m.suitableFor,
    costPer1kInput: m.costPer1kInput,
    costPer1kOutput: m.costPer1kOutput,
  }));

  res.json({
    providers: available,
    models,
    note: "FounderOS now uses Puter.js as the single AI provider. No API keys required.",
  });
});

router.post("/settings/providers/test", (_req, res) => {
  res.json({
    success: true,
    provider: "puter",
    note: "Puter.js is always available — no API key needed.",
  });
});

router.post("/settings/providers/config", (_req, res) => {
  res.json({
    success: true,
    provider: "puter",
    note: "Puter.js requires no configuration. It works out of the box.",
  });
});

export default router;
