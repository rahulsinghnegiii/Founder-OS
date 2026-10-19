import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, followUpsTable, leadsTable, proposalsTable } from "@workspace/db";
import { salesAgent, type FollowUpWithLead, type StaleDeal } from "../services/sales-agent";
import { STAGE_LABELS, assessStaleness, daysBetween, lastTouch, money } from "../services/sales-rules";
import { logActivity } from "../lib/activity-logger";
import { publishOperationalEvent } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { GmailSyncError, gmailSync } from "../services/gmail-sync";

/**
 * FounderOS MCP server.
 *
 * Exposes the Sales department to MCP clients (ChatGPT, Claude, Cursor). The
 * `search` and `fetch` tools follow the shape ChatGPT expects for connectors;
 * the `founderos_*` tools cover the pipeline workflow end to end.
 */

export const MCP_SERVER_NAME = "founderos-mcp-server";
export const MCP_SERVER_VERSION = "1.0.0";

/** Kept in sync with the registrations below; a unit test enforces it. */
export const MCP_TOOL_NAMES = [
  "search",
  "fetch",
  "founderos_get_pipeline",
  "founderos_list_stale_deals",
  "founderos_list_leads",
  "founderos_get_lead",
  "founderos_list_follow_up_drafts",
  "founderos_create_lead",
  "founderos_update_lead_stage",
  "founderos_log_contact",
  "founderos_draft_follow_up",
  "founderos_mark_follow_up_sent",
  "founderos_scan_pipeline",
  "founderos_sync_gmail",
] as const;

export const MCP_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "founderos_create_lead",
  "founderos_update_lead_stage",
  "founderos_log_contact",
  "founderos_draft_follow_up",
  "founderos_mark_follow_up_sent",
  "founderos_scan_pipeline",
  "founderos_sync_gmail",
]);

const INSTRUCTIONS = `FounderOS is a self-hosted AI sales assistant for a solo founder. Use these tools to answer questions about the founder's sales pipeline and to act on it.

Typical flow: call founderos_get_pipeline or founderos_list_stale_deals to see what needs attention, founderos_draft_follow_up to write an email for a quiet deal, then the founder sends it from their own inbox and you call founderos_mark_follow_up_sent. FounderOS never sends email itself.

If the founder has connected Gmail, founderos_sync_gmail updates last-contact dates from email headers (never bodies), so you rarely need founderos_log_contact for email.

Tools that take a "lead" accept either the lead id or the lead's name. Money values are USD. A deal is "going quiet" when it has had no contact for longer than its stage allows (new 3 days, contacted 5, qualified 7, proposal 4) and "critical" at double that.`;

const CHARACTER_LIMIT = 25_000;
const MCP_ACTOR = "MCP client";
const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const WRITE_IDEMPOTENT = { ...WRITE, idempotentHint: true } as const;

type LeadRow = typeof leadsTable.$inferSelect;
type ProposalRow = typeof proposalsTable.$inferSelect;
type FollowUpRow = typeof followUpsTable.$inferSelect;

/** Expected, user-facing failures (bad id, ambiguous name). Not logged as server errors. */
class ToolError extends Error {}

// ───────────────────────────── result helpers ─────────────────────────────

function textResult(text: string, data?: Record<string, unknown>): CallToolResult {
  const body =
    text.length > CHARACTER_LIMIT
      ? `${text.slice(0, CHARACTER_LIMIT)}\n\n[Truncated. Narrow the request with filters or pagination.]`
      : text;
  return data ? { content: [{ type: "text", text: body }], structuredContent: data } : { content: [{ type: "text", text: body }] };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

async function run(tool: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ToolError) return errorResult(err.message);
    logger.error({ err, tool }, "MCP tool failed");
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(/not found/i.test(message) ? `${message}. Check the id with founderos_list_leads.` : message);
  }
}

// ───────────────────────────── views ─────────────────────────────

