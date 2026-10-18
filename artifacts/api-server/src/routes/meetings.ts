import { Router } from "express";
import { db, meetingsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.get("/meetings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(meetingsTable).orderBy(desc(meetingsTable.createdAt));
  res.json(rows);
});

export default router;
