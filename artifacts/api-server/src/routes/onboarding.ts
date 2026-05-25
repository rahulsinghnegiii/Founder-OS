import { Router } from "express";
import { toJson } from "../lib/serialize";
import { db, onboardingTable } from "@workspace/db";
import { GetOnboardingResponse, UpdateOnboardingBody } from "@workspace/api-zod";

const router = Router();

router.get("/onboarding", async (_req, res): Promise<void> => {
  let [record] = await db.select().from(onboardingTable).limit(1);
  if (!record) {
    [record] = await db.insert(onboardingTable).values({
      currentStep: "welcome",
      steps: { welcome: { completed: false }, profile: { completed: false }, first_project: { completed: false }, first_lead: { completed: false }, explore_agents: { completed: false } },
    }).returning();
  }
  res.json(GetOnboardingResponse.parse(toJson(record)));
});

router.patch("/onboarding", async (req, res): Promise<void> => {
  const parsed = UpdateOnboardingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData = {
    ...parsed.data,
    completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : undefined,
  };
  let [record] = await db.select().from(onboardingTable).limit(1);
  if (!record) {
    [record] = await db.insert(onboardingTable).values(updateData).returning();
  } else {
    [record] = await db.update(onboardingTable).set(updateData).returning();
  }
  res.json(GetOnboardingResponse.parse(toJson(record)));
});

export default router;
