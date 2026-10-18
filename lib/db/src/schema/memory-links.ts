import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { memoriesTable } from "./memories";

/**
 * Relationships between memories, e.g. Client -> Project -> Repository -> Tasks.
 * This turns isolated memory rows into a connected knowledge graph without a
 * vector database.
 */
export const memoryLinksTable = pgTable("memory_links", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromMemoryId: text("from_memory_id")
    .notNull()
    .references(() => memoriesTable.id),
  toMemoryId: text("to_memory_id")
    .notNull()
    .references(() => memoriesTable.id),
  relation: text("relation").notNull(),
  strength: real("strength").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMemoryLinkSchema = createInsertSchema(memoryLinksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMemoryLink = z.infer<typeof insertMemoryLinkSchema>;
export type MemoryLink = typeof memoryLinksTable.$inferSelect;
