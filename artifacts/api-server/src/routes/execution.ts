import { Router } from "express";
import { z } from "zod/v4";
import { executionEngine } from "../services/execution-engine";

const router = Router();

router.post("/execution/execute", async (req, res) => {
  const parsed = z.object({ planId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await executionEngine.executePlan(parsed.data.planId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed";
    res.status(500).json({ error: message });
  }
});

router.get("/execution/jobs/:planId", async (req, res) => {
  try {
    const history = await executionEngine.getExecutionHistory(req.params.planId);
    res.json(history);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch history";
    res.status(500).json({ error: message });
  }
});

export default router;