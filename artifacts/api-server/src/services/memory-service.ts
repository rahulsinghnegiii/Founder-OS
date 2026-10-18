import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, memoriesTable, memoryLinksTable, messagesTable, type MemoryLink } from "@workspace/db";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";

type MemoryScope = "short_term" | "long_term";

type MemoryRecord = typeof memoriesTable.$inferSelect;

type MemoryCreateInput = {
  agentId?: string | null;
  entityType: string;
  entityId?: string | null;
  key: string;
  value: string;
  scope?: MemoryScope;
  category?: string;
  source?: string;
  confidence?: number;
  status?: "active" | "archived" | "deleted";
  expiresAt?: Date | null;
};

type MemoryRetrievalInput = {
  query: string;
  entityLinks?: Array<{ entityType: string; entityId?: string | null }>;
  scope?: MemoryScope | "all";
  limit?: number;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
  "your",
  "you",
]);

function normalizeScope(scope?: MemoryScope | "all"): MemoryScope | "all" {
  return scope ?? "all";
}

function parseScope(key: string): MemoryScope {
  if (key.startsWith("long_term:")) return "long_term";
  return "short_term";
}

function ensureScopedKey(key: string, scope: MemoryScope): string {
  if (key.startsWith("short_term:") || key.startsWith("long_term:")) {
    return key;
  }
  return `${scope}:${key}`;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function clip(text: string, maxLength = 420): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function scoreMemory(memory: MemoryRecord, query: string, entityLinks: Array<{ entityType: string; entityId?: string | null }>): number {
  const queryTokens = tokenize(query);
  const memoryTokens = tokenize(`${memory.key} ${memory.value}`);
  const overlap = queryTokens.filter((token) => memoryTokens.includes(token)).length;
  const overlapScore = overlap * 3;

  const entityScore = entityLinks.some((entity) => entity.entityType === memory.entityType && (!entity.entityId || entity.entityId === memory.entityId))
    ? 6
    : 0;

  const scopeScore = parseScope(memory.key) === "short_term" ? 2 : 1;
  const ageHours = Math.max(1, (Date.now() - new Date(memory.createdAt).getTime()) / 36e5);
  const recencyScore = Math.max(0.2, 8 / ageHours);

  return overlapScore + entityScore + scopeScore + recencyScore;
}

function summarizeMessages(messages: Array<{ role: string; content: string }>): string {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content.trim()).filter(Boolean);
  const assistantMessages = messages.filter((message) => message.role === "assistant").map((message) => message.content.trim()).filter(Boolean);

  const asks = userMessages.slice(-3).map((message) => `Founder asked: ${clip(message, 140)}`);
  const responses = assistantMessages.slice(-2).map((message) => `EA replied: ${clip(message, 160)}`);

  return [...asks, ...responses].join(" ");
}

class MemoryService {
  async createMemory(input: MemoryCreateInput): Promise<MemoryRecord> {
    const scopedKey = ensureScopedKey(input.key, input.scope ?? "short_term");
    const [memory] = await db.insert(memoriesTable).values({
      agentId: input.agentId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      key: scopedKey,
      value: clip(input.value, 1200),
      category: input.category ?? "general",
      source: input.source ?? null,
      confidence: input.confidence ?? 1,
      status: input.status ?? "active",
      expiresAt: input.expiresAt ?? null,
    }).returning();

    return memory;
  }

  async updateMemory(id: string, input: Partial<MemoryCreateInput>): Promise<MemoryRecord | null> {
    const [memory] = await db.update(memoriesTable).set({
      agentId: input.agentId ?? undefined,
      entityType: input.entityType ?? undefined,
      entityId: input.entityId ?? undefined,
      key: input.key ? ensureScopedKey(input.key, input.scope ?? "short_term") : undefined,
      value: input.value ? clip(input.value, 1200) : undefined,
      expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt,
    }).where(eq(memoriesTable.id, id)).returning();

    return memory ?? null;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const deleted = await db.delete(memoriesTable).where(eq(memoriesTable.id, id)).returning({ id: memoriesTable.id });
    return deleted.length > 0;
  }

