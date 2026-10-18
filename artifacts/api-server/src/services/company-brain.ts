import { and, desc, eq } from "drizzle-orm";
import { db, memoriesTable, type MemoryLink } from "@workspace/db";
import { memoryService } from "./memory-service";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";

export type RememberInput = {
  entityType: string;
  entityId?: string | null;
  category?: string;
  key: string;
  value: string;
  source?: string;
  confidence?: number;
  scope?: "short_term" | "long_term";
  expiresAt?: Date | null;
};

export type RecallOptions = {
  category?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  expandLinks?: boolean;
};

/**
 * Company Brain — the single source of truth for everything FounderOS knows.
 * Future systems (Planner, Reasoner, Reflection, Learning, Observer, Scheduler,
 * Dashboard, Voice) must query/remember through this service, never the raw
 * memory table. It composes the existing memoryService and the memory_links
 * table; it does not replace them.
 */
class CompanyBrain {
  async remember(input: RememberInput) {
    return memoryService.createMemory({
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      category: input.category ?? "general",
      key: input.key,
      value: input.value,
      source: input.source ?? "company-brain",
      confidence: input.confidence ?? 1,
      scope: input.scope ?? "long_term",
      expiresAt: input.expiresAt ?? null,
    });
  }

  /** Full-text search (delegates to memoryService.search). */
  search(query: string, options: RecallOptions = {}) {
    return memoryService.search(query, options);
  }

  /** Search + one hop of relationship expansion. */
  async recall(query: string, options: RecallOptions = {}): Promise<string> {
    const hits = await memoryService.search(query, { ...options, limit: options.limit ?? 8 });
    const blocks: string[] = [];

    for (const hit of hits) {
      blocks.push(`[${hit.category}] ${hit.value}`);
      const links = await memoryService.getLinks(hit.id);
      for (const link of links.slice(0, 4)) {
        const [related] = await db
          .select({ value: memoriesTable.value, category: memoriesTable.category })
          .from(memoriesTable)
          .where(eq(memoriesTable.id, link.toMemoryId))
          .limit(1);
        if (related) blocks.push(`  └─(${link.relation}) ${related.category}: ${related.value}`);
      }
    }

    return blocks.join("\n");
  }

  async update(id: string, patch: Partial<{ value: string; category: string; key: string; confidence: number }>) {
    return memoryService.updateMemory(id, patch);
  }

  async forget(id: string) {
    await memoryService.setMemoryStatus(id, "deleted");
  }

  async archive(id: string) {
    await memoryService.setMemoryStatus(id, "archived");
  }

  async restore(id: string) {
    await memoryService.setMemoryStatus(id, "active");
  }

  async link(fromMemoryId: string, toMemoryId: string, relation: string, strength = 1) {
    await memoryService.linkMemory(fromMemoryId, toMemoryId, relation, strength);
  }

  /** AI-generated summary of memories matching a filter. */
  async summarize(filter: { entityType?: string; category?: string; entityId?: string; limit?: number } = {}) {
    const rows = await memoryService.listMemories({ ...filter, limit: filter.limit ?? 20 });
    if (rows.length === 0) return "No memories to summarize.";
    const text = rows.map((r) => `[${r.category}] ${r.value}`).join("\n");
    try {
      const result = await callAI([
        {
          role: "system",
          content:
            "You are the Company Brain summarizer. Condense the provided memories into a tight, high-signal summary of what the founder needs to remember. Be direct and concise.",
        },
        { role: "user", content: text },
      ]);
      return result.reply;
    } catch (err) {
      logger.error({ err }, "Brain summarize failed");
      return text;
    }
  }

  /**
   * Universal context builder. Given a project/query, automatically gathers the
   * surrounding knowledge graph (project, tasks, repository, meetings, files,
   * ideas, clients, recent conversations, goals, reports, decisions) without
   * requiring multiple manual searches.
   */
  async getContext(query: string, options: { limit?: number } = {}): Promise<string> {
    const sections: string[] = [];

    const direct = await memoryService.search(query, { limit: options.limit ?? 8 });
    if (direct.length > 0) {
      sections.push(`## Matches\n${direct.map((m) => `[${m.category}] ${m.value}`).join("\n")}`);
    }

    const conversations = await memoryService.listMemories({ entityType: "conversation", limit: 3 });
    if (conversations.length > 0) {
      sections.push(`## Recent Conversations\n${conversations.map((m) => m.value).join("\n")}`);
    }

    const goals = await memoryService.listMemories({ category: "Goal", limit: 5 });
    if (goals.length > 0) {
      sections.push(`## Goals\n${goals.map((m) => m.value).join("\n")}`);
    }

    const decisions = await memoryService.listMemories({ category: "Decision", limit: 5 });
    if (decisions.length > 0) {
      sections.push(`## Decisions\n${decisions.map((m) => m.value).join("\n")}`);
    }

    const reports = await memoryService.listMemories({ entityType: "report", limit: 3 });
    if (reports.length > 0) {
      sections.push(`## Recent Reports\n${reports.map((m) => m.value).join("\n")}`);
    }

    const profile = memoryService.getFounderProfile();
    sections.push(`## Founder Profile\n${await profile}`);

    return sections.join("\n\n");
  }

  // ─── Founder Profile (prose, backward-compatible) ───────────────────────
  getFounderProfile() {
    return memoryService.getFounderProfile();
  }

  updateFounderProfile(newContext: string) {
    return memoryService.updateFounderProfile(newContext);
  }

  // ─── Founder Profile (structured, additive) ─────────────────────────────
  async getStructuredProfile(): Promise<Record<string, unknown>> {
    const [row] = await db
      .select({ value: memoriesTable.value })
      .from(memoriesTable)
      .where(and(eq(memoriesTable.entityType, "founder_profile"), eq(memoriesTable.key, "long_term:profile_structured")))
      .limit(1);
    if (!row) return {};
    try {
      return JSON.parse(row.value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async updateFounderProfileField(field: string, value: unknown): Promise<void> {
    const profile = await this.getStructuredProfile();
    profile[field] = value;
    const serialized = JSON.stringify(profile);

    const [existing] = await db
      .select({ id: memoriesTable.id })
      .from(memoriesTable)
      .where(and(eq(memoriesTable.entityType, "founder_profile"), eq(memoriesTable.key, "long_term:profile_structured")))
      .limit(1);

    if (existing) {
      await memoryService.updateMemory(existing.id, { value: serialized });
    } else {
      await memoryService.createMemory({
        entityType: "founder_profile",
        key: "long_term:profile_structured",
        category: "Preference",
        value: serialized,
        scope: "long_term",
        source: "company-brain",
      });
    }
  }

  // ─── Event-sync helpers ──────────────────────────────────────────────────
  async forgetByEntity(entityType: string, entityId?: string | null) {
    if (!entityId) return;
    const rows = await db
      .select({ id: memoriesTable.id })
      .from(memoriesTable)
      .where(and(eq(memoriesTable.entityType, entityType), eq(memoriesTable.entityId, entityId)));
    for (const r of rows) await this.forget(r.id);
  }

  async updateByEntity(entityType: string, entityId: string | null, patch: { value: string; key: string }) {
    if (!entityId) return;
    const [row] = await db
      .select({ id: memoriesTable.id })
      .from(memoriesTable)
      .where(and(eq(memoriesTable.entityType, entityType), eq(memoriesTable.entityId, entityId)))
      .orderBy(desc(memoriesTable.createdAt))
      .limit(1);
    if (row) await this.update(row.id, patch);
  }
}

export const companyBrain = new CompanyBrain();
