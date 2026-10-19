/**
 * Pure rules behind Gmail sync. FounderOS reads only message headers (From,
 * To, Cc, Subject and the delivery time) through Gmail's metadata scope, never
 * message bodies. These functions turn those headers into "when did we last
 * talk" facts per lead; `gmail-sync.ts` wires them to Gmail and the database.
 */

export type MessageHeaders = {
  id: string;
  /** Milliseconds since epoch, from Gmail's internalDate. */
  internalDate: number;
  labelIds: string[];
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
};

export type Direction = "outbound" | "inbound";

export type EmailTouch = {
  direction: Direction;
  at: Date;
  subject: string | null;
  messageId: string;
};

/** The latest email each way with one address. */
export type EmailActivity = {
  lastOutbound: EmailTouch | null;
  lastInbound: EmailTouch | null;
};

export type DraftResolution = {
  status: "sent" | "dismissed";
  at: Date;
  because: "founder_emailed" | "lead_replied";
};

const EMAIL_PATTERN = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

/** Drafts, chat logs, spam and trash are not contact with anyone. */
const IGNORED_LABELS = new Set(["DRAFT", "CHAT", "SPAM", "TRASH"]);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Every address in a header such as `"Reyes, Daniel" <daniel@x.co>, ops@x.co`. */
export function extractAddresses(header: string | null | undefined): string[] {
  if (!header) return [];
  return [...new Set((header.match(EMAIL_PATTERN) ?? []).map(normalizeEmail))];
}

/** Mail in Sent is from the founder; everything else that reached the mailbox is to them. */
export function classifyMessage(msg: Pick<MessageHeaders, "labelIds">): Direction | null {
  if (msg.labelIds.some((label) => IGNORED_LABELS.has(label))) return null;
  return msg.labelIds.includes("SENT") ? "outbound" : "inbound";
}

/**
 * Latest email in each direction for every lead address that appears.
 * Outbound mail counts for each lead on To or Cc; inbound mail counts for
 * the lead who sent it.
 */
export function summarizeEmailActivity(messages: MessageHeaders[], leadEmails: Iterable<string>): Map<string, EmailActivity> {
  const wanted = new Set([...leadEmails].map(normalizeEmail));
  const activity = new Map<string, EmailActivity>();

  for (const msg of messages) {
    const direction = classifyMessage(msg);
    if (!direction) continue;
    const parties =
      direction === "outbound" ? [...extractAddresses(msg.to), ...extractAddresses(msg.cc)] : extractAddresses(msg.from);
    const touch: EmailTouch = { direction, at: new Date(msg.internalDate), subject: msg.subject, messageId: msg.id };

    for (const email of new Set(parties)) {
      if (!wanted.has(email)) continue;
      const entry = activity.get(email) ?? { lastOutbound: null, lastInbound: null };
      const key = direction === "outbound" ? "lastOutbound" : "lastInbound";
      if (!entry[key] || touch.at > entry[key].at) entry[key] = touch;
      activity.set(email, entry);
    }
  }
  return activity;
}

/** The most recent email either way, or null when there is none. */
export function latestTouch(activity: EmailActivity): EmailTouch | null {
  const { lastOutbound: out, lastInbound: inbound } = activity;
  if (out && inbound) return out.at >= inbound.at ? out : inbound;
  return out ?? inbound;
}

/**
 * Decide what happens to an open follow-up draft given the email seen since
 * it was written. If the founder emailed the lead, treat the follow-up as
 * sent. If only the lead wrote, they replied, so the nudge is no longer needed.
 */
export function resolveOpenDraft(draftCreatedAt: Date, activity: EmailActivity): DraftResolution | null {
  const { lastOutbound, lastInbound } = activity;
  if (lastOutbound && lastOutbound.at > draftCreatedAt) {
    return { status: "sent", at: lastOutbound.at, because: "founder_emailed" };
  }
  if (lastInbound && lastInbound.at > draftCreatedAt) {
    return { status: "dismissed", at: lastInbound.at, because: "lead_replied" };
  }
  return null;
}

/**
 * Where a sync should stop reading back through the mailbox: an hour before
 * the last sync (clock skew, late delivery), or the lookback window on the
 * first run, whichever is later.
 */
export function syncCursor(lastSyncedAt: Date | null, now: Date, lookbackDays: number): Date {
  const floor = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  if (!lastSyncedAt) return new Date(floor);
  return new Date(Math.max(floor, lastSyncedAt.getTime() - 60 * 60 * 1000));
}
