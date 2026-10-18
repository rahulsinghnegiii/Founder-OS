import { Router } from "express";
import { db, notesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.get("/notes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(notesTable).orderBy(desc(notesTable.createdAt));
  res.json(rows);
});

export default router;