function iso(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function appendNote(existing: string | null, note: string): string {
  const stamped = `[${new Date().toISOString().slice(0, 10)}] ${note.trim()}`;
  return existing?.trim() ? `${existing.trimEnd()}\n\n${stamped}` : stamped;
}

function leadView(lead: LeadRow, baseUrl: string, now = new Date()) {
  const staleness = assessStaleness(lead, now);
  return {
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    stage: STAGE_LABELS[lead.status] ?? lead.status,
    score: lead.score,
    sentiment: lead.sentiment,
    estimatedValue: lead.estimatedValue == null ? null : Number(lead.estimatedValue),
    source: lead.source,
    notes: lead.notes,
    lastContactedAt: iso(lead.lastContactedAt),
    createdAt: iso(lead.createdAt),
    daysSinceLastTouch: daysBetween(lastTouch(lead), now),
    goingQuiet: staleness
      ? { severity: staleness.severity, daysSilent: staleness.daysSilent, limitDays: staleness.threshold }
      : null,
    url: `${baseUrl}/leads/${lead.id}`,
  };
}
type LeadView = ReturnType<typeof leadView>;

function leadLine(l: LeadView): string {
  const bits = [
    l.stage,
    l.estimatedValue != null ? money(l.estimatedValue) : "no value set",
    `score ${l.score}`,
    `last touch ${l.daysSinceLastTouch}d ago`,
  ];
  if (l.goingQuiet) bits.push(l.goingQuiet.severity === "critical" ? "CRITICAL: going cold" : "going quiet");
  return `- **${l.name}**${l.company ? ` (${l.company})` : ""} · ${bits.join(" · ")} · id \`${l.id}\``;
}

function staleView(d: StaleDeal, baseUrl: string) {
  return {
    leadId: d.lead.id,
    name: d.lead.name,
    company: d.lead.company,
    stage: d.stageLabel,
    daysSilent: d.daysSilent,
    limitDays: d.threshold,
    severity: d.severity,
    estimatedValue: d.lead.estimatedValue,
    draftReady: Boolean(d.openDraftId),
    draftId: d.openDraftId,
    url: `${baseUrl}/leads/${d.lead.id}`,
  };
}

function followUpView(f: FollowUpWithLead | (FollowUpRow & { leadName?: string }), baseUrl: string) {
  return {
    id: f.id,
    leadId: f.leadId,
    leadName: "leadName" in f ? f.leadName : undefined,
    leadEmail: "leadEmail" in f ? f.leadEmail : undefined,
    reason: f.reason,
    subject: f.subject,
    body: f.body,
    status: f.status,
    daysSilent: f.daysSilent,
    createdAt: iso(f.createdAt),
    sentAt: iso(f.sentAt),
    url: `${baseUrl}/leads/${f.leadId}`,
  };
}

function proposalView(p: ProposalRow) {
  return {
    id: p.id,
    leadId: p.leadId,
    title: p.title,
    status: p.status,
    value: p.value == null ? null : Number(p.value),
    sentAt: iso(p.sentAt),
    responseAt: iso(p.responseAt),
    createdAt: iso(p.createdAt),
  };
}

// ───────────────────────────── data access ─────────────────────────────

/** Find a lead by id, exact name, or unique partial name. */
async function resolveLead(ref: string): Promise<LeadRow> {
  const key = ref.trim();
  if (!key) throw new ToolError("Provide a lead id or name.");

  const [byId] = await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.id, key), isNull(leadsTable.deletedAt)))
    .limit(1);
  if (byId) return byId;

  const pick = async (pattern: string): Promise<LeadRow | null> => {
    const matches = await db
      .select()
      .from(leadsTable)
      .where(and(isNull(leadsTable.deletedAt), ilike(leadsTable.name, pattern)))
      .limit(6);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const list = matches.slice(0, 5).map((l) => `${l.name}${l.company ? ` (${l.company})` : ""} id ${l.id}`).join("; ");
      throw new ToolError(`"${key}" matches several leads: ${list}. Pass the lead id instead.`);
    }
    return null;
  };

  const lead = (await pick(escapeLike(key))) ?? (await pick(`%${escapeLike(key)}%`));
  if (lead) return lead;
  throw new ToolError(`No lead matches "${key}". Use founderos_list_leads with a query to find it.`);
}

async function proposalsForLead(leadId: string): Promise<ProposalRow[]> {
  return db.select().from(proposalsTable).where(eq(proposalsTable.leadId, leadId)).orderBy(desc(proposalsTable.createdAt));
}

