import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, desc, sql } from "drizzle-orm";
import { db, revenueTable, leadsTable } from "@workspace/db";
import {
  ListRevenueResponse,
  ListRevenueQueryParams,
  CreateRevenueBody,
  GetRevenueSummaryResponse,
} from "@workspace/api-zod";

const router = Router();

router.get("/revenue", async (req, res): Promise<void> => {
  const query = ListRevenueQueryParams.safeParse(req.query);
  const rows = await db
    .select({ id: revenueTable.id, leadId: revenueTable.leadId, leadName: leadsTable.name, type: revenueTable.type, amount: revenueTable.amount, currency: revenueTable.currency, status: revenueTable.status, date: revenueTable.date, description: revenueTable.description, createdAt: revenueTable.createdAt })
    .from(revenueTable).leftJoin(leadsTable, eq(revenueTable.leadId, leadsTable.id)).orderBy(desc(revenueTable.date));
  const filtered = rows.filter((r) => !query.success || !query.data.status || r.status === query.data.status);
  res.json(ListRevenueResponse.parse(toJson(filtered.map((r) => ({ ...r, amount: Number(r.amount) })))));
});

router.post("/revenue", async (req, res): Promise<void> => {
  const parsed = CreateRevenueBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const insertData = { ...parsed.data, amount: String(parsed.data.amount) };
  const [rev] = await db.insert(revenueTable).values(insertData).returning();
  res.status(201).json({ ...rev, leadName: null, amount: Number(rev.amount) });
});

router.get("/revenue/summary", async (_req, res): Promise<void> => {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const all = await db.select().from(revenueTable).orderBy(revenueTable.date);

  let totalReceived = 0, totalInvoiced = 0, totalProjected = 0, thisMonthTotal = 0, lastMonthTotal = 0;
  const monthlyMap: Record<string, { received: number; projected: number }> = {};

  for (const r of all) {
    const amt = Number(r.amount);
    const month = r.date.slice(0, 7);
    if (!monthlyMap[month]) monthlyMap[month] = { received: 0, projected: 0 };
    if (r.status === "received") { totalReceived += amt; monthlyMap[month].received += amt; }
    if (r.status === "invoiced") totalInvoiced += amt;
    if (r.status === "projected") { totalProjected += amt; monthlyMap[month].projected += amt; }
    if (month === thisMonth) thisMonthTotal += amt;
    if (month === lastMonth) lastMonthTotal += amt;
  }

  const months = Object.keys(monthlyMap).sort().slice(-6);
  const monthlyTrend = months.map((m) => ({ month: m, received: monthlyMap[m].received, projected: monthlyMap[m].projected }));

  res.json(GetRevenueSummaryResponse.parse(toJson({ totalReceived, totalInvoiced, totalProjected, thisMonth: thisMonthTotal, lastMonth: lastMonthTotal, monthlyTrend })));
});

export default router;
