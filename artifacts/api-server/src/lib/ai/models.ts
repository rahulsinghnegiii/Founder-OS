import type { ProviderName } from "./types";

export type ModelTier = "premium" | "standard" | "cheap" | "free";

export type ModelInfo = {
  id: string;
  provider: ProviderName;
  displayName: string;
  tier: ModelTier;
  contextWindow: number;
  supportsJson: boolean;
  /** USD per 1k tokens. 0 means unknown or free; cost is then reported as 0. */
  costPer1kInput: number;
  costPer1kOutput: number;
};

/**
 * Models FounderOS knows how to price and describe. Any model id can still be
 * used via the *_MODEL env vars; unknown ids simply report cost 0.
 */
export const MODEL_REGISTRY: ModelInfo[] = [
  // Anthropic (first-party API pricing, per 1M: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50)
  { id: "claude-opus-5-5", provider: "anthropic", displayName: "Claude Opus 5.5", tier: "premium", contextWindow: 1_000_000, supportsJson: true, costPer1kInput: 0.004, costPer1kOutput: 0.02 },
  { id: "claude-sonnet-5-5", provider: "anthropic", displayName: "Claude Sonnet 5.5", tier: "standard", contextWindow: 1_000_000, supportsJson: true, costPer1kInput: 0.002, costPer1kOutput: 0.01 },
  { id: "claude-haiku-5-5", provider: "anthropic", displayName: "Claude Haiku 5.5", tier: "cheap", contextWindow: 1_000_000, supportsJson: true, costPer1kInput: 0.0001, costPer1kOutput: 0.0005 },

  // OpenAI-compatible providers. Pricing varies by account and changes often; reported as 0.
  { id: "gpt-5-mini", provider: "openai", displayName: "GPT-5 Mini", tier: "standard", contextWindow: 400_000, supportsJson: true, costPer1kInput: 0, costPer1kOutput: 0 },
  { id: "gpt-5-nano", provider: "openai", displayName: "GPT-5 Nano", tier: "cheap", contextWindow: 400_000, supportsJson: true, costPer1kInput: 0, costPer1kOutput: 0 },
  { id: "llama-3.3-70b-versatile", provider: "groq", displayName: "Llama 3.3 70B (Groq)", tier: "cheap", contextWindow: 128_000, supportsJson: true, costPer1kInput: 0, costPer1kOutput: 0 },
  { id: "llama3.1", provider: "ollama", displayName: "Llama 3.1 (local)", tier: "free", contextWindow: 128_000, supportsJson: true, costPer1kInput: 0, costPer1kOutput: 0 },
];

export function getModel(id: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function getModelsForProvider(provider: ProviderName): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => m.provider === provider);
}

/** Backwards-compatible alias used by older call sites. */
export function getModelsForTask(): ModelInfo[] {
  return MODEL_REGISTRY;
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = getModel(modelId);
  if (!model) return 0;
  return (inputTokens / 1000) * model.costPer1kInput + (outputTokens / 1000) * model.costPer1kOutput;
}
