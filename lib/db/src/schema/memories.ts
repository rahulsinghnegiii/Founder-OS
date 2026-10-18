import { pgTable, text, timestamp, real, index, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const memoriesTable = pgTable(
  "memories",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    agentId: text("agent_id"),
    entityType: text("entity_type").notNull().default("general"),
    entityId: text("entity_id"),
    key: text("key").notNull(),
    value: text("value").notNull(),
    category: text("category").notNull().default("general"),
    source: text("source"),
    confidence: real("confidence").notNull().default(1),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    searchVector: tsvector("search_vector")
      .generatedAlwaysAs(
        sql`to_tsvector('english', coalesce(key,'') || ' ' || coalesce(value,'') || ' ' || coalesce(category,''))`,
      ),
  },
  (table) => [
    index("memories_category_idx").on(table.category),
    index("memories_status_idx").on(table.status),
    index("memories_entity_idx").on(table.entityType, table.entityId),
    index("memories_search_idx").using("gin", table.searchVector),
  ],
);

export const insertMemorySchema = createInsertSchema(memoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMemory = z.infer<typeof insertMemorySchema>;
export type Memory = typeof memoriesTable.$inferSelect;
