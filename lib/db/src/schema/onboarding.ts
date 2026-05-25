import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const onboardingTable = pgTable("onboarding", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  currentStep: text("current_step"),
  steps: jsonb("steps").$type<Record<string, unknown>>().default({}),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOnboardingSchema = createInsertSchema(onboardingTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOnboarding = z.infer<typeof insertOnboardingSchema>;
export type Onboarding = typeof onboardingTable.$inferSelect;