async function searchRecords(query: string, baseUrl: string, limit: number) {
  const pattern = `%${escapeLike(query.trim())}%`;

  const leads = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        isNull(leadsTable.deletedAt),
        or(
          ilike(leadsTable.name, pattern),
          ilike(leadsTable.company, pattern),
          ilike(leadsTable.email, pattern),
          ilike(leadsTable.notes, pattern),
          ilike(leadsTable.source, pattern),
        ),
      ),
    )
    .orderBy(desc(leadsTable.updatedAt))
    .limit(limit);

  const proposals = await db
    .select({ proposal: proposalsTable, leadName: leadsTable.name, leadCompany: leadsTable.company })
    .from(proposalsTable)
    .leftJoin(leadsTable, eq(proposalsTable.leadId, leadsTable.id))
    .where(
      or(
        ilike(proposalsTable.title, pattern),
        ilike(proposalsTable.content, pattern),
        ilike(leadsTable.name, pattern),
        ilike(leadsTable.company, pattern),
      ),
    )
    .orderBy(desc(proposalsTable.createdAt))
    .limit(limit);

  return [
    ...leads.map((l) => ({
      id: `lead:${l.id}`,
      title: `Lead: ${l.name}${l.company ? `, ${l.company}` : ""} (${STAGE_LABELS[l.status] ?? l.status})`,
      url: `${baseUrl}/leads/${l.id}`,
    })),
    ...proposals.map(({ proposal, leadName, leadCompany }) => ({
      id: `proposal:${proposal.id}`,
      title: `Proposal: ${proposal.title}${leadName ? ` for ${leadName}${leadCompany ? `, ${leadCompany}` : ""}` : ""} (${proposal.status})`,
      url: proposal.leadId ? `${baseUrl}/leads/${proposal.leadId}` : `${baseUrl}/sales`,
    })),
  ].slice(0, limit);
}

