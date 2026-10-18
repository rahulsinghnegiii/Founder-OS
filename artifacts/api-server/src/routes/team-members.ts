import { Router } from "express";
import { db, teamMembersTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.get("/team-members", async (_req, res): Promise<void> => {
  const rows = await db.select().from(teamMembersTable).orderBy(desc(teamMembersTable.createdAt));
  res.json(rows);
});

export default router;
