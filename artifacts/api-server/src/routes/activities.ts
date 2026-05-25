import { Router } from "express";
import { toJson } from "../lib/serialize";
import { eq, desc } from "drizzle-orm";
import { db, activitiesTable } from "@workspace/db";
import { ListActivitiesResponse, ListActivitiesQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/activities", async (req, res): Promise<void> => {
  const query = ListActivitiesQueryParams.safeParse(req.query);
  const limit = (query.success && query.data.limit) ? Number(query.data.limit) : 50;
  let rows;
  if (query.success && query.data.entityType) {
    rows = await db.select().from(activitiesTable).where(eq(activitiesTable.entityType, query.data.entityType)).orderBy(desc(activitiesTable.createdAt)).limit(limit);
  } else {
    rows = await db.select().from(activitiesTable).orderBy(desc(activitiesTable.createdAt)).limit(limit);
  }
  res.json(ListActivitiesResponse.parse(toJson(rows)));
});

export default router;
