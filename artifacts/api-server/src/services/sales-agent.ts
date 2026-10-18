import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  agentsTable,
  departmentsTable,
  followUpsTable,
  leadsTable,
  proposalsTable,
  tasksTable,
} from "@workspace/db";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";
import { logActivity } from "../lib/activity-logger";
import { publishOperationalEvent, subscribe } from "../lib/event-bus";
import { getFounderName } from "../lib/founder";
import { createOperationalNotification } from "./notification-service";
import { memoryService } from "./memory-service";
import {
  ACTIVE_STAGES,
  STAGE_LABELS,
  assessStaleness,
  compareStaleDeals,
  daysBetween,
  heuristicScore,
  lastTouch,
  money,
  normalizeScore,
  proposalFollowUpDueDate,
  stageAfterContact,
  type Staleness,
} from "./sales-rules";

type Lead = typeof leadsTable.$inferSelect;
type FollowUp = typeof followUpsTable.$inferSelect;

const SALES_AGENT_SLUG = "alex-sales";
const SALES_AGENT_NAME = "Alex — Sales Intelligence";
const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BRIEF_TTL_MS = 60 * 60 * 1000;

export type StaleDeal = Staleness & {
  lead: Lead & { estimatedValue: number | null };
  stage: string;
  stageLabel: string;
  openDraftId: string | null;
};

export type PipelineSnapshot = {
  stages: Array<{ status: string; label: string; count: number; value: number }>;
  openCount: number;
  openValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
};

export type FollowUpWithLead = FollowUp & {
  leadName: string;
  leadCompany: string | null;
  leadEmail: string | null;
  leadStatus: string;
};

export type PipelineBrief = {
  generatedAt: string;
  summary: string;
  actions: string[];
  risks: string[];
  openValue: number;
  atRiskValue: number;
  atRiskCount: number;
  cached: boolean;
};

function serializeLead(lead: Lead): Lead & { estimatedValue: number | null } {
  return { ...lead, estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null } as Lead & {
    estimatedValue: number | null;
  };
}

function founderLabel(name: string | null): string {
  return name ?? "the founder";
}

class SalesAgent {
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private briefCache: { at: number; brief: PipelineBrief } | null = null;
  private salesDepartmentId: string | null | undefined = undefined;

  /** Wire event listeners and the recurring stale-deal scan. */
  start(): void {
    subscribe("proposal.sent", (payload) => {
      void this.onProposalSent(payload).catch((err) => logger.error({ err }, "proposal.sent handler failed"));
    });
    subscribe("lead.created", (payload) => {
      void this.onLeadCreated(payload).catch((err) => logger.error({ err }, "lead.created handler failed"));
    });

    const firstRun = setTimeout(() => {
      void this.runScan("startup").catch((err) => logger.error({ err }, "startup sales scan failed"));
    }, 15_000);
    firstRun.unref();

    this.timer = setInterval(() => {
      void this.runScan("scheduled").catch((err) => logger.error({ err }, "scheduled sales scan failed"));
    }, SCAN_INTERVAL_MS);
    this.timer.unref();

    logger.info("Sales agent started (stale-deal scan every 6h)");
  }

  // ───────────────────────────── pipeline ─────────────────────────────

