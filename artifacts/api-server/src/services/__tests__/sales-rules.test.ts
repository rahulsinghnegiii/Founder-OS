import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS,
  STALE_THRESHOLD_DAYS,
  assessStaleness,
  compareStaleDeals,
  heuristicScore,
  lastTouch,
  money,
  normalizeScore,
  proposalFollowUpDueDate,
  stageAfterContact,
} from "../sales-rules";

const NOW = new Date("2026-10-18T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe("assessStaleness", () => {
  it("ignores closed deals no matter how old", () => {
    assert.equal(assessStaleness({ status: "won", lastContactedAt: daysAgo(90), createdAt: daysAgo(100) }, NOW), null);
    assert.equal(assessStaleness({ status: "lost", lastContactedAt: null, createdAt: daysAgo(100) }, NOW), null);
  });

  it("is quiet while inside the stage's allowance", () => {
    for (const [stage, threshold] of Object.entries(STALE_THRESHOLD_DAYS)) {
      const lead = { status: stage, lastContactedAt: daysAgo(threshold - 1), createdAt: daysAgo(30) };
      assert.equal(assessStaleness(lead, NOW), null, `${stage} should not be stale at ${threshold - 1} days`);
    }
  });

  it("flags a deal exactly at its threshold as at risk", () => {
    const result = assessStaleness({ status: "contacted", lastContactedAt: daysAgo(5), createdAt: daysAgo(20) }, NOW);
    assert.deepEqual(result, { daysSilent: 5, threshold: 5, severity: "at_risk" });
  });

  it("escalates to critical at double the threshold", () => {
    const result = assessStaleness({ status: "proposal", lastContactedAt: daysAgo(8), createdAt: daysAgo(20) }, NOW);
    assert.equal(result?.severity, "critical");
    const justUnder = assessStaleness({ status: "proposal", lastContactedAt: daysAgo(7), createdAt: daysAgo(20) }, NOW);
    assert.equal(justUnder?.severity, "at_risk");
  });

  it("falls back to createdAt when the lead was never contacted", () => {
    const lead = { status: "new", lastContactedAt: null, createdAt: daysAgo(4) };
    assert.equal(lastTouch(lead).getTime(), daysAgo(4).getTime());
    assert.deepEqual(assessStaleness(lead, NOW), { daysSilent: 4, threshold: 3, severity: "at_risk" });
  });

  it("accepts ISO strings as well as Date objects", () => {
    const lead = { status: "qualified", lastContactedAt: daysAgo(9).toISOString(), createdAt: daysAgo(30).toISOString() };
    assert.equal(assessStaleness(lead, NOW)?.daysSilent, 9);
  });
});

describe("heuristicScore", () => {
  it("starts at a neutral baseline", () => {
    assert.equal(heuristicScore({}), 40);
  });

  it("rewards value, company, email and warm sources", () => {
    const warm = heuristicScore({ estimatedValue: "30000", company: "Acme", email: "a@acme.com", source: "referral" });
    assert.equal(warm, 95);
  });

  it("penalises cold lists and never leaves 0–100", () => {
    assert.equal(heuristicScore({ source: "cold scraped list" }), 30);
    assert.ok(heuristicScore({ estimatedValue: 1e9, company: "x", email: "y", source: "intro" }) <= 100);
  });

  it("treats non-numeric values as zero", () => {
    assert.equal(heuristicScore({ estimatedValue: "not a number" }), 40);
  });
});

describe("normalizeScore", () => {
  it("clamps and rounds valid numbers", () => {
    assert.equal(normalizeScore(72.6), 73);
    assert.equal(normalizeScore(140), 100);
    assert.equal(normalizeScore(-3), 0);
  });

  it("rejects anything that is not a finite number", () => {
    assert.equal(normalizeScore("80"), null);
    assert.equal(normalizeScore(Number.NaN), null);
    assert.equal(normalizeScore(undefined), null);
  });
});

describe("proposal follow-through", () => {
  it("schedules the follow-up three days after sending", () => {
    const sent = new Date("2026-10-01T09:00:00Z");
    assert.equal(proposalFollowUpDueDate(sent).toISOString(), "2026-10-04T09:00:00.000Z");
  });

  it("moves new leads to contacted after outreach and leaves others alone", () => {
    assert.equal(stageAfterContact("new"), "contacted");
    assert.equal(stageAfterContact("qualified"), "qualified");
    assert.equal(stageAfterContact("proposal"), "proposal");
  });
});

describe("ordering and formatting", () => {
  it("puts critical deals first, then by value, then by silence", () => {
    const deals = [
      { name: "small-critical", severity: "critical" as const, value: 1_000, daysSilent: 12 },
      { name: "big-risk", severity: "at_risk" as const, value: 50_000, daysSilent: 6 },
      { name: "mid-risk-older", severity: "at_risk" as const, value: 10_000, daysSilent: 9 },
      { name: "mid-risk-newer", severity: "at_risk" as const, value: 10_000, daysSilent: 7 },
    ];
    const ordered = [...deals].sort(compareStaleDeals).map((d) => d.name);
    assert.deepEqual(ordered, ["small-critical", "big-risk", "mid-risk-older", "mid-risk-newer"]);
  });

  it("formats whole dollars with separators", () => {
    assert.equal(money(32000), "$32,000");
    assert.equal(money(1234.6), "$1,235");
  });
});
