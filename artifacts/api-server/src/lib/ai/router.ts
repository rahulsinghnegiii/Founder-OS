import Anthropic from "@anthropic-ai/sdk";
import { providerFactory, NO_PROVIDER_MESSAGE } from "./providers";
import { estimateCost } from "./models";
import type { AIMessage, AICallOptions, AICallResult, ProviderName } from "./types";
import { logger } from "../logger";

class CallTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`No reply within ${ms} ms`);
  }
}

/** The provider request keeps running to its own timeout; the caller just stops waiting. */
function withTimeout<T>(pending: Promise<T>, ms: number | undefined): Promise<T> {
  if (!ms) return pending;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CallTimeoutError(ms)), ms);
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

function describeError(provider: ProviderName, err: unknown): string {
  if (provider === "none") return NO_PROVIDER_MESSAGE;
  if (err instanceof CallTimeoutError) {
    return `The ${provider} provider didn't reply within ${Math.round(err.ms / 1000)} seconds.`;
  }

  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in your .env.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Anthropic rate limit reached. Try again in a moment.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Cannot reach the Anthropic API. Check your network connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error ${err.status ?? ""}: ${err.message}`.trim();
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/401|403|unauthori[sz]ed|invalid api key|authentication/i.test(message)) {
    return `The ${provider} provider rejected the credential. Check the matching key in your .env.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network|abort|timeout/i.test(message)) {
    return `Cannot reach the ${provider} provider. Check your network${provider === "ollama" ? " and that Ollama is running" : ""}.`;
  }
  return message;
}

export async function callAIWithRouting(
  messages: AIMessage[],
  options: AICallOptions = {},
): Promise<AICallResult> {
  const startTime = Date.now();
  const provider = providerFactory.getProvider(options.provider);
  const systemBrief = messages.find((m) => m.role === "system")?.content.slice(0, 80);
  const userBrief = messages.find((m) => m.role === "user")?.content.slice(0, 80);

  logger.info(
    { provider: provider.name, jsonMode: options.jsonMode, model: options.model ?? provider.defaultModel, systemBrief, userBrief },
    "callAI invoked",
  );

  if (process.env.DEBUG_AI === "1") {
    for (const m of messages) {
      logger.info({ role: m.role, content: m.content }, `[DEBUG-AI] prompt message (${m.role})`);
    }
  }

  try {
    const result = await withTimeout(provider.chatCompletions(messages, options), options.timeoutMs);
    const latencyMs = Date.now() - startTime;
    logger.info(
      { provider: provider.name, replyLength: result.reply.length, model: result.model, latencyMs },
      "callAI completed",
    );
    return {
      reply: result.reply,
      model: result.model,
      provider: provider.name,
      tokensUsed: result.inputTokens + result.outputTokens,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cost: estimateCost(result.model, result.inputTokens, result.outputTokens),
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const message = describeError(provider.name, err);
    logger.error({ err, provider: provider.name, latencyMs }, "callAI failed");
    return {
      reply: message,
      model: options.model ?? provider.defaultModel,
      provider: provider.name,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      latencyMs,
      error: message,
    };
  }
}