function leadDocument(lead: LeadView, proposals: ProposalRow[], followUps: FollowUpRow[]): string {
  const lines = [
    `# ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
    "",
    `- Stage: ${lead.stage}`,
    `- Estimated value: ${lead.estimatedValue != null ? money(lead.estimatedValue) : "not set"}`,
    `- Score: ${lead.score}/100${lead.sentiment ? ` · sentiment ${lead.sentiment}` : ""}`,
    `- Email: ${lead.email ?? "none"} · Phone: ${lead.phone ?? "none"}`,
    `- Source: ${lead.source ?? "unknown"}`,
    `- Last touch: ${lead.daysSinceLastTouch} days ago${lead.lastContactedAt ? ` (${lead.lastContactedAt.slice(0, 10)})` : " (never contacted)"}`,
    `- Going quiet: ${lead.goingQuiet ? `${lead.goingQuiet.severity}, ${lead.goingQuiet.daysSilent} days silent (limit ${lead.goingQuiet.limitDays})` : "no"}`,
    `- Lead id: ${lead.id}`,
  ];
  if (lead.notes) lines.push("", "## Notes", lead.notes);
  if (proposals.length) {
    lines.push("", "## Proposals");
    for (const p of proposals) {
      lines.push(`- ${p.title} · ${p.status}${p.value ? ` · ${money(Number(p.value))}` : ""}${p.sentAt ? ` · sent ${iso(p.sentAt)!.slice(0, 10)}` : ""}`);
    }
  }
  if (followUps.length) {
    lines.push("", "## Follow-ups");
    for (const f of followUps.slice(0, 5)) {
      lines.push(`- [${f.status}] ${f.subject} (${iso(f.createdAt)!.slice(0, 10)}) · id ${f.id}`);
      if (f.status === "draft") lines.push("", f.body, "");
    }
  }
  return lines.join("\n");
}

// ───────────────────────────── server ─────────────────────────────

export function createFounderOsMcpServer(options: { baseUrl: string }): McpServer {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { instructions: INSTRUCTIONS });

  // ── search / fetch: the shape ChatGPT connectors and deep research expect ──

  server.registerTool(
    "search",
    {
      title: "Search FounderOS",
      description:
        "Search the founder's leads and proposals by name, company, email, notes, source, or proposal title. Returns up to 20 results as JSON {results: [{id, title, url}]}. Pass a result id to the fetch tool for the full record. Example queries: \"Nimbus\", \"warehouse pilot\", \"referral\".",
      inputSchema: {
        query: z.string().min(1).max(200).describe("Text to match against leads and proposals."),
      },
      annotations: READ_ONLY,
    },
    async ({ query }) =>
      run("search", async () => {
        const results = await searchRecords(query, baseUrl, 20);
        const payload = { results };
        return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
      }),
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch FounderOS record",
      description:
        'Fetch the full text of a record returned by search. Ids look like "lead:<uuid>" or "proposal:<uuid>"; a bare id is treated as a lead. Returns JSON {id, title, text, url, metadata}.',
      inputSchema: {
        id: z.string().min(1).max(200).describe('Record id from search, e.g. "lead:8f0c...".'),
      },
      annotations: READ_ONLY,
    },
    async ({ id }) =>
      run("fetch", async () => {
        const [kind, rawId] = id.includes(":") ? (id.split(/:(.+)/, 2) as [string, string]) : ["lead", id];

        if (kind === "proposal") {
          const [row] = await db
            .select({ proposal: proposalsTable, lead: leadsTable })
            .from(proposalsTable)
            .leftJoin(leadsTable, eq(proposalsTable.leadId, leadsTable.id))
            .where(eq(proposalsTable.id, rawId))
            .limit(1);
          if (!row) throw new ToolError(`No proposal with id ${rawId}. Use search to find it.`);
          const p = row.proposal;
          const text = [
            `# Proposal: ${p.title}`,
            "",
            `- Status: ${p.status}`,
            `- Value: ${p.value ? money(Number(p.value)) : "not set"}`,
            `- Lead: ${row.lead ? `${row.lead.name}${row.lead.company ? ` (${row.lead.company})` : ""}, id ${row.lead.id}` : "none"}`,
            `- Sent: ${p.sentAt ? iso(p.sentAt)!.slice(0, 10) : "not sent"} · Response: ${p.responseAt ? iso(p.responseAt)!.slice(0, 10) : "none yet"}`,
            ...(p.content ? ["", "## Content", p.content] : []),
          ].join("\n");
          const doc = {
            id: `proposal:${p.id}`,
            title: p.title,
            text,
            url: p.leadId ? `${baseUrl}/leads/${p.leadId}` : `${baseUrl}/sales`,
            metadata: { type: "proposal", status: p.status, leadId: p.leadId ?? "" },
          };
          return { content: [{ type: "text", text: JSON.stringify(doc) }], structuredContent: doc };
        }

        if (kind !== "lead") throw new ToolError(`Unknown record type "${kind}". Ids start with "lead:" or "proposal:".`);
        const lead = await resolveLead(rawId);
        const view = leadView(lead, baseUrl);
        const [proposals, followUps] = await Promise.all([proposalsForLead(lead.id), salesAgent.listFollowUpsForLead(lead.id)]);
        const doc = {
          id: `lead:${lead.id}`,
          title: `${lead.name}${lead.company ? `, ${lead.company}` : ""}`,
          text: leadDocument(view, proposals, followUps),
          url: view.url,
          metadata: { type: "lead", stage: view.stage, score: String(view.score) },
        };
        return { content: [{ type: "text", text: JSON.stringify(doc) }], structuredContent: doc };
      }),
  );

  // ── read: pipeline ──

  server.registerTool(
    "founderos_get_pipeline",
    {
      title: "Get pipeline overview",
      description:
        "Overview of the sales pipeline: open deal count and value per stage, won and lost totals, value at risk from deals going quiet, follow-up drafts waiting, and the Sales agent's brief with today's suggested moves. Start here for questions like \"how is my pipeline?\" or \"what should I do today?\". It returns at once with the cached AI brief, or a rule-based brief while a fresh AI brief is written in the background; set refresh_brief to wait for a new AI brief (slower).",
      inputSchema: {
        refresh_brief: z.boolean().default(false).describe("Regenerate the AI brief instead of using the cached one."),
      },
      annotations: READ_ONLY,
    },
    async ({ refresh_brief }) =>
      run("founderos_get_pipeline", async () => {
        const [snapshot, brief, stale, drafts] = await Promise.all([
          salesAgent.getPipelineSnapshot(),
          refresh_brief ? salesAgent.getBrief(true) : salesAgent.getBriefFast(),
          salesAgent.listStaleDeals(),
          salesAgent.listFollowUps("draft"),
        ]);
        const data = {
          openDeals: snapshot.openCount,
          openValue: snapshot.openValue,
          wonDeals: snapshot.wonCount,
          wonValue: snapshot.wonValue,
          lostDeals: snapshot.lostCount,
          stages: snapshot.stages,
          atRiskValue: brief.atRiskValue,
          goingQuiet: stale.map((d) => staleView(d, baseUrl)),
          draftsReady: drafts.length,
          brief: { summary: brief.summary, actions: brief.actions, risks: brief.risks, generatedAt: brief.generatedAt },
          url: `${baseUrl}/sales`,
        };
        const lines = [
          "# Pipeline",
          "",
          brief.summary,
          "",
          `Open: ${snapshot.openCount} deals, ${money(snapshot.openValue)} · Won: ${snapshot.wonCount} (${money(snapshot.wonValue)}) · Lost: ${snapshot.lostCount}`,
          `At risk: ${money(brief.atRiskValue)} across ${stale.length} quiet deal${stale.length === 1 ? "" : "s"} · Drafts ready: ${drafts.length}`,
          "",
          "## By stage",
          ...snapshot.stages.map((s) => `- ${s.label}: ${s.count} (${money(s.value)})`),
          "",
          "## Today's moves",
          ...brief.actions.map((a, i) => `${i + 1}. ${a}`),
        ];
        if (brief.risks.length) lines.push("", "## Risks", ...brief.risks.map((r) => `- ${r}`));
        return textResult(lines.join("\n"), data);
      }),
  );

  server.registerTool(
    "founderos_list_stale_deals",
    {
      title: "List deals going quiet",
      description:
        "Open deals that have gone longer without contact than their stage allows, most urgent first (critical, then by value). Each entry says whether a follow-up draft is already waiting. Use this for \"who should I follow up with?\" or \"which deals are at risk?\".",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run("founderos_list_stale_deals", async () => {
        const deals = (await salesAgent.listStaleDeals()).map((d) => staleView(d, baseUrl));
        if (deals.length === 0) {
          return textResult("No deals are going quiet. Every open deal has been touched within its stage's limit.", { deals: [] });
        }
        const lines = [
          `# ${deals.length} deal${deals.length === 1 ? "" : "s"} going quiet`,
          "",
          ...deals.map(
            (d) =>
              `- **${d.name}**${d.company ? ` (${d.company})` : ""} · ${d.stage} · ${d.estimatedValue != null ? money(d.estimatedValue) : "no value"} · ${d.daysSilent}d silent (limit ${d.limitDays}) · ${d.severity}${d.draftReady ? ` · draft ready \`${d.draftId}\`` : " · no draft yet"} · lead id \`${d.leadId}\``,
          ),
        ];
        return textResult(lines.join("\n"), { deals });
      }),
  );

  server.registerTool(
    "founderos_list_leads",
    {
      title: "List leads",
      description:
        "List leads with optional filters. Filter by stage status, by text (matches name, company, email, notes), and sort by recent, value, score, or silence (longest without contact first). Paginated with limit and offset; the response says whether more results exist.",
      inputSchema: {
        status: z.enum(LEAD_STATUSES).optional().describe("Only leads in this stage."),
        query: z.string().max(200).optional().describe("Text to match against name, company, email, and notes."),
        sort: z.enum(["recent", "value", "score", "silence"]).default("recent").describe("Sort order."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum leads to return."),
        offset: z.number().int().min(0).default(0).describe("Leads to skip, for pagination."),
      },
      annotations: READ_ONLY,
    },
    async ({ status, query, sort, limit, offset }) =>
      run("founderos_list_leads", async () => {
        const conditions = [isNull(leadsTable.deletedAt)];
        if (status) conditions.push(eq(leadsTable.status, status));
        if (query?.trim()) {
          const pattern = `%${escapeLike(query.trim())}%`;
          const textMatch = or(
            ilike(leadsTable.name, pattern),
            ilike(leadsTable.company, pattern),
            ilike(leadsTable.email, pattern),
            ilike(leadsTable.notes, pattern),
          );
          if (textMatch) conditions.push(textMatch);
        }
        const where = and(...conditions);
        const order =
          sort === "value"
            ? sql`${leadsTable.estimatedValue} desc nulls last`
            : sort === "score"
              ? desc(leadsTable.score)
              : sort === "silence"
                ? asc(sql`coalesce(${leadsTable.lastContactedAt}, ${leadsTable.createdAt})`)
                : desc(leadsTable.createdAt);

        const [[{ total }], rows] = await Promise.all([
          db.select({ total: sql<number>`count(*)::int` }).from(leadsTable).where(where),
          db.select().from(leadsTable).where(where).orderBy(order).limit(limit).offset(offset),
        ]);
        const leads = rows.map((l) => leadView(l, baseUrl));
        const hasMore = total > offset + leads.length;
        const data = { total, count: leads.length, offset, hasMore, nextOffset: hasMore ? offset + leads.length : null, leads };
        if (leads.length === 0) {
          return textResult(
            total === 0 ? "No leads match. Try a broader query or no status filter." : `No leads at offset ${offset}; there are ${total} in total.`,
            data,
          );
        }
        const lines = [
          `# Leads (${offset + 1}–${offset + leads.length} of ${total})`,
          "",
          ...leads.map(leadLine),
          ...(hasMore ? ["", `More available: call again with offset ${offset + leads.length}.`] : []),
        ];
        return textResult(lines.join("\n"), data);
      }),
  );

  server.registerTool(
    "founderos_get_lead",
    {
      title: "Get lead details",
      description:
        "Everything about one lead: contact details, stage, value, score, notes, how long since last contact, whether it is going quiet, its proposals, and its follow-up history including any draft waiting to be sent.",
      inputSchema: {
        lead: z.string().min(1).max(200).describe("Lead id, or the lead's name (partial names work if unique)."),
      },
      annotations: READ_ONLY,
    },
    async ({ lead }) =>
      run("founderos_get_lead", async () => {
        const row = await resolveLead(lead);
        const view = leadView(row, baseUrl);
        const [proposals, followUps] = await Promise.all([proposalsForLead(row.id), salesAgent.listFollowUpsForLead(row.id)]);
        return textResult(leadDocument(view, proposals, followUps), {
          lead: view,
          proposals: proposals.map(proposalView),
          followUps: followUps.map((f) => followUpView(f, baseUrl)),
        });
      }),
  );

  server.registerTool(
    "founderos_list_follow_up_drafts",
    {
      title: "List follow-up drafts",
      description:
        "Follow-up emails the Sales agent has drafted and that are waiting for the founder to send, newest first, with subject, body, recipient, and the reason it was written.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum drafts to return."),
      },
      annotations: READ_ONLY,
    },
    async ({ limit }) =>
      run("founderos_list_follow_up_drafts", async () => {
        const drafts = (await salesAgent.listFollowUps("draft")).slice(0, limit).map((f) => followUpView(f, baseUrl));
        if (drafts.length === 0) {
          return textResult("No follow-up drafts are waiting. Use founderos_draft_follow_up to write one.", { drafts: [] });
        }
        const lines = [`# ${drafts.length} draft${drafts.length === 1 ? "" : "s"} ready`, ""];
        for (const d of drafts) {
          lines.push(`## ${d.leadName}${d.leadEmail ? ` <${d.leadEmail}>` : ""}`, `Reason: ${d.reason} · draft id \`${d.id}\``, `Subject: ${d.subject}`, "", d.body, "");
        }
        return textResult(lines.join("\n"), { drafts });
      }),
  );

  // ── write ──

  server.registerTool(
    "founderos_create_lead",
    {
      title: "Create lead",
      description:
        "Add a new lead to the pipeline. The Sales agent scores it automatically a few seconds later. Refuses to create a duplicate when a lead with the same email already exists.",
      inputSchema: {
        name: z.string().min(1).max(200).describe("Person's full name."),
        company: z.string().max(200).optional().describe("Company name."),
        email: z.string().max(320).optional().describe("Email address."),
        phone: z.string().max(50).optional().describe("Phone number."),
        source: z.string().max(100).optional().describe('Where the lead came from, e.g. "referral", "inbound", "conference".'),
        estimated_value: z.number().min(0).optional().describe("Expected deal value in USD."),
        notes: z.string().max(5000).optional().describe("Context: needs, decision maker, timing."),
        status: z.enum(LEAD_STATUSES).default("new").describe("Starting stage."),
      },
      annotations: WRITE,
    },
    async (args) =>
      run("founderos_create_lead", async () => {
        const email = args.email?.trim() || null;
        if (email) {
          const [existing] = await db
            .select()
            .from(leadsTable)
            .where(and(isNull(leadsTable.deletedAt), ilike(leadsTable.email, escapeLike(email))))
            .limit(1);
          if (existing) {
            throw new ToolError(`A lead with email ${email} already exists: ${existing.name} (id ${existing.id}). Use founderos_get_lead instead.`);
          }
        }
        const [created] = await db
          .insert(leadsTable)
          .values({
            name: args.name.trim(),
            company: args.company?.trim() || null,
            email,
            phone: args.phone?.trim() || null,
            source: args.source?.trim() || null,
            notes: args.notes?.trim() || null,
            status: args.status,
            ...(args.estimated_value != null ? { estimatedValue: String(args.estimated_value) } : {}),
          })
          .returning();
        await logActivity({
          entityType: "lead",
          entityId: created.id,
          action: "created",
          actorType: "integration",
          actorName: MCP_ACTOR,
          details: { name: created.name, company: created.company, via: "mcp" },
        });
        publishOperationalEvent("lead.created", { leadId: created.id, name: created.name, company: created.company });
        const view = leadView(created, baseUrl);
        return textResult(`Created lead ${view.name}${view.company ? ` (${view.company})` : ""}, id \`${view.id}\`. It will be scored shortly.`, { lead: view });
      }),
  );

  server.registerTool(
    "founderos_update_lead_stage",
    {
      title: "Move lead to a stage",
      description:
        "Change a lead's pipeline stage (new, contacted, qualified, proposal, won, lost), optionally adding a dated note explaining why. Use for \"mark Priya as won\" or \"Omar went with a competitor\".",
      inputSchema: {
        lead: z.string().min(1).max(200).describe("Lead id, or the lead's name."),
        status: z.enum(LEAD_STATUSES).describe("New stage."),
        note: z.string().max(2000).optional().describe("Optional note appended to the lead's notes."),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ lead, status, note }) =>
      run("founderos_update_lead_stage", async () => {
        const row = await resolveLead(lead);
        if (row.status === status && !note) {
          return textResult(`${row.name} is already in ${STAGE_LABELS[status]}. Nothing changed.`, { lead: leadView(row, baseUrl) });
        }
        const [updated] = await db
          .update(leadsTable)
          .set({ status, notes: note ? appendNote(row.notes, note) : row.notes, updatedAt: new Date() })
          .where(eq(leadsTable.id, row.id))
          .returning();
        await logActivity({
          entityType: "lead",
          entityId: row.id,
          action: "stage_changed",
          actorType: "integration",
          actorName: MCP_ACTOR,
          details: { leadName: row.name, from: row.status, to: status, via: "mcp" },
        });
        if (status === "won" && row.status !== "won") publishOperationalEvent("lead.won", { leadId: row.id, name: row.name });
        return textResult(`Moved ${row.name} from ${STAGE_LABELS[row.status] ?? row.status} to ${STAGE_LABELS[status]}.`, {
          lead: leadView(updated, baseUrl),
        });
      }),
  );

  server.registerTool(
    "founderos_log_contact",
    {
      title: "Log contact with a lead",
      description:
        "Record that the founder just reached out to a lead (call, email, meeting). Resets the lead's silence clock and moves new leads to contacted. Optionally append a dated note about what was discussed.",
      inputSchema: {
        lead: z.string().min(1).max(200).describe("Lead id, or the lead's name."),
        note: z.string().max(2000).optional().describe("What happened, appended to the lead's notes."),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ lead, note }) =>
      run("founderos_log_contact", async () => {
        const row = await resolveLead(lead);
        await salesAgent.logContact(row.id);
        if (note) {
          await db.update(leadsTable).set({ notes: appendNote(row.notes, note), updatedAt: new Date() }).where(eq(leadsTable.id, row.id));
        }
        const [fresh] = await db.select().from(leadsTable).where(eq(leadsTable.id, row.id)).limit(1);
        return textResult(`Logged contact with ${row.name}. Silence clock reset; stage is ${STAGE_LABELS[fresh.status] ?? fresh.status}.`, {
          lead: leadView(fresh, baseUrl),
        });
      }),
  );

  server.registerTool(
    "founderos_draft_follow_up",
    {
      title: "Draft a follow-up email",
      description:
        "Have the Sales agent write a short follow-up email for a lead, using its notes, stage, and any proposal. Replaces any earlier unsent draft for that lead. FounderOS does not send it: show it to the founder, who sends it from their own inbox, then call founderos_mark_follow_up_sent with the returned draft id.",
      inputSchema: {
        lead: z.string().min(1).max(200).describe("Lead id, or the lead's name."),
        reason: z.string().max(500).optional().describe('Why we are following up, e.g. "asked for pricing last week". Defaults to how long it has been quiet.'),
      },
      annotations: WRITE,
    },
    async ({ lead, reason }) =>
      run("founderos_draft_follow_up", async () => {
        const row = await resolveLead(lead);
        const draft = await salesAgent.draftFollowUp(row.id, { reason, trigger: "mcp" });
        const view = { ...followUpView(draft, baseUrl), leadName: row.name, leadEmail: row.email };
        const text = [
          `Draft for ${row.name}${row.email ? ` <${row.email}>` : ""} (draft id \`${draft.id}\`)`,
          "",
          `Subject: ${draft.subject}`,
          "",
          draft.body,
          "",
          "Send it from your inbox, then mark it sent.",
        ].join("\n");
        return textResult(text, { draft: view });
      }),
  );

  server.registerTool(
    "founderos_mark_follow_up_sent",
    {
      title: "Mark follow-up as sent",
      description:
        "Record that the founder sent a drafted follow-up. Marks the draft sent, resets the lead's silence clock, and moves new leads to contacted. Does not send any email. Calling it again for the same draft changes nothing.",
      inputSchema: {
        follow_up_id: z.string().min(1).max(100).describe("Draft id from founderos_draft_follow_up or founderos_list_follow_up_drafts."),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ follow_up_id }) =>
      run("founderos_mark_follow_up_sent", async () => {
        const [existing] = await db.select().from(followUpsTable).where(eq(followUpsTable.id, follow_up_id.trim())).limit(1);
        if (!existing) throw new ToolError(`No follow-up with id ${follow_up_id}. Use founderos_list_follow_up_drafts to see waiting drafts.`);
        if (existing.status === "sent") {
          return textResult(`Already marked sent on ${iso(existing.sentAt)?.slice(0, 10) ?? "an earlier date"}. Nothing changed.`, {
            followUp: followUpView(existing, baseUrl),
          });
        }
        const updated = await salesAgent.markFollowUpSent(existing.id);
        return textResult(`Marked "${updated.subject}" as sent. The lead's silence clock is reset.`, { followUp: followUpView(updated, baseUrl) });
      }),
  );

  server.registerTool(
    "founderos_scan_pipeline",
    {
      title: "Scan pipeline now",
      description:
        "Run the Sales agent's scan immediately instead of waiting for the six-hourly schedule: find deals going quiet, draft a follow-up for each that lacks one, and notify the founder. Can take a while when many drafts are written.",
      inputSchema: {},
      annotations: WRITE,
    },
    async () =>
      run("founderos_scan_pipeline", async () => {
        const result = await salesAgent.runScan("manual");
        if (result.scanned === 0 && result.stale === 0 && result.drafted === 0) {
          return textResult("Scan found no open deals to check, or a scan is already running. Try again in a minute.", result);
        }
        return textResult(
          `Scanned ${result.scanned} open deal${result.scanned === 1 ? "" : "s"}: ${result.stale} going quiet, ${result.drafted} new draft${result.drafted === 1 ? "" : "s"} written.`,
          result,
        );
      }),
  );

  server.registerTool(
    "founderos_sync_gmail",
    {
      title: "Sync Gmail now",
      description:
        "Read new Gmail headers (who emailed whom and when, never message bodies) and update each lead's last contact. Resets the silence clock for any lead the founder emailed or who wrote back, and closes follow-up drafts that are no longer needed. Works only after Gmail is connected in FounderOS Settings; otherwise it says how to connect.",
      inputSchema: {},
      annotations: { ...WRITE_IDEMPOTENT, openWorldHint: true },
    },
    async () =>
      run("founderos_sync_gmail", async () => {
        try {
          const result = await gmailSync.sync("mcp");
          const since = result.since.slice(0, 10);
          return textResult(
            `Read ${result.messagesRead} email${result.messagesRead === 1 ? "" : "s"} since ${since}: ${result.leadsMatched} lead${result.leadsMatched === 1 ? "" : "s"} matched, ${result.clocksMoved} silence clock${result.clocksMoved === 1 ? "" : "s"} moved, ${result.draftsClosed} draft${result.draftsClosed === 1 ? "" : "s"} closed.${result.truncated ? " Stopped early at the message limit; run it again to continue." : ""}`,
            result,
          );
        } catch (err) {
          if (err instanceof GmailSyncError) throw new ToolError(err.message);
          throw err;
        }
      }),
  );

  return server;
}
