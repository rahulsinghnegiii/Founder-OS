import { Router } from "express";
import { z } from "zod/v4";
import { companyBrain } from "../services/company-brain";

const router = Router();

const rememberBody = z.object({
  entityType: z.string().min(1),
  entityId: z.string().optional(),
  category: z.string().optional(),
  key: z.string().min(1),
  value: z.string().min(1),
  source: z.string().optional(),
  confidence: z.number().optional(),
  scope: z.enum(["short_term", "long_term"]).optional(),
});

const linkBody = z.object({
  fromMemoryId: z.string().min(1),
  toMemoryId: z.string().min(1),
  relation: z.string().min(1),
  strength: z.number().optional(),
});

router.get("/brain/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  const memories = await companyBrain.search(q, {
    category: req.query.category ? String(req.query.category) : undefined,
    entityType: req.query.entityType ? String(req.query.entityType) : undefined,
    entityId: req.query.entityId ? String(req.query.entityId) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 10,
  });
  res.json(memories);
});

router.get("/brain/context", async (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ context: await companyBrain.getContext(q) });
});

router.get("/brain/memories", async (req, res) => {
  const memories = await companyBrain.search("", {
    category: req.query.category ? String(req.query.category) : undefined,
    entityType: req.query.entityType ? String(req.query.entityType) : undefined,
    entityId: req.query.entityId ? String(req.query.entityId) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 50,
  });
  res.json(memories);
});

router.post("/brain/remember", async (req, res) => {
  const parsed = rememberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const memory = await companyBrain.remember(parsed.data);
  res.status(201).json(memory);
});

router.patch("/brain/memories/:id", async (req, res) => {
  const patch = z
    .object({ value: z.string().optional(), category: z.string().optional(), key: z.string().optional(), confidence: z.number().optional() })
    .safeParse(req.body);
  if (!patch.success) {
    res.status(400).json({ error: patch.error.message });
    return;
  }
  const updated = await companyBrain.update(req.params.id, patch.data);
  res.json(updated);
});

router.delete("/brain/memories/:id", async (req, res) => {
  await companyBrain.forget(req.params.id);
  res.json({ ok: true });
});

router.post("/brain/link", async (req, res) => {
  const parsed = linkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await companyBrain.link(parsed.data.fromMemoryId, parsed.data.toMemoryId, parsed.data.relation, parsed.data.strength ?? 1);
  res.status(201).json({ ok: true });
});

router.get("/brain/relations/:id", async (req, res) => {
  res.json(await companyBrain.search("", { entityId: req.params.id, limit: 20 }));
});

router.get("/brain/profile", async (_req, res) => {
  res.json({ profile: await companyBrain.getFounderProfile(), structured: await companyBrain.getStructuredProfile() });
});

router.post("/brain/profile", async (req, res) => {
  const parsed = z.object({ field: z.string().min(1), value: z.unknown() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await companyBrain.updateFounderProfileField(parsed.data.field, parsed.data.value);
  res.json({ ok: true });
});

router.post("/brain/summarize", async (req, res) => {
  const parsed = z
    .object({ entityType: z.string().optional(), category: z.string().optional(), entityId: z.string().optional(), limit: z.number().optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json({ summary: await companyBrain.summarize(parsed.data) });
});

export default router;
