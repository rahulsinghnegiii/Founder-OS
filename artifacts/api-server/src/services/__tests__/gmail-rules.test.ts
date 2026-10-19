import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMessage,
  extractAddresses,
  latestTouch,
  resolveOpenDraft,
  summarizeEmailActivity,
  syncCursor,
  type MessageHeaders,
} from "../gmail-rules";

const NOW = new Date("2026-10-19T12:00:00Z");
const hoursAgo = (n: number) => NOW.getTime() - n * 60 * 60 * 1000;

function message(overrides: Partial<MessageHeaders>): MessageHeaders {
  return { id: "m1", internalDate: hoursAgo(1), labelIds: ["INBOX"], from: null, to: null, cc: null, subject: null, ...overrides };
}

describe("extractAddresses", () => {
  it("pulls every address out of a header, lowercased and de-duplicated", () => {
    assert.deepEqual(extractAddresses(`"Reyes, Daniel" <Daniel.Reyes@HarborFreight.co>, ops@harborfreight.co, daniel.reyes@harborfreight.co`), [
      "daniel.reyes@harborfreight.co",
      "ops@harborfreight.co",
    ]);
  });

  it("handles empty and missing headers", () => {
    assert.deepEqual(extractAddresses(null), []);
    assert.deepEqual(extractAddresses(""), []);
    assert.deepEqual(extractAddresses("undisclosed-recipients:;"), []);
  });
});

describe("classifyMessage", () => {
  it("treats Sent mail as outbound and everything else as inbound", () => {
    assert.equal(classifyMessage({ labelIds: ["SENT"] }), "outbound");
    assert.equal(classifyMessage({ labelIds: ["INBOX", "UNREAD"] }), "inbound");
    assert.equal(classifyMessage({ labelIds: [] }), "inbound");
  });

  it("ignores drafts, chats, spam and trash", () => {
    for (const label of ["DRAFT", "CHAT", "SPAM", "TRASH"]) {
      assert.equal(classifyMessage({ labelIds: ["SENT", label] }), null, label);
    }
  });
});

describe("summarizeEmailActivity", () => {
  const leads = ["daniel.reyes@harborfreight.co", "priya@nimbuslabs.io"];

  it("credits outbound mail to every lead on To or Cc", () => {
    const activity = summarizeEmailActivity(
      [message({ id: "s1", labelIds: ["SENT"], to: "Daniel <daniel.reyes@harborfreight.co>", cc: "priya@nimbuslabs.io", subject: "Pilot" })],
      leads,
    );
    assert.equal(activity.get("daniel.reyes@harborfreight.co")?.lastOutbound?.messageId, "s1");
    assert.equal(activity.get("priya@nimbuslabs.io")?.lastOutbound?.subject, "Pilot");
  });

  it("credits inbound mail only to the sender", () => {
    const activity = summarizeEmailActivity(
      [message({ id: "r1", from: "priya@nimbuslabs.io", to: "me@founder.dev", cc: "daniel.reyes@harborfreight.co" })],
      leads,
    );
    assert.equal(activity.get("priya@nimbuslabs.io")?.lastInbound?.messageId, "r1");
    assert.equal(activity.has("daniel.reyes@harborfreight.co"), false);
  });

  it("keeps the newest message in each direction and skips strangers and drafts", () => {
    const activity = summarizeEmailActivity(
      [
        message({ id: "old", labelIds: ["SENT"], to: "priya@nimbuslabs.io", internalDate: hoursAgo(50) }),
        message({ id: "new", labelIds: ["SENT"], to: "priya@nimbuslabs.io", internalDate: hoursAgo(5) }),
        message({ id: "draft", labelIds: ["SENT", "DRAFT"], to: "priya@nimbuslabs.io", internalDate: hoursAgo(1) }),
        message({ id: "reply", from: "PRIYA@nimbuslabs.io", internalDate: hoursAgo(3) }),
        message({ id: "spam", from: "someone@else.com" }),
      ],
      leads,
    );
    const priya = activity.get("priya@nimbuslabs.io");
    assert.equal(priya?.lastOutbound?.messageId, "new");
    assert.equal(priya?.lastInbound?.messageId, "reply");
    assert.equal(activity.size, 1);
  });
});

describe("latestTouch", () => {
  it("returns the newer of the two directions", () => {
    const out = { direction: "outbound" as const, at: new Date(hoursAgo(5)), subject: null, messageId: "o" };
    const inbound = { direction: "inbound" as const, at: new Date(hoursAgo(2)), subject: null, messageId: "i" };
    assert.equal(latestTouch({ lastOutbound: out, lastInbound: inbound })?.messageId, "i");
    assert.equal(latestTouch({ lastOutbound: out, lastInbound: null })?.messageId, "o");
    assert.equal(latestTouch({ lastOutbound: null, lastInbound: null }), null);
  });
});

describe("resolveOpenDraft", () => {
  const draftCreatedAt = new Date(hoursAgo(10));
  const touch = (direction: "outbound" | "inbound", h: number) => ({ direction, at: new Date(hoursAgo(h)), subject: null, messageId: `${direction}-${h}` });

  it("marks the draft sent when the founder emailed the lead after it was written", () => {
    const result = resolveOpenDraft(draftCreatedAt, { lastOutbound: touch("outbound", 4), lastInbound: touch("inbound", 2) });
    assert.deepEqual(result, { status: "sent", at: new Date(hoursAgo(4)), because: "founder_emailed" });
  });

  it("dismisses the draft when only the lead wrote back", () => {
    const result = resolveOpenDraft(draftCreatedAt, { lastOutbound: touch("outbound", 20), lastInbound: touch("inbound", 2) });
    assert.deepEqual(result, { status: "dismissed", at: new Date(hoursAgo(2)), because: "lead_replied" });
  });

  it("leaves the draft alone when nothing happened after it was written", () => {
    assert.equal(resolveOpenDraft(draftCreatedAt, { lastOutbound: touch("outbound", 20), lastInbound: touch("inbound", 30) }), null);
  });
});

describe("syncCursor", () => {
  it("looks back the full window on the first sync", () => {
    assert.equal(syncCursor(null, NOW, 30).toISOString(), "2026-09-19T12:00:00.000Z");
  });

  it("overlaps the previous sync by an hour", () => {
    assert.equal(syncCursor(new Date(hoursAgo(1)), NOW, 30).toISOString(), "2026-10-19T10:00:00.000Z");
  });

  it("never reaches further back than the lookback window", () => {
    assert.equal(syncCursor(new Date("2026-01-01T00:00:00Z"), NOW, 30).toISOString(), "2026-09-19T12:00:00.000Z");
  });
});
