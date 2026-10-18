import { Router } from "express";
import { briefingService } from "../services/briefing";

const router = Router();

router.get("/briefing/daily", async (_req, res) => {
  try {
    const briefing = await briefingService.buildFounderBriefing();
    res.json(briefing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate briefing";
    res.status(500).json({ error: message });
  }
});

export default router;