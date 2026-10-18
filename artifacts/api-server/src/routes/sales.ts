import { Router } from "express";
import { z } from "zod/v4";
import { salesAgent } from "../services/sales-agent";

const router = Router();

function fail(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : fallback;
  const code = /not found/i.test(message) ? 404 : 500;
  res.status(code).json({ error: message });
}

/** Everything the Sales Desk needs in one call. */
router.get("/sales/overview", async (_req, res) => {
  try {
    const [pipeline, staleDeals, followUps, brief] = await Promise.all([
      salesAgent.getPipelineSnapshot(),
      salesAgent.listStaleDeals(),
      salesAgent.listFollowUps("draft"),
      salesAgent.getBrief(),
    ]);
    res.json({ pipeline, staleDeals, followUps, brief });
  } catch (err) {
    fail(res, err, "Failed to load sales overview");
  }
});

router.get("/sales/brief", async (req, res) => {
  try {
    res.json(await salesAgent.getBrief(req.query.refresh === "1"));
  } catch (err) {
    fail(res, err, "Failed to build pipeline brief");
  }
});

router.get("/sales/stale", async (_req, res) => {
  try {
    res.json(await salesAgent.listStaleDeals());
  } catch (err) {
    fail(res, err, "Failed to list stale deals");
  }
});

router.post("/sales/scan", async (_req, res) => {
  try {
    res.json(await salesAgent.runScan("manual"));
  } catch (err) {
    fail(res, err, "Scan failed");
  }
});

router.get("/sales/follow-ups", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await salesAgent.listFollowUps(status));
  } catch (err) {
    fail(res, err, "Failed to list follow-ups");
  }
});

router.post("/sales/follow-ups/:id/sent", async (req, res) => {
  try {
    res.json(await salesAgent.markFollowUpSent(req.params.id));
  } catch (err) {
    fail(res, err, "Failed to mark follow-up sent");
  }
});

router.post("/sales/follow-ups/:id/dismiss", async (req, res) => {
  try {
    res.json(await salesAgent.dismissFollowUp(req.params.id));
  } catch (err) {
    fail(res, err, "Failed to dismiss follow-up");
  }
});

router.post("/sales/follow-ups/:id/regenerate", async (req, res) => {
  try {
    res.json(await salesAgent.regenerateFollowUp(req.params.id));
  } catch (err) {
    fail(res, err, "Failed to regenerate follow-up");
  }
});

router.get("/sales/leads/:id/follow-ups", async (req, res) => {
  try {
    res.json(await salesAgent.listFollowUpsForLead(req.params.id));
  } catch (err) {
    fail(res, err, "Failed to list follow-ups for lead");
  }
});

router.post("/sales/leads/:id/draft", async (req, res) => {
  const body = z.object({ reason: z.string().optional() }).safeParse(req.body ?? {});
  try {
    res.status(201).json(
      await salesAgent.draftFollowUp(req.params.id, { reason: body.success ? body.data.reason : undefined, trigger: "manual" }),
    );
  } catch (err) {
    fail(res, err, "Failed to draft follow-up");
  }
});

router.post("/sales/leads/:id/contact", async (req, res) => {
  try {
    const lead = await salesAgent.logContact(req.params.id);
    res.json({ ...lead, estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null });
  } catch (err) {
    fail(res, err, "Failed to log contact");
  }
});

router.post("/sales/leads/:id/score", async (req, res) => {
  try {
    res.json({ score: await salesAgent.scoreLead(req.params.id) });
  } catch (err) {
    fail(res, err, "Failed to score lead");
  }
});

export default router;
