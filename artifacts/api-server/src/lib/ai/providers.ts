import { logger } from "../logger";
import type { AIMessage, AICallOptions } from "./types";

const JSON_SYSTEM_INSTRUCTION =
  "\n\nYou must respond with valid JSON only. Do not include any explanation outside of the JSON object.";

const PUTER_API_ORIGIN =
  process.env.PUTER_API_ORIGIN ?? "https://api.puter.com";

function getAuthToken(): string | null {
  return process.env.PUTER_AUTH_TOKEN ?? null;
}

async function puterChat(
  messages: AIMessage[],
  options: AICallOptions,
): Promise<{ reply: string; model: string }> {
  const authToken = getAuthToken();

  const args: Record<string, unknown> = {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (options.model) args.model = options.model;
  if (options.maxTokens) args.max_tokens = options.maxTokens;
  if (options.temperature) args.temperature = options.temperature;

  const body = {
    interface: "puter-chat-completion",
    driver: "ai-chat",
    method: "complete",
    test_mode: false,
    args,
    auth_token: authToken,
  };

  const url = `${PUTER_API_ORIGIN}/drivers/call`;
  logger.info(
    { url, hasToken: !!authToken, argsKeys: Object.keys(args) },
    "Puter API request",
  );

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  logger.info(
    { status: response.status, ok: response.ok },
    "Puter API response status",
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    logger.error({ status: response.status, body: text }, "Puter API error body");
    throw new Error(`Puter API error (${response.status}): ${text}`);
  }

  const rawText = await response.text();
  logger.info({ rawTextLength: rawText.length, preview: rawText.slice(0, 200) }, "Puter API raw response");

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(`Puter API returned non-JSON: ${rawText.slice(0, 500)}`);
  }

  logger.info({ topKeys: Object.keys(data) }, "Puter API response keys");

  // Puter's /drivers/call wraps the chat completion in `result`. The actual
  // assistant message lives at `result.message.content` (Puter chat-completion)
  // or `result.choices[0].message.content` (OpenAI-compatible). Fall back
  // through the flat shapes, then to a stringified blob only as a last resort.
  const resultObj = (data?.result ?? data) as Record<string, unknown>;

  const topMessageContent = (data?.message as Record<string, unknown> | undefined)?.content;
  const resultMessageContent = (resultObj?.message as Record<string, unknown> | undefined)?.content;
  const choices = resultObj?.choices as Array<Record<string, unknown>> | undefined;
  const choiceMessageContent = choices?.[0]?.message
    ? ((choices[0].message as Record<string, unknown>)?.content as string | undefined)
    : undefined;
  const fallbackText =
    (data?.text as string | undefined) ??
    (resultObj?.text as string | undefined) ??
    (data?.reply as string | undefined) ??
    (resultObj?.reply as string | undefined);

  let reply: string | undefined =
    typeof topMessageContent === "string"
      ? topMessageContent
      : typeof resultMessageContent === "string"
        ? resultMessageContent
        : typeof choiceMessageContent === "string"
          ? choiceMessageContent
          : typeof fallbackText === "string"
            ? fallbackText
            : undefined;

  if (reply === undefined || reply.length === 0) {
    logger.error({ rawText }, "Puter API returned no extractable reply");
    throw new Error(`Puter API returned no extractable reply: ${rawText.slice(0, 500)}`);
  }

  const model =
    (data?.model as string) ??
    (resultObj?.model as string) ??
    (data?.metadata as Record<string, unknown> | undefined)?.providerUsed as string | undefined ??
    options.model ??
    "gpt-5-nano";

  logger.info({ replyLength: reply.length, model }, "Puter API response parsed");

  return { reply, model };
}

class PuterProvider {
  readonly name = "puter";

  async chatCompletions(
    messages: AIMessage[],
    options: AICallOptions,
  ): Promise<{ reply: string; model: string; tokensUsed: number }> {
    const chatMessages = options.jsonMode
      ? addJsonInstruction(messages)
      : messages;

    const result = await puterChat(chatMessages, options);

    return { reply: result.reply, model: result.model, tokensUsed: 0 };
  }
}

function addJsonInstruction(messages: AIMessage[]): AIMessage[] {
  const systemMsg = messages.find((m) => m.role === "system");
  if (systemMsg) {
    return messages.map((m) =>
      m.role === "system"
        ? { ...m, content: m.content + JSON_SYSTEM_INSTRUCTION }
        : m,
    );
  }
  return [
    { role: "system" as const, content: JSON_SYSTEM_INSTRUCTION.trim() },
    ...messages,
  ];
}

export class ProviderFactory {
  private provider: PuterProvider;

  constructor() {
    this.provider = new PuterProvider();
  }

  configureProvider(_name: string, _apiKey: string, _baseUrl?: string): void {
    logger.warn(
      "configureProvider called but Puter.js is the only provider. Use PUTER_AUTH_TOKEN env var.",
    );
  }

  getProvider(_name?: string): PuterProvider {
    return this.provider;
  }

  getAvailableProviders(): Array<{ name: string; status: string }> {
    return [{ name: "puter", status: "available" }];
  }

  status(_name?: string): string {
    return "available";
  }
}

export const providerFactory = new ProviderFactory();
