import { memoryService } from "./memory-service";
import { conversationRepository } from "./conversation-repository";
import { buildConversationContext } from "./conversation-context-loader";
import type { PendingAction, SessionSummary } from "./conversation-types";

/** When a conversation exceeds this many messages, roll it into a summary. */
export const ROLL_THRESHOLD = 40;

class ConversationService {
  async ensureSession(conversationId?: string | null): Promise<SessionSummary> {
    if (conversationId) {
      const existing = await conversationRepository.getSession(conversationId);
      if (existing && existing.status !== "deleted") return existing;
    }
    const active = await conversationRepository.getActiveSession();
    return active ?? conversationRepository.createSession();
  }

  async loadContext(conversationId: string, pendingAction: PendingAction | null, lastUserMessage?: string): Promise<string> {
    return buildConversationContext({ conversationId, pendingAction, lastUserMessage });
  }

  async recordUserMessage(conversationId: string, content: string): Promise<void> {
    await conversationRepository.appendMessage({
      conversationId,
      senderType: "user",
      role: "user",
      content,
    });
  }

  async recordAssistantMessage(
    conversationId: string,
    content: string,
    opts: { senderId?: string; modelUsed?: string } = {},
  ): Promise<void> {
    await conversationRepository.appendMessage({
      conversationId,
      senderType: "agent",
      role: "assistant",
      senderId: opts.senderId ?? "executive-assistant",
      content,
      modelUsed: opts.modelUsed ?? "operational-orchestrator",
      tokensUsed: 0,
    });
  }

  /**
   * Roll a long conversation into a summary and extract durable facts into the
   * Company Brain. Returns the new summary when a roll happened, else null.
   */
  async maybeSummarize(conversationId: string): Promise<string | null> {
    const count = await conversationRepository.countMessages(conversationId);
    if (count < ROLL_THRESHOLD) return null;

    const summary = await memoryService.summarizeConversation(conversationId);
    await conversationRepository.updateSummary(conversationId, summary);
    await memoryService.extractConversationMemories(conversationId).catch((e) => {
      // Non-fatal: summarization already captured the gist.
      console.error("memory extraction failed during roll", e);
    });
    return summary;
  }

  get repository() {
    return conversationRepository;
  }
}

export const conversationService = new ConversationService();
