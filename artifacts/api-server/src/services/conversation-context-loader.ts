import { memoryService } from "./memory-service";
import { conversationRepository } from "./conversation-repository";
import type { PendingAction } from "./conversation-types";

/**
 * Assembles exactly the context the LLM needs for the next turn:
 * rolling summary + recent messages + relevant Company Brain memories +
 * pending action + open tasks + founder profile. Nothing else is injected.
 */
export async function buildConversationContext(params: {
  conversationId: string;
  pendingAction?: PendingAction | null;
  lastUserMessage?: string;
}): Promise<string> {
  const session = await conversationRepository.getSession(params.conversationId);
  const [recent, memories, profile, openTasks] = await Promise.all([
    conversationRepository.getRecentMessages(params.conversationId, 20),
    memoryService.buildContextBlock({
      query: params.lastUserMessage ?? session?.summary ?? "",
      entityLinks: [{ entityType: "conversation", entityId: params.conversationId }],
      limit: 6,
    }),
    memoryService.getFounderProfile(),
    conversationRepository.getOpenTasksSummary(),
  ]);

  const parts: string[] = [];

  if (session?.summary) {
    parts.push(`CONVERSATION SUMMARY (rolling memory):\n${session.summary}`);
  }

  if (recent.length > 0) {
    parts.push(
      `RECENT MESSAGES (last ${recent.length}):\n` +
        recent.map((m) => `${m.role === "user" ? "FOUNDER" : "ASSISTANT"}: ${m.content}`).join("\n"),
    );
  }

  if (params.pendingAction) {
    const p = params.pendingAction;
    const filled = Object.entries(p.args)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    parts.push(
      `PENDING ACTION: tool=${p.tool} already collected {${filled}} | still missing [${p.missing.join(", ")}]`,
    );
  }

  parts.push(`OPEN TASK:\n${openTasks}`);
  parts.push(`RELEVANT COMPANY BRAIN MEMORIES:\n${memories}`);
  parts.push(`FOUNDER PROFILE (long-term memory):\n${profile}`);

  return parts.join("\n\n");
}
