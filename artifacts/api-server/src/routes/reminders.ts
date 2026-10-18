import { Router } from "express";
import { db, remindersTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.get("/reminders", async (_req, res): Promise<void> => {
  const rows = await db.select().from(remindersTable).orderBy(desc(remindersTable.createdAt));
  res.json(rows);
});

export default router;