  async listMemories(params: {
    entityType?: string;
    entityId?: string;
    category?: string;
    scope?: MemoryScope | "all";
    status?: string;
    limit?: number;
  } = {}): Promise<MemoryRecord[]> {
    const conditions = [
      or(isNull(memoriesTable.expiresAt), sql`${memoriesTable.expiresAt} > now()`),
      eq(memoriesTable.status, params.status ?? "active"),
    ];

    if (params.entityType) conditions.push(eq(memoriesTable.entityType, params.entityType));
    if (params.entityId) conditions.push(eq(memoriesTable.entityId, params.entityId));
    if (params.category) conditions.push(eq(memoriesTable.category, params.category));

    const rows = await db.select().from(memoriesTable).where(and(...conditions)).orderBy(desc(memoriesTable.createdAt)).limit(params.limit ?? 50);
    const scope = normalizeScope(params.scope);

    return scope === "all" ? rows : rows.filter((row) => parseScope(row.key) === scope);
  }

  async retrieveRelevant(params: MemoryRetrievalInput): Promise<Array<MemoryRecord & { score: number; scope: MemoryScope }>> {
    const entityLinks = params.entityLinks ?? [];
    const entityConditions = entityLinks
      .filter((entity) => Boolean(entity.entityType))
      .map((entity) =>
        entity.entityId
          ? and(eq(memoriesTable.entityType, entity.entityType), eq(memoriesTable.entityId, entity.entityId))
          : eq(memoriesTable.entityType, entity.entityType),
      );

    const baseConditions = [
      or(isNull(memoriesTable.expiresAt), sql`${memoriesTable.expiresAt} > now()`),
      eq(memoriesTable.status, "active"),
    ];
    const whereClause = entityConditions.length > 0 ? and(...baseConditions, or(...entityConditions)) : and(...baseConditions);

    const rows = await db.select().from(memoriesTable).where(whereClause).orderBy(desc(memoriesTable.createdAt)).limit(100);
    const scored = rows
      .map((memory) => ({
        ...memory,
        scope: parseScope(memory.key),
        score: scoreMemory(memory, params.query, entityLinks),
      }))
      .filter((memory) => normalizeScope(params.scope) === "all" || memory.scope === params.scope)
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit ?? 8);

