/**
 * Pure, dependency-free rules behind the Sales agent. Everything here is
 * deterministic and unit-tested; `sales-agent.ts` wires it to the database
 * and the AI provider.
 */

export const ACTIVE_STAGES = ["new", "contacted", "qualified", "proposal"] as const;
export type ActiveStage = (typeof ACTIVE_STAGES)[number];

/** Days of silence per stage before the Sales agent flags a deal. */
export const STALE_THRESHOLD_DAYS: Record<ActiveStage, number> = {
  new: 3,
  contacted: 5,
  qualified: 7,
  proposal: 4,
};

export const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

export const PROPOSAL_FOLLOW_UP_DAYS = 3;

export const DAY_MS = 24 * 60 * 60 * 1000;

export type LeadLike = {
  status: string;
  lastContactedAt: Date | string | null;
  createdAt: Date | string;
};

export type ScorableLead = {
  company?: string | null;
  email?: string | null;
  source?: string | null;
  estimatedValue?: string | number | null;
};

export type Staleness = {
  daysSilent: number;
  threshold: number;
  severity: "at_risk" | "critical";
};

export function isActiveStage(status: string): status is ActiveStage {
  return (ACTIVE_STAGES as readonly string[]).includes(status);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** The last time anyone touched the deal: last contact, else creation. */
export function lastTouch(lead: LeadLike): Date {
  return new Date(lead.lastContactedAt ?? lead.createdAt);
}

/**
 * Decide whether a lead has gone quiet. Returns null for closed deals and
 * for deals still inside their stage's silence allowance. A deal twice past
 * its threshold is "critical".
 */
export function assessStaleness(lead: LeadLike, now: Date = new Date()): Staleness | null {
  if (!isActiveStage(lead.status)) return null;
  const threshold = STALE_THRESHOLD_DAYS[lead.status];
  const daysSilent = daysBetween(lastTouch(lead), now);
  if (daysSilent < threshold) return null;
  return {
    daysSilent,
    threshold,
    severity: daysSilent >= threshold * 2 ? "critical" : "at_risk",
  };
}

/** Cheap 0–100 score used when the AI provider is unavailable or slow. */
export function heuristicScore(lead: ScorableLead): number {
  let score = 40;
  const value = lead.estimatedValue == null ? 0 : Number(lead.estimatedValue) || 0;
  if (value >= 25_000) score += 25;
  else if (value >= 5_000) score += 15;
  else if (value > 0) score += 5;
  if (lead.company) score += 10;
  if (lead.email) score += 5;
  const source = lead.source ?? "";
  if (/referr|intro|partner|inbound/i.test(source)) score += 15;
  else if (/cold|scrap|list/i.test(source)) score -= 10;
  return Math.max(0, Math.min(100, score));
}

/** Clamp an AI-provided score into range, or return null if unusable. */
export function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function proposalFollowUpDueDate(sentAt: Date): Date {
  return new Date(sentAt.getTime() + PROPOSAL_FOLLOW_UP_DAYS * DAY_MS);
}

/** Stage a lead moves to after the founder logs an outreach. */
export function stageAfterContact(status: string): string {
  return status === "new" ? "contacted" : status;
}

export function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Sort stale deals: critical first, then by value, then by days silent. */
export function compareStaleDeals(
  a: { severity: Staleness["severity"]; value: number; daysSilent: number },
  b: { severity: Staleness["severity"]; value: number; daysSilent: number },
): number {
  if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
  return b.value - a.value || b.daysSilent - a.daysSilent;
}
