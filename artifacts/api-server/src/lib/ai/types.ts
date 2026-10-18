export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: Array<{ type: string; image_url: { url: string } }>;
};

export type AICallOptions = {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  model?: string;
};

export type AICallResult = {
  reply: string;
  model: string;
  provider: string;
  tokensUsed: number;
  cost: number;
  latencyMs: number;
};