  async getPipelineSnapshot(): Promise<PipelineSnapshot> {
    const rows = await db
      .select({
        status: leadsTable.status,
        count: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${leadsTable.estimatedValue}), 0)::float`,
      })
      .from(leadsTable)
      .where(isNull(leadsTable.deletedAt))
      .groupBy(leadsTable.status);

    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r]));
    const stages = Object.keys(STAGE_LABELS).map((status) => ({
      status,
      label: STAGE_LABELS[status],
      count: byStatus[status]?.count ?? 0,
      value: byStatus[status]?.value ?? 0,
    }));

    const open = stages.filter((s) => (ACTIVE_STAGES as readonly string[]).includes(s.status));
    return {
      stages,
      openCount: open.reduce((n, s) => n + s.count, 0),
      openValue: open.reduce((n, s) => n + s.value, 0),
      wonCount: byStatus.won?.count ?? 0,
      wonValue: byStatus.won?.value ?? 0,
      lostCount: byStatus.lost?.count ?? 0,
    };
  }

  async listStaleDeals(): Promise<StaleDeal[]> {
    const leads = await db
      .select()
      .from(leadsTable)
      .where(and(isNull(leadsTable.deletedAt), inArray(leadsTable.status, [...ACTIVE_STAGES])));

    if (leads.length === 0) return [];

    const openDrafts = await db
      .select({ id: followUpsTable.id, leadId: followUpsTable.leadId })
      .from(followUpsTable)
      .where(and(eq(followUpsTable.status, "draft"), inArray(followUpsTable.leadId, leads.map((l) => l.id))));
    const draftByLead = new Map(openDrafts.map((d) => [d.leadId, d.id]));

    const now = new Date();
    const stale: StaleDeal[] = [];
    for (const lead of leads) {
      const staleness = assessStaleness(lead, now);
      if (!staleness) continue;
      stale.push({
        ...staleness,
        lead: serializeLead(lead),
        stage: lead.status,
        stageLabel: STAGE_LABELS[lead.status] ?? lead.status,
        openDraftId: draftByLead.get(lead.id) ?? null,
      });
    }

    return stale.sort((a, b) =>
      compareStaleDeals(
        { severity: a.severity, value: a.lead.estimatedValue ?? 0, daysSilent: a.daysSilent },
        { severity: b.severity, value: b.lead.estimatedValue ?? 0, daysSilent: b.daysSilent },
      ),
    );
  }

  // ───────────────────────────── follow-ups ─────────────────────────────

  async listFollowUps(status?: string): Promise<FollowUpWithLead[]> {
    const conditions = status ? [eq(followUpsTable.status, status)] : [];
    const rows = await db
      .select({
        followUp: followUpsTable,
        leadName: leadsTable.name,
        leadCompany: leadsTable.company,
        leadEmail: leadsTable.email,
        leadStatus: leadsTable.status,
      })
      .from(followUpsTable)
      .innerJoin(leadsTable, eq(followUpsTable.leadId, leadsTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(followUpsTable.createdAt));

    return rows.map((r) => ({
      ...r.followUp,
      leadName: r.leadName,
      leadCompany: r.leadCompany,
      leadEmail: r.leadEmail,
      leadStatus: r.leadStatus,
    }));
  }

  async listFollowUpsForLead(leadId: string): Promise<FollowUp[]> {
    return db.select().from(followUpsTable).where(eq(followUpsTable.leadId, leadId)).orderBy(desc(followUpsTable.createdAt));
  }

  /**
   * Draft a follow-up for a lead. Replaces any open draft for that lead so
   * the founder only ever sees one pending message per deal.
   */
  async draftFollowUp(leadId: string, opts: { reason?: string; trigger?: string } = {}): Promise<FollowUp> {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
    if (!lead || lead.deletedAt) throw new Error("Lead not found");

    const proposals = await db
      .select()
      .from(proposalsTable)
      .where(eq(proposalsTable.leadId, leadId))
      .orderBy(desc(proposalsTable.createdAt))
      .limit(3);

    const daysSilent = daysBetween(lastTouch(lead), new Date());
    const reason =
      opts.reason ??
      (lead.status === "proposal"
        ? `Proposal sent ${daysSilent} day${daysSilent === 1 ? "" : "s"} ago with no response`
        : `No contact for ${daysSilent} day${daysSilent === 1 ? "" : "s"} while in "${STAGE_LABELS[lead.status] ?? lead.status}"`);

    const draft = await this.generateDraft({ lead, proposals, daysSilent, reason });

    await db
      .update(followUpsTable)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(eq(followUpsTable.leadId, leadId), eq(followUpsTable.status, "draft")));

    const [created] = await db
      .insert(followUpsTable)
      .values({
        leadId,
        reason,
        subject: draft.subject,
        body: draft.body,
        daysSilent,
        status: "draft",
        source: opts.trigger ?? "sales-agent",
      })
      .returning();

    await logActivity({
      entityType: "lead",
      entityId: leadId,
      action: "follow_up_drafted",
      actorType: "agent",
      actorName: SALES_AGENT_NAME,
      details: {
        departmentId: await this.getSalesDepartmentId(),
        leadName: lead.name,
        company: lead.company,
        reason,
        followUpId: created.id,
      },
    });

    publishOperationalEvent("sales.follow_up.drafted", { leadId, followUpId: created.id, reason });
    return created;
  }

  async markFollowUpSent(id: string): Promise<FollowUp> {
    const [followUp] = await db.select().from(followUpsTable).where(eq(followUpsTable.id, id)).limit(1);
    if (!followUp) throw new Error("Follow-up not found");

    const now = new Date();
    const [updated] = await db
      .update(followUpsTable)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(eq(followUpsTable.id, id))
      .returning();

    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, followUp.leadId)).limit(1);
    if (lead) {
      await db
        .update(leadsTable)
        .set({ lastContactedAt: now, status: stageAfterContact(lead.status), updatedAt: now })
        .where(eq(leadsTable.id, lead.id));

      await logActivity({
        entityType: "lead",
        entityId: lead.id,
        action: "follow_up_sent",
        actorType: "user",
        actorName: founderLabel(await getFounderName()),
        details: { departmentId: await this.getSalesDepartmentId(), leadName: lead.name, subject: followUp.subject },
      });
    }

    this.briefCache = null;
    return updated;
  }

  async dismissFollowUp(id: string): Promise<FollowUp> {
    const now = new Date();
    const [updated] = await db
      .update(followUpsTable)
      .set({ status: "dismissed", dismissedAt: now, updatedAt: now })
      .where(eq(followUpsTable.id, id))
      .returning();
    if (!updated) throw new Error("Follow-up not found");
    return updated;
  }

  async regenerateFollowUp(id: string): Promise<FollowUp> {
    const [existing] = await db.select().from(followUpsTable).where(eq(followUpsTable.id, id)).limit(1);
    if (!existing) throw new Error("Follow-up not found");
    return this.draftFollowUp(existing.leadId, { reason: existing.reason, trigger: "regenerate" });
  }

  async logContact(leadId: string): Promise<Lead> {
    const now = new Date();
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
    if (!lead) throw new Error("Lead not found");
    const [updated] = await db
      .update(leadsTable)
      .set({ lastContactedAt: now, status: stageAfterContact(lead.status), updatedAt: now })
      .where(eq(leadsTable.id, leadId))
      .returning();
    await logActivity({
      entityType: "lead",
      entityId: leadId,
      action: "contact_logged",
      actorType: "user",
      actorName: founderLabel(await getFounderName()),
      details: { departmentId: await this.getSalesDepartmentId(), leadName: lead.name },
    });
    this.briefCache = null;
    return updated;
  }

  // ───────────────────────────── scan ─────────────────────────────

  /**
   * The Sales agent's recurring job: find deals that have gone quiet,
   * draft a follow-up for each one that has none, and raise a single
   * batched notification.
   */
  async runScan(trigger: "startup" | "scheduled" | "manual"): Promise<{
    scanned: number;
    stale: number;
    drafted: number;
    notified: boolean;
  }> {
    if (this.scanning) return { scanned: 0, stale: 0, drafted: 0, notified: false };
    this.scanning = true;
    await this.setAgentStatus("busy");

    try {
      const [openLeads] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leadsTable)
        .where(and(isNull(leadsTable.deletedAt), inArray(leadsTable.status, [...ACTIVE_STAGES])));

      const stale = await this.listStaleDeals();
      const needingDraft = stale.filter((d) => !d.openDraftId);

      const drafted: StaleDeal[] = [];
      for (const deal of needingDraft) {
        try {
          await this.draftFollowUp(deal.lead.id, { trigger: `scan:${trigger}` });
          drafted.push(deal);
        } catch (err) {
          logger.error({ err, leadId: deal.lead.id }, "Failed to draft follow-up during scan");
        }
      }

      let notified = false;
      if (drafted.length > 0) {
        const critical = drafted.filter((d) => d.severity === "critical").length;
        const value = drafted.reduce((n, d) => n + (d.lead.estimatedValue ?? 0), 0);
        const names = drafted.slice(0, 3).map((d) => d.lead.name).join(", ");
        await createOperationalNotification({
          type: critical > 0 ? "alert" : "warning",
          title: `${drafted.length} deal${drafted.length === 1 ? "" : "s"} going quiet`,
          body: `${names}${drafted.length > 3 ? ` and ${drafted.length - 3} more` : ""} — ${money(value)} in pipeline. Follow-up drafts are ready in the Sales Desk.`,
          priority: critical > 0 ? "high" : "medium",
          actionUrl: "/sales",
          metadata: { source: "sales-agent", leadIds: drafted.map((d) => d.lead.id), trigger },
        });
        notified = true;
      }

      await logActivity({
        entityType: "agent",
        action: "pipeline_scanned",
        actorType: "agent",
        actorName: SALES_AGENT_NAME,
        details: {
          departmentId: await this.getSalesDepartmentId(),
          trigger,
          scanned: openLeads?.count ?? 0,
          stale: stale.length,
          drafted: drafted.length,
        },
      });

      this.briefCache = null;
      publishOperationalEvent("sales.scan.completed", { trigger, stale: stale.length, drafted: drafted.length });

      return { scanned: openLeads?.count ?? 0, stale: stale.length, drafted: drafted.length, notified };
    } finally {
      this.scanning = false;
      await this.setAgentStatus("idle");
    }
  }

  // ───────────────────────────── events ─────────────────────────────

  private async onProposalSent(payload: Record<string, unknown>): Promise<void> {
    const proposalId = typeof payload.proposalId === "string" ? payload.proposalId : null;
    const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
    if (!proposalId) return;

    const [proposal] = await db.select().from(proposalsTable).where(eq(proposalsTable.id, proposalId)).limit(1);
    if (!proposal) return;

    const now = new Date();
    if (!proposal.sentAt) {
      await db.update(proposalsTable).set({ sentAt: now, updatedAt: now }).where(eq(proposalsTable.id, proposalId));
    }

    let lead: Lead | null = null;
    if (leadId) {
      [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
      if (lead) {
        await db
          .update(leadsTable)
          .set({ status: "proposal", lastContactedAt: now, updatedAt: now })
          .where(eq(leadsTable.id, leadId));
      }
    }

    const dueDate = proposalFollowUpDueDate(now);
    await db.insert(tasksTable).values({
      title: `Follow up on proposal: ${proposal.title}${lead ? ` (${lead.name})` : ""}`,
      description: `Proposal "${proposal.title}"${proposal.value ? ` worth ${money(Number(proposal.value))}` : ""} was sent on ${now.toLocaleDateString("en-US")}. If there's no reply by the due date, send the follow-up the Sales agent drafts for you.`,
      priority: "high",
      status: "todo",
      dueDate,
    });

    await createOperationalNotification({
      type: "info",
      title: `Proposal sent: ${proposal.title}`,
      body: `Follow-up reminder set for ${dueDate.toLocaleDateString("en-US")}.${lead ? ` ${lead.name} moved to "Proposal sent".` : ""}`,
      priority: "medium",
      actionUrl: leadId ? `/leads/${leadId}` : "/sales",
      metadata: { source: "sales-agent", proposalId, leadId },
    });

    await logActivity({
      entityType: "proposal",
      entityId: proposalId,
      action: "follow_up_scheduled",
      actorType: "agent",
      actorName: SALES_AGENT_NAME,
      details: { departmentId: await this.getSalesDepartmentId(), title: proposal.title, dueDate: dueDate.toISOString() },
    });

    this.briefCache = null;
  }

  private async onLeadCreated(payload: Record<string, unknown>): Promise<void> {
    const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
    if (!leadId) return;
    await this.scoreLead(leadId);
    this.briefCache = null;
  }

  /** Give a new lead a 0–100 score so the pipeline sorts itself. */
  async scoreLead(leadId: string): Promise<number> {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
    if (!lead) throw new Error("Lead not found");

    let score = heuristicScore(lead);
    let rationale = "Heuristic score (AI unavailable).";

    try {
      const profile = await memoryService.getFounderProfile().catch(() => null);
      const result = await callAI(
        [
          {
            role: "system",
            content: `You are the Sales agent for a solo founder. Score how promising a new lead is from 0 (dead) to 100 (ready to close). Consider deal value, source quality, company presence, and notes. ${profile ? `Founder context: ${profile}` : ""}
Respond with JSON only: {"score": number, "rationale": "one short sentence"}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              name: lead.name,
              company: lead.company,
              email: lead.email,
              source: lead.source,
              estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null,
              notes: lead.notes,
            }),
          },
        ],
        { jsonMode: true },
      );
      if (result.error) throw new Error(result.error);
      const parsed = JSON.parse(result.reply) as { score?: unknown; rationale?: unknown };
      const normalized = normalizeScore(parsed.score);
      if (normalized !== null) {
        score = normalized;
        rationale = typeof parsed.rationale === "string" ? parsed.rationale : rationale;
      }
    } catch (err) {
      logger.warn({ err, leadId }, "AI lead scoring failed, keeping heuristic score");
    }

    await db.update(leadsTable).set({ score, updatedAt: new Date() }).where(eq(leadsTable.id, leadId));
    await logActivity({
      entityType: "lead",
      entityId: leadId,
      action: "scored",
      actorType: "agent",
      actorName: SALES_AGENT_NAME,
      details: { departmentId: await this.getSalesDepartmentId(), leadName: lead.name, score, rationale },
    });
    return score;
  }

  // ───────────────────────────── brief ─────────────────────────────

  async getBrief(force = false): Promise<PipelineBrief> {
    if (!force && this.briefCache && Date.now() - this.briefCache.at < BRIEF_TTL_MS) {
      return { ...this.briefCache.brief, cached: true };
    }

    const [snapshot, stale, drafts] = await Promise.all([
      this.getPipelineSnapshot(),
      this.listStaleDeals(),
      this.listFollowUps("draft"),
    ]);

    const atRiskValue = stale.reduce((n, d) => n + (d.lead.estimatedValue ?? 0), 0);
    const fallback = this.deterministicBrief(snapshot, stale, drafts);

    let brief: PipelineBrief = {
      generatedAt: new Date().toISOString(),
      summary: fallback.summary,
      actions: fallback.actions,
      risks: fallback.risks,
      openValue: snapshot.openValue,
      atRiskValue,
      atRiskCount: stale.length,
      cached: false,
    };

    if (snapshot.openCount > 0) {
      try {
        const result = await callAI(
          [
            {
              role: "system",
              content: `You are the Sales agent for a solo founder. Write a tight pipeline brief. Be specific: name leads, amounts, and days silent. No fluff.
Respond with JSON only:
{"summary": "2-3 sentences on pipeline state", "actions": ["3 concrete things to do today, each naming a lead"], "risks": ["0-3 specific risks"]}`,
            },
            {
              role: "user",
              content: JSON.stringify({
                pipeline: snapshot,
                staleDeals: stale.map((d) => ({
                  name: d.lead.name,
                  company: d.lead.company,
                  stage: d.stageLabel,
                  daysSilent: d.daysSilent,
                  value: d.lead.estimatedValue,
                  severity: d.severity,
                  hasDraft: Boolean(d.openDraftId),
                })),
                draftsReady: drafts.map((d) => ({ lead: d.leadName, subject: d.subject })),
              }),
            },
          ],
          { jsonMode: true },
        );
        if (result.error) throw new Error(result.error);
        const parsed = JSON.parse(result.reply) as { summary?: string; actions?: string[]; risks?: string[] };
        brief = {
          ...brief,
          summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary : brief.summary,
          actions: Array.isArray(parsed.actions) && parsed.actions.length ? parsed.actions.slice(0, 3) : brief.actions,
          risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3) : brief.risks,
        };
      } catch (err) {
        logger.warn({ err }, "AI pipeline brief failed, using deterministic brief");
      }
    }

    this.briefCache = { at: Date.now(), brief };
    return brief;
  }

  private deterministicBrief(
    snapshot: PipelineSnapshot,
    stale: StaleDeal[],
    drafts: FollowUpWithLead[],
  ): { summary: string; actions: string[]; risks: string[] } {
    if (snapshot.openCount === 0) {
      return {
        summary: "Your pipeline is empty. Add your first lead and the Sales agent will start watching it for you.",
        actions: ["Add a lead from the Leads page or tell the EA Desk about someone you met."],
        risks: [],
      };
    }
    const atRiskValue = stale.reduce((n, d) => n + (d.lead.estimatedValue ?? 0), 0);
    const summary = `${snapshot.openCount} open deal${snapshot.openCount === 1 ? "" : "s"} worth ${money(snapshot.openValue)}. ${
      stale.length
        ? `${stale.length} ${stale.length === 1 ? "has" : "have"} gone quiet (${money(atRiskValue)} at risk).`
        : "Nothing has gone quiet."
    }`;
    const actions = stale.slice(0, 3).map(
      (d) => `Follow up with ${d.lead.name}${d.lead.company ? ` (${d.lead.company})` : ""} — ${d.daysSilent} days silent in ${d.stageLabel}.`,
    );
    if (actions.length === 0 && drafts.length) actions.push(`Send the ${drafts.length} ready follow-up draft${drafts.length === 1 ? "" : "s"}.`);
    if (actions.length === 0) actions.push("Pipeline is healthy. Add new leads to keep it moving.");
    const risks = stale.filter((d) => d.severity === "critical").map((d) => `${d.lead.name} is ${d.daysSilent} days silent and likely cooling off.`);
    return { summary, actions, risks: risks.slice(0, 3) };
  }

  /** Used by the EA Desk when the founder asks about the pipeline. */
  async answerQuestion(message: string): Promise<string> {
    const [snapshot, stale, drafts, founderName] = await Promise.all([
      this.getPipelineSnapshot(),
      this.listStaleDeals(),
      this.listFollowUps("draft"),
      getFounderName(),
    ]);
    const fallback = this.deterministicBrief(snapshot, stale, drafts);

    try {
      const result = await callAI([
        {
          role: "system",
          content: `You are ${founderName ? `${founderName}'s` : "the founder's"} Sales agent. Answer the founder's question using ONLY the pipeline data provided. Be specific with names, amounts, and days. 1–4 short sentences, plain text, no lists. If drafts are ready, mention they are waiting in the Sales Desk.`,
        },
        {
          role: "user",
          content: `Pipeline data:\n${JSON.stringify({
            pipeline: snapshot,
            staleDeals: stale.map((d) => ({
              name: d.lead.name,
              company: d.lead.company,
              stage: d.stageLabel,
              daysSilent: d.daysSilent,
              value: d.lead.estimatedValue,
              severity: d.severity,
            })),
            draftsReady: drafts.map((d) => ({ lead: d.leadName, subject: d.subject })),
          })}\n\nQuestion: ${message}`,
        },
      ]);
      if (result.error) throw new Error(result.error);
      return result.reply.trim() || fallback.summary;
    } catch (err) {
      logger.warn({ err }, "Sales question answer failed, using deterministic summary");
      return `${fallback.summary} ${fallback.actions[0] ?? ""}`.trim();
    }
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async generateDraft(params: {
    lead: Lead;
    proposals: Array<typeof proposalsTable.$inferSelect>;
    daysSilent: number;
    reason: string;
  }): Promise<{ subject: string; body: string }> {
    const { lead, proposals, daysSilent, reason } = params;
    const firstName = lead.name.split(/\s+/)[0] ?? lead.name;
    const latestProposal = proposals[0];
    const founderName = await getFounderName();
    const signOff = founderName ? `Best,\n${founderName}` : "Best,";

    const fallback = {
      subject: latestProposal ? `Re: ${latestProposal.title}` : `Quick check-in${lead.company ? ` — ${lead.company}` : ""}`,
      body: latestProposal
        ? `Hi ${firstName},\n\nI wanted to check in on the proposal I sent over (${latestProposal.title}). Happy to walk through any questions or adjust the scope if something isn't quite right.\n\nWould a quick 15-minute call this week help?\n\n${signOff}`
        : `Hi ${firstName},\n\nIt's been a little while since we last spoke, so I wanted to check in. Is this still something you're exploring${lead.company ? ` at ${lead.company}` : ""}?\n\nIf the timing isn't right, no problem at all — just let me know and I'll follow up later.\n\n${signOff}`,
    };

    try {
      const profile = await memoryService.getFounderProfile().catch(() => null);
      const result = await callAI(
        [
          {
            role: "system",
            content: `You are the Sales agent for ${founderName ?? "a solo founder"}. Write a short, human follow-up email to a lead that has gone quiet. Rules:
- 60–120 words, plain text, no markdown, no placeholders like [Name].
- Warm and direct, never pushy or salesy. One clear ask (a reply or a short call).
- Reference the stage and context naturally. If a proposal was sent, reference it by title.
- ${founderName ? `Sign off as ${founderName}.` : 'Sign off with "Best," and no name.'}
${profile ? `Founder context: ${profile}` : ""}
Respond with JSON only: {"subject": "...", "body": "..."}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              lead: {
                name: lead.name,
                company: lead.company,
                stage: STAGE_LABELS[lead.status] ?? lead.status,
                source: lead.source,
                estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null,
                notes: lead.notes,
                sentiment: lead.sentiment,
              },
              daysSilent,
              reason,
              proposals: proposals.map((p) => ({
                title: p.title,
                status: p.status,
                value: p.value ? Number(p.value) : null,
                sentAt: p.sentAt,
              })),
            }),
          },
        ],
        { jsonMode: true },
      );
      if (result.error) throw new Error(result.error);
      const parsed = JSON.parse(result.reply) as { subject?: string; body?: string };
      if (typeof parsed.subject === "string" && typeof parsed.body === "string" && parsed.body.trim()) {
        return { subject: parsed.subject.trim(), body: parsed.body.trim() };
      }
      return fallback;
    } catch (err) {
      logger.warn({ err, leadId: lead.id }, "AI follow-up draft failed, using template");
      return fallback;
    }
  }

  private async getSalesDepartmentId(): Promise<string | null> {
    if (this.salesDepartmentId !== undefined) return this.salesDepartmentId;
    const [dept] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(eq(departmentsTable.slug, "sales")).limit(1);
    this.salesDepartmentId = dept?.id ?? null;
    return this.salesDepartmentId;
  }

  private async setAgentStatus(status: "busy" | "idle"): Promise<void> {
    try {
      await db
        .update(agentsTable)
        .set({ status, lastActiveAt: new Date() })
        .where(eq(agentsTable.slug, SALES_AGENT_SLUG));
    } catch (err) {
      logger.warn({ err }, "Failed to update sales agent status");
    }
  }
}

export const salesAgent = new SalesAgent();
