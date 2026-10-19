import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Third-party accounts the founder has connected (one row per provider).
 * Today that is only Gmail. The refresh token is stored encrypted; see
 * `gmail-sync.ts` in the API server.
 */
export const integrationsTable = pgTable("integrations", {
  provider: text("provider").primaryKey(),
  accountEmail: text("account_email"),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  scope: text("scope"),
  status: text("status").notNull().default("connected"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncResult: jsonb("last_sync_result").$type<Record<string, unknown>>(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Integration = typeof integrationsTable.$inferSelect;
