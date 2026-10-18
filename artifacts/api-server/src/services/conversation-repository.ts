import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, conversationsTable, messagesTable, tasksTable } from "@workspace/db";
import type { PendingAction, SessionSummary } from "./conversation-types";

type NewMessage = {
  conversationId: string;
  senderType: "user" | "agent";
  role: "user" | "assistant";
  senderId?: string | null;
  content: string;
  modelUsed?: string | null;
  tokensUsed?: number | null;
};

class ConversationRepository {
  async getActiveSession(): Promise<SessionSummary | null> {
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.type, "founder_chat"), eq(conversationsTable.status, "active")))
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(1);

    if (rows.length === 0) return null;
    return this.toSummary(rows[0]);
  }

  async getSession(id: string): Promise<SessionSummary | null> {
    const [row] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    return row ? this.toSummary(row) : null;
  }

  async listSessions(opts: { q?: string; status?: string; limit?: number } = {}): Promise<SessionSummary[]> {
    const conditions = [eq(conversationsTable.type, "founder_chat")];
    if (opts.status) {
      conditions.push(eq(conversationsTable.status, opts.status));
    } else {
      conditions.push(sql`${conversationsTable.status} != 'deleted'`);
    }

    const rows = await db
      .select()
      .from(conversationsTable)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(sql`${conversationsTable.pinned} DESC`, desc(conversationsTable.lastMessageAt))
      .limit(opts.limit ?? 100);

    let filtered = rows;
    if (opts.q && opts.q.trim()) {
      const q = `%${opts.q.trim()}%`;
      filtered = [];
      for (const row of rows) {
        if (row.title && row.title.toLowerCase().includes(opts.q.trim().toLowerCase())) {
          filtered.push(row);
          continue;
        }
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messagesTable)
          .where(and(eq(messagesTable.conversationId, row.id), sql`${messagesTable.content} ILIKE ${q}`));
        if (count > 0) filtered.push(row);
      }
    }

    return Promise.all(filtered.map(async (row) => this.toSummary(row)));
  }

  private async toSummary(row: typeof conversationsTable.$inferSelect): Promise<SessionSummary> {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, row.id));
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      summary: row.summary,
      pinned: row.pinned,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      messageCount: count,
    };
  }

  async createSession(title?: string): Promise<SessionSummary> {
    const [row] = await db
      .insert(conversationsTable)
      .values({ type: "founder_chat", title: title ?? null, status: "active" })
      .returning();
    return this.toSummary(row);
  }

  async appendMessage(message: NewMessage): Promise<void> {
    await db.insert(messagesTable).values(message);
    await db.update(conversationsTable).set({ lastMessageAt: new Date() }).where(eq(conversationsTable.id, message.conversationId));
  }

  async getRecentMessages(conversationId: string, limit: number): Promise<Array<{ role: string; content: string }>> {
    const rows = await db
      .select({ role: messagesTable.role, content: messagesTable.content })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit);
    return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  async countMessages(conversationId: string): Promise<number> {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId));
    return count;
  }

  async renameSession(id: string, title: string): Promise<void> {
    await db.update(conversationsTable).set({ title, updatedAt: new Date() }).where(eq(conversationsTable.id, id));
  }

  async setStatus(id: string, status: string): Promise<void> {
    await db.update(conversationsTable).set({ status, updatedAt: new Date() }).where(eq(conversationsTable.id, id));
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await db.update(conversationsTable).set({ pinned, updatedAt: new Date() }).where(eq(conversationsTable.id, id));
  }

  async deleteSession(id: string): Promise<void> {
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
  }

  async setPendingAction(id: string, pending: PendingAction | null): Promise<void> {
    await db.update(conversationsTable).set({ pendingAction: pending ?? null, updatedAt: new Date() }).where(eq(conversationsTable.id, id));
  }

  async getPendingAction(id: string): Promise<PendingAction | null> {
    const [row] = await db.select({ pendingAction: conversationsTable.pendingAction }).from(conversationsTable).where(eq(conversationsTable.id, id));
    return (row?.pendingAction as PendingAction | null) ?? null;
  }

  async updateSummary(id: string, summary: string): Promise<void> {
    await db.update(conversationsTable).set({ summary, updatedAt: new Date() }).where(eq(conversationsTable.id, id));
  }

  async getOpenTasksSummary(): Promise<string> {
    const rows = await db
      .select({ title: tasksTable.title, status: tasksTable.status, priority: tasksTable.priority })
      .from(tasksTable)
      .where(sql`${tasksTable.deletedAt} IS NULL AND ${tasksTable.status} != 'done' AND ${tasksTable.status} != 'cancelled'`)
      .orderBy(desc(tasksTable.createdAt))
      .limit(8);
    if (rows.length === 0) return "No open tasks.";
    return rows.map((t, i) => `${i + 1}. [${t.status}] ${t.title} (${t.priority})`).join("\n");
  }
}

export const conversationRepository = new ConversationRepository();