    return scored;
  }

  async buildContextBlock(params: MemoryRetrievalInput): Promise<string> {
    const memories = await this.retrieveRelevant(params);
    if (memories.length === 0) return "No relevant operational memory found.";

    return memories
      .map((memory) => `[${memory.entityType}${memory.entityId ? `:${memory.entityId}` : ""}] (${memory.scope}, score ${memory.score.toFixed(1)}) ${memory.value}`)
      .join("\n");
  }

  async summarizeConversation(conversationId: string): Promise<string> {
    const messages = await db
      .select({ role: messagesTable.role, content: messagesTable.content })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(messagesTable.createdAt)
      .limit(30);

    if (messages.length === 0) {
      return "No conversation history available.";
    }

    const conversationText = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    try {
      const result = await callAI([
        {
          role: "system",
          content: "You are an operational memory extractor for FounderOS. Your goal is to condense a conversation into a single, high-fidelity paragraph that captures the founder's intent, key decisions made, and active operational focus. Be direct and concise.",
        },
        {
          role: "user",
          content: `Please summarize this operational conversation:\n\n${conversationText}`,
        },
      ]);
      return result.reply;
    } catch (err) {
      logger.error({ err }, "Failed to summarize conversation with AI, falling back to basic summary.");
      return summarizeMessages(messages);
    }
  }

  async extractConversationMemories(conversationId: string): Promise<MemoryRecord[]> {
    const messages = await db
      .select({ role: messagesTable.role, content: messagesTable.content })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(messagesTable.createdAt)
      .limit(30);

    if (messages.length === 0) return [];

    const conversationText = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    try {
      const result = await callAI(
        [
          {
            role: "system",
            content: `You are an operational intelligence agent. Analyze the conversation and extract key operational memories in JSON format.
            Extract:
            - "summary": A concise long-term summary of the conversation.
            - "focus": The current short-term focus or priority discussed.
            - "decisions": Array of specific decisions made.
            - "signals": Array of strategic signals or insights mentioned.
            
            Format: {"summary": "...", "focus": "...", "decisions": ["..."], "signals": ["..."]}`,
          },
          {
            role: "user",
            content: conversationText,
          },
        ],
        { jsonMode: true },
      );

      const data = JSON.parse(result.reply) as {
        summary: string;
        focus: string;
        decisions: string[];
        signals: string[];
      };

      const memories: Promise<MemoryRecord>[] = [];

      memories.push(
        this.createMemory({
          entityType: "conversation",
          entityId: conversationId,
          key: "long_term:conversation_summary",
          scope: "long_term",
          value: data.summary,
        }),
      );

      if (data.focus) {
        memories.push(
          this.createMemory({
            entityType: "conversation",
            entityId: conversationId,
            key: "short_term:current_focus",
            scope: "short_term",
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
            value: data.focus,
          }),
        );
      }

      for (const decision of data.decisions) {
        memories.push(
          this.createMemory({
            entityType: "conversation",
            entityId: conversationId,
            key: "long_term:decision",
            scope: "long_term",
            value: decision,
          }),
        );
      }

      for (const signal of data.signals) {
        memories.push(
          this.createMemory({
            entityType: "conversation",
            entityId: conversationId,
            key: "short_term:strategic_signal",
            scope: "short_term",
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
            value: signal,
          }),
        );
      }

      const savedMemories = await Promise.all(memories);
      
      // Update the founder profile asynchronously after extracting memories
      this.updateFounderProfile(data.summary).catch((e) => logger.error(e, "Profile update background task failed"));

      return savedMemories;
    } catch (err) {
      logger.error({ err }, "AI memory extraction failed, falling back to simple summary.");
      const summary = await this.summarizeConversation(conversationId);
      return [
        await this.createMemory({
          entityType: "conversation",
          entityId: conversationId,
          key: "long_term:conversation_summary",
          scope: "long_term",
          value: summary,
        }),
      ];
    }
  }

  async extractOperationalMemoryFromActivity(activity: {
    entityType: string;
    entityId?: string | null;
    action: string;
    actorName?: string | null;
    details?: Record<string, unknown> | null;
  }): Promise<MemoryRecord> {
    const activityDesc = `${activity.actorName ?? "System"} performed ${activity.action} on ${activity.entityType}${activity.entityId ? `:${activity.entityId}` : ""}. Details: ${JSON.stringify(activity.details)}`;

    try {
      const result = await callAI([
        {
          role: "system",
          content: "You are an operational analyst for FounderOS. Your job is to extract a single, punchy 'operational signal' from a system activity log. What does this mean for the business? Be extremely concise (max 20 words).",
        },
        {
          role: "user",
          content: `Analyze this activity: ${activityDesc}`,
        },
      ]);

      return this.createMemory({
        entityType: activity.entityType,
        entityId: activity.entityId ?? null,
        key: "short_term:operational_signal",
        scope: "short_term",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5),
        value: result.reply,
      });
    } catch (err) {
      logger.error({ err }, "AI activity signal extraction failed, falling back to basic fragment.");
      const fragments = [
        activity.actorName ? `${activity.actorName}` : "FounderOS",
        `recorded ${activity.action.replace(/_/g, " ")}`,
        `on ${activity.entityType.replace(/_/g, " ")}`,
      ];
      return this.createMemory({
        entityType: activity.entityType,
        entityId: activity.entityId ?? null,
        key: "short_term:activity_signal",
        scope: "short_term",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
        value: clip(`${fragments.join(" ")}. ${JSON.stringify(activity.details)}`.trim(), 600),
      });
    }
  }

  async writeActionMemories(params: {
    summary: string;
    agentId?: string | null;
    relatedEntities: Array<{ entityType: string; entityId?: string | null }>;
  }): Promise<MemoryRecord[]> {
    const writes = dedupe(
      params.relatedEntities.map((entity) => `${entity.entityType}:${entity.entityId ?? ""}`),
    ).map((key) => {
      const [entityType, entityId] = key.split(":");
      return this.createMemory({
        agentId: params.agentId ?? null,
        entityType,
        entityId: entityId || null,
        key: "long_term:action_summary",
        scope: "long_term",
        value: params.summary,
      });
    });

    return Promise.all(writes);
  }

  async getFounderProfile(): Promise<string> {
    const [profile] = await db
      .select()
      .from(memoriesTable)
      .where(and(eq(memoriesTable.entityType, "founder_profile"), eq(memoriesTable.key, "long_term:profile")))
      .limit(1);

    return profile?.value ?? "No founder profile established yet.";
  }

  async updateFounderProfile(newContext: string): Promise<void> {
    const currentProfile = await this.getFounderProfile();

    try {
      const result = await callAI([
        {
          role: "system",
          content: `You are the Founder OS Memory Architect. Your goal is to maintain a high-fidelity, long-term 'Founder Profile' that captures behavioral patterns, strategic preferences, leadership style, and recurring focus areas.
          Update the current profile with new observations while preserving historical strategic continuity.
          Current Profile: ${currentProfile}`,
        },
        {
          role: "user",
          content: `New observations from recent activity:\n${newContext}\n\nPlease return the updated profile as a comprehensive, structured briefing.`,
        },
      ]);

      const [existing] = await db
        .select()
        .from(memoriesTable)
        .where(and(eq(memoriesTable.entityType, "founder_profile"), eq(memoriesTable.key, "long_term:profile")))
        .limit(1);

      if (existing) {
        await this.updateMemory(existing.id, { value: result.reply });
      } else {
        await this.createMemory({
          entityType: "founder_profile",
          key: "long_term:profile",
          scope: "long_term",
          value: result.reply,
        });
      }
    } catch (err) {
      logger.error({ err }, "Failed to update founder profile");
    }
  }

  /** PostgreSQL full-text search over the generated tsvector column. */
  async search(
    query: string,
    options: { category?: string; entityType?: string; entityId?: string; limit?: number } = {},
  ): Promise<MemoryRecord[]> {
    const limit = options.limit ?? 10;
    try {
      const tsQuery = sql`plainto_tsquery('english', ${query})`;
      const conditions = [
        or(isNull(memoriesTable.expiresAt), sql`${memoriesTable.expiresAt} > now()`),
        eq(memoriesTable.status, "active"),
        sql`${memoriesTable.searchVector} @@ ${tsQuery}`,
      ];
      if (options.category) conditions.push(eq(memoriesTable.category, options.category));
      if (options.entityType) conditions.push(eq(memoriesTable.entityType, options.entityType));
      if (options.entityId) conditions.push(eq(memoriesTable.entityId, options.entityId));

      return await db
        .select()
        .from(memoriesTable)
        .where(and(...conditions))
        .orderBy(sql`ts_rank(${memoriesTable.searchVector}, ${tsQuery}) DESC`)
        .limit(limit);
    } catch (err) {
      // Fallback to token-based retrieval if the tsvector column is unavailable.
      logger.warn({ err }, "Full-text search failed, falling back to token scoring");
      return this.retrieveRelevant({ query, limit });
    }
  }

  async linkMemory(
    fromMemoryId: string,
    toMemoryId: string,
    relation: string,
    strength = 1,
  ): Promise<void> {
    if (fromMemoryId === toMemoryId) return;
    await db.insert(memoryLinksTable).values({ fromMemoryId, toMemoryId, relation, strength });
  }

  async getLinks(memoryId: string): Promise<MemoryLink[]> {
    return db
      .select()
      .from(memoryLinksTable)
      .where(eq(memoryLinksTable.fromMemoryId, memoryId))
      .orderBy(desc(memoryLinksTable.strength));
  }

  /** Lifecycle status transitions (archive / expire / delete / restore). */
  async setMemoryStatus(id: string, status: "active" | "archived" | "deleted"): Promise<void> {
    await db.update(memoriesTable).set({ status, updatedAt: new Date() }).where(eq(memoriesTable.id, id));
  }

  async mergeMemories(ids: string[], keepId: string): Promise<void> {
    if (ids.length < 2) return;
    const rows = await db.select().from(memoriesTable).where(sql`${memoriesTable.id} = ANY(${ids})`);
    const merged = rows
      .map((r) => `[${r.category}] ${r.value}`)
      .join("\n\n");
    await db.update(memoriesTable).set({ value: clip(merged, 4000), updatedAt: new Date() }).where(eq(memoriesTable.id, keepId));
    for (const id of ids) {
      if (id !== keepId) await this.setMemoryStatus(id, "deleted");
    }
  }
}

export const memoryService = new MemoryService();
