export type PendingAction = {
  tool: string;
  args: Record<string, unknown>;
  missing: string[];
  lastUserMessage?: string;
  createdAt?: string;
  askedField?: string | null;
};

export type SessionSummary = {
  id: string;
  title: string | null;
  type: string;
  status: string;
  summary: string | null;
  pinned: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  messageCount: number;
};
