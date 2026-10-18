import { Router } from "express";
import { z } from "zod/v4";
import { planner } from "../services/planner";

const router = Router();

const createPlanBody = z.object({
  goal: z.string().min(5),
  context: z.string().optional(),
});

router.post("/planner/plan", async (req, res) => {
  const parsed = createPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const plan = await planner.createPlan(parsed.data);
    res.status(201).json(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan generation failed";
    res.status(500).json({ error: message });
  }
});

router.get("/planner/plans", async (_req, res) => {
  const plans = await planner.listPlans();
  res.json(plans);
});

router.get("/planner/plans/:id", async (req, res) => {
  const plan = await planner.getPlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(plan);
});

// NOT IMPLEMENTED — future milestone
// router.post("/planner/plans/:id/execute", async (req, res) => { ... });

export default router;