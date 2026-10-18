export const MODEL_REGISTRY = [
  {
    id: "gpt-5-nano",
    provider: "puter",
    displayName: "GPT-5 Nano",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsJson: true,
    supportsStreaming: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    suitableFor: [],
    tier: "free",
  },
  {
    id: "gpt-4o-mini",
    provider: "puter",
    displayName: "GPT-4o Mini",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsJson: true,
    supportsStreaming: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    suitableFor: [],
    tier: "free",
  },
  {
    id: "claude-sonnet-4-6",
    provider: "puter",
    displayName: "Claude Sonnet 4.6",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsJson: true,
    supportsStreaming: true,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    suitableFor: [],
    tier: "free",
  },
];

export function getModel(id: string): (typeof MODEL_REGISTRY)[number] | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function getModelsForTask(): (typeof MODEL_REGISTRY)[number][] {
  return MODEL_REGISTRY;
}
