export type ProviderName =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "groq"
  | "ollama"
  | "puter"
  | "none";

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: Array<{ type: string; image_url: { url: string } }>;
};

export type AICallOptions = {
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for a JSON object. The reply is normalized to bare JSON text. */
  jsonMode?: boolean;
  /** Override the provider's default model for this call. */
  model?: string;
  /** Route this call to a specific configured provider instead of the active one. */
  provider?: ProviderName;
};

export type AICallResult = {
  reply: string;
  model: string;
  provider: ProviderName;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD cost when the model's pricing is known, otherwise 0. */
  cost: number;
  latencyMs: number;
  /**
   * Set when the call failed. `reply` then holds a human-readable explanation
   * so chat surfaces degrade gracefully; JSON callers should treat the call
   * as failed and use their deterministic fallback.
   */
  error?: string;
};
