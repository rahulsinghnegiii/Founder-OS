import { providerFactory } from "./providers";
import type { AIMessage, AICallOptions, AICallResult } from "./types";
import { logger } from "../logger";

export async function callAIWithRouting(
  messages: AIMessage[],
  options: AICallOptions = {},
): Promise<AICallResult> {
  const startTime = Date.now();
  const systemBrief = messages.find((m) => m.role === "system")?.content.slice(0, 80);
  const userBrief = messages.find((m) => m.role === "user")?.content.slice(0, 80);

  logger.info(
    { jsonMode: options.jsonMode, model: options.model, systemBrief, userBrief },
    "callAI invoked",
  );

  if (process.env.DEBUG_AI === "1") {
    for (const m of messages) {
      logger.info(
        { role: m.role, content: m.content },
        `[DEBUG-AI] prompt message (${m.role})`,
      );
    }
  }

  try {
    const provider = providerFactory.getProvider();
    const result = await provider.chatCompletions(messages, options);

    const elapsed = Date.now() - startTime;
    logger.info(
      { replyLength: result.reply.length, model: result.model, latencyMs: elapsed },
      "callAI completed",
    );

    return {
      reply: result.reply,
      model: result.model,
      provider: "puter",
      tokensUsed: result.tokensUsed,
      cost: 0,
      latencyMs: elapsed,
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, latencyMs: elapsed }, "callAI failed with exception");

    let userMessage: string;
    if (
      /401|403|auth|token/i.test(message)
    ) {
      userMessage =
        "Puter API authentication failed. Set a valid PUTER_AUTH_TOKEN in your .env file.";
    } else if (
      /fetch|network|ENOTFOUND|ECONNREFUSED|abort|timeout/i.test(message)
    ) {
      userMessage =
        "Cannot reach Puter API. Check your network and PUTER_API_ORIGIN (default: https://api.puter.com)";
    } else {
      userMessage = `Puter API error: ${message}`;
    }

    return {
      reply: userMessage,
      model: options.model ?? "unknown",
      provider: "puter",
      tokensUsed: 0,
      cost: 0,
      latencyMs: elapsed,
    };
  }
}
