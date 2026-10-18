import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger";
import type { AIMessage, AICallOptions, ProviderName } from "./types";

/**
 * AI provider layer.
 *
 * FounderOS talks to exactly one provider at a time, chosen by AI_PROVIDER or
 * auto-detected from whichever credential is present (in the order below).
 * Every provider exposes the same `chatCompletions` surface so the rest of
 * the app never knows which vendor is answering.
 *
 *   anthropic   ANTHROPIC_API_KEY            (official @anthropic-ai/sdk)
 *   openai      OPENAI_API_KEY               (OpenAI-compatible HTTP)
 *   openrouter  OPENROUTER_API_KEY           (OpenAI-compatible HTTP)
 *   groq        GROQ_API_KEY                 (OpenAI-compatible HTTP)
 *   ollama      OLLAMA_BASE_URL              (OpenAI-compatible HTTP, local, no key)
 *   puter       PUTER_AUTH_TOKEN             (legacy; browser-token based)
 */

export type ProviderResult = {
  reply: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface ChatProvider {
  readonly name: ProviderName;
  readonly label: string;
  readonly defaultModel: string;
  chatCompletions(messages: AIMessage[], options: AICallOptions): Promise<ProviderResult>;
}

const JSON_SYSTEM_INSTRUCTION =
  "\n\nRespond with a single valid JSON object only. No prose, no markdown fences, nothing outside the JSON.";

const REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOKENS = 16_000;

function withJsonInstruction(messages: AIMessage[]): AIMessage[] {
  if (messages.some((m) => m.role === "system")) {
    let appended = false;
    return messages.map((m) => {
      if (m.role === "system" && !appended) {
        appended = true;
        return { ...m, content: m.content + JSON_SYSTEM_INSTRUCTION };
      }
      return m;
    });
  }
  return [{ role: "system", content: JSON_SYSTEM_INSTRUCTION.trim() }, ...messages];
}

/** Strip markdown fences and any prose around the first JSON object/array. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const firstBrace = candidate.search(/[{[]/);
  if (firstBrace === -1) return candidate;
  const closer = candidate[firstBrace] === "{" ? "}" : "]";
  const lastBrace = candidate.lastIndexOf(closer);
  return lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate.slice(firstBrace);
}

// ───────────────────────────── Anthropic ─────────────────────────────

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function readEffort(): Effort | undefined {
  const raw = process.env.AI_EFFORT?.trim().toLowerCase();
  return raw && ["low", "medium", "high", "xhigh", "max"].includes(raw) ? (raw as Effort) : undefined;
}

class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic" as const;
  readonly label = "Anthropic Claude";
  readonly defaultModel = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
  private client: Anthropic | null = null;

  async chatCompletions(messages: AIMessage[], options: AICallOptions): Promise<ProviderResult> {
    // Zero-arg client: resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile.
    this.client ??= new Anthropic({ timeout: REQUEST_TIMEOUT_MS });

    const prepared = options.jsonMode ? withJsonInstruction(messages) : messages;
    const system = prepared
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const turns: Anthropic.Beta.BetaMessageParam[] = prepared
      .filter((m): m is AIMessage & { role: "user" | "assistant" } => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    if (turns.length === 0 || turns[0].role !== "user") {
      turns.unshift({ role: "user", content: "Proceed." });
    }

    const model = options.model ?? this.defaultModel;
    const effort = readEffort();

    // Thinking is adaptive by default on current Claude models; server-side
    // fallback re-runs the request on another Claude model if a safety
    // classifier declines it, so one refusal does not stall the founder.
    const response = await this.client.beta.messages.create({
      model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(system ? { system } : {}),
      messages: turns,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(effort ? { output_config: { effort } } : {}),
    });

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.type === "refusal" ? response.stop_details.category : null;
      throw new Error(`Claude declined this request${category ? ` (${category})` : ""}.`);
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) throw new Error("Claude returned no text content.");

    return {
      reply: options.jsonMode ? extractJson(text) : text,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

// ───────────────────────────── OpenAI-compatible ─────────────────────────────

type OpenAICompatibleConfig = {
  label: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  headers?: Record<string, string>;
  /** OpenAI's newer models only accept `max_completion_tokens` and reject non-default temperature. */
  strictOpenAI?: boolean;
};

class OpenAICompatibleProvider implements ChatProvider {
  readonly label: string;
  readonly defaultModel: string;

  constructor(
    readonly name: Exclude<ProviderName, "anthropic" | "puter" | "none">,
    private readonly cfg: OpenAICompatibleConfig,
  ) {
    this.label = cfg.label;
    this.defaultModel = cfg.defaultModel;
  }

  async chatCompletions(messages: AIMessage[], options: AICallOptions): Promise<ProviderResult> {
    const prepared = options.jsonMode ? withJsonInstruction(messages) : messages;
    const model = options.model ?? this.defaultModel;
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

    const body: Record<string, unknown> = {
      model,
      messages: prepared.map((m) => ({ role: m.role, content: m.content })),
      ...(this.cfg.strictOpenAI ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      ...(options.temperature != null && !this.cfg.strictOpenAI ? { temperature: options.temperature } : {}),
    };
    if (options.jsonMode) body.response_format = { type: "json_object" };

    let data = await this.post(body);

    // Some OpenRouter/Ollama models reject response_format; retry once without it.
    if (data.error && options.jsonMode && /response_format|json_object/i.test(JSON.stringify(data.error))) {
      delete body.response_format;
      data = await this.post(body);
    }
    if (data.error) {
      const err = data.error as { message?: string; code?: string | number; status?: number };
      throw new Error(`${this.label} error${err.code ? ` (${err.code})` : ""}: ${err.message ?? JSON.stringify(err)}`);
    }

    const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const message = choice?.message as { content?: unknown } | undefined;
    const content = message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
          : "";
    if (!text.trim()) throw new Error(`${this.label} returned no text content.`);

    const usage = (data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
    return {
      reply: options.jsonMode ? extractJson(text) : text.trim(),
      model: typeof data.model === "string" ? data.model : model,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    };
  }

  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        ...(this.cfg.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await response.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`${this.label} returned non-JSON (HTTP ${response.status}): ${raw.slice(0, 300)}`);
    }
    if (!response.ok && !data.error) {
      data.error = { message: raw.slice(0, 300), status: response.status };
    }
    return data;
  }
}

// ───────────────────────────── Puter (legacy) ─────────────────────────────

class PuterProvider implements ChatProvider {
  readonly name = "puter" as const;
  readonly label = "Puter.js (legacy)";
  readonly defaultModel = process.env.PUTER_MODEL?.trim() || "gpt-5-nano";

  async chatCompletions(messages: AIMessage[], options: AICallOptions): Promise<ProviderResult> {
    const prepared = options.jsonMode ? withJsonInstruction(messages) : messages;
    const args: Record<string, unknown> = {
      messages: prepared.map((m) => ({ role: m.role, content: m.content })),
      model: options.model ?? this.defaultModel,
    };
    if (options.maxTokens) args.max_tokens = options.maxTokens;
    if (options.temperature != null) args.temperature = options.temperature;

    const origin = process.env.PUTER_API_ORIGIN ?? "https://api.puter.com";
    const response = await fetch(`${origin}/drivers/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interface: "puter-chat-completion",
        driver: "ai-chat",
        method: "complete",
        test_mode: false,
        args,
        auth_token: process.env.PUTER_AUTH_TOKEN ?? null,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await response.text();
    if (!response.ok) throw new Error(`Puter API error (${response.status}): ${raw.slice(0, 300)}`);

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`Puter API returned non-JSON: ${raw.slice(0, 300)}`);
    }

    const result = (data.result ?? data) as Record<string, unknown>;
    const message = result.message as { content?: unknown } | undefined;
    const choices = result.choices as Array<{ message?: { content?: unknown } }> | undefined;
    const content = message?.content ?? choices?.[0]?.message?.content ?? result.text ?? data.text;
    const text = typeof content === "string" ? content : "";
    if (!text.trim()) {
      const finish = (choices?.[0] as { finish_reason?: string } | undefined)?.finish_reason ?? (result.finish_reason as string | undefined);
      throw new Error(
        finish === "length"
          ? "Puter returned an empty reply because max_tokens was exhausted before any text was produced. Raise maxTokens or pick a non-reasoning model."
          : `Puter API returned no extractable reply: ${raw.slice(0, 300)}`,
      );
    }

    const usage = (result.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
    return {
      reply: options.jsonMode ? extractJson(text) : text.trim(),
      model: typeof result.model === "string" ? result.model : String(args.model),
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    };
  }
}

// ───────────────────────────── None ─────────────────────────────

export const NO_PROVIDER_MESSAGE =
  "No AI provider is configured. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OLLAMA_BASE_URL, PUTER_AUTH_TOKEN) in your .env and restart the server.";

class NullProvider implements ChatProvider {
  readonly name = "none" as const;
  readonly label = "Not configured";
  readonly defaultModel = "none";

  async chatCompletions(): Promise<ProviderResult> {
    throw new Error(NO_PROVIDER_MESSAGE);
  }
}

// ───────────────────────────── Factory ─────────────────────────────

type ProviderSpec = {
  name: Exclude<ProviderName, "none">;
  label: string;
  envHint: string;
  detect: () => boolean;
  create: () => ChatProvider;
};

const env = () => process.env;

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    name: "anthropic",
    label: "Anthropic Claude",
    envHint: "ANTHROPIC_API_KEY",
    detect: () => Boolean(env().ANTHROPIC_API_KEY || env().ANTHROPIC_AUTH_TOKEN),
    create: () => new AnthropicProvider(),
  },
  {
    name: "openai",
    label: "OpenAI",
    envHint: "OPENAI_API_KEY",
    detect: () => Boolean(env().OPENAI_API_KEY),
    create: () =>
      new OpenAICompatibleProvider("openai", {
        label: "OpenAI",
        baseUrl: env().OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: env().OPENAI_API_KEY,
        defaultModel: env().OPENAI_MODEL?.trim() || "gpt-5-mini",
        strictOpenAI: true,
      }),
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    envHint: "OPENROUTER_API_KEY",
    detect: () => Boolean(env().OPENROUTER_API_KEY),
    create: () =>
      new OpenAICompatibleProvider("openrouter", {
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: env().OPENROUTER_API_KEY,
        defaultModel: env().OPENROUTER_MODEL?.trim() || "anthropic/claude-sonnet-4.5",
        headers: {
          "HTTP-Referer": env().APP_URL ?? "https://github.com/founderos",
          "X-Title": "FounderOS",
        },
      }),
  },
  {
    name: "groq",
    label: "Groq",
    envHint: "GROQ_API_KEY",
    detect: () => Boolean(env().GROQ_API_KEY),
    create: () =>
      new OpenAICompatibleProvider("groq", {
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: env().GROQ_API_KEY,
        defaultModel: env().GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
      }),
  },
  {
    name: "ollama",
    label: "Ollama (local)",
    envHint: "OLLAMA_BASE_URL (e.g. http://localhost:11434)",
    detect: () => Boolean(env().OLLAMA_BASE_URL || env().OLLAMA_MODEL),
    create: () =>
      new OpenAICompatibleProvider("ollama", {
        label: "Ollama",
        baseUrl: `${(env().OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "")}/v1`,
        defaultModel: env().OLLAMA_MODEL?.trim() || "llama3.1",
      }),
  },
  {
    name: "puter",
    label: "Puter.js (legacy)",
    envHint: "PUTER_AUTH_TOKEN",
    detect: () => Boolean(env().PUTER_AUTH_TOKEN),
    create: () => new PuterProvider(),
  },
];

export type ProviderStatus = {
  name: ProviderName;
  label: string;
  envHint: string;
  status: "active" | "configured" | "not_configured";
  model: string | null;
};

export class ProviderFactory {
  private instances = new Map<ProviderName, ChatProvider>();
  private activeName: ProviderName | null = null;

  /** Re-read the environment. Called lazily on first use. */
  reload(): void {
    this.instances.clear();
    this.activeName = null;
  }

  private resolveActiveName(): ProviderName {
    if (this.activeName) return this.activeName;

    const requested = process.env.AI_PROVIDER?.trim().toLowerCase();
    if (requested) {
      const spec = PROVIDER_SPECS.find((s) => s.name === requested);
      if (!spec) {
        logger.warn({ requested }, "Unknown AI_PROVIDER; falling back to auto-detection");
      } else {
        if (!spec.detect()) {
          logger.warn({ provider: spec.name, envHint: spec.envHint }, "AI_PROVIDER is set but its credential is missing");
        }
        this.activeName = spec.name;
        return spec.name;
      }
    }

    const detected = PROVIDER_SPECS.find((s) => s.detect());
    this.activeName = detected?.name ?? "none";
    if (detected) {
      logger.info({ provider: detected.name }, "AI provider auto-detected");
    } else {
      logger.warn("No AI provider configured; AI features will return a setup message");
    }
    return this.activeName;
  }

  getProvider(name?: ProviderName): ChatProvider {
    const target = name ?? this.resolveActiveName();
    const cached = this.instances.get(target);
    if (cached) return cached;

    const spec = PROVIDER_SPECS.find((s) => s.name === target);
    const instance = spec ? spec.create() : new NullProvider();
    this.instances.set(target, instance);
    return instance;
  }

  getActive(): { name: ProviderName; label: string; model: string; configured: boolean } {
    const provider = this.getProvider();
    const spec = PROVIDER_SPECS.find((s) => s.name === provider.name);
    return {
      name: provider.name,
      label: provider.label,
      model: provider.defaultModel,
      configured: spec ? spec.detect() : false,
    };
  }

  getAvailableProviders(): ProviderStatus[] {
    const active = this.resolveActiveName();
    return PROVIDER_SPECS.map((spec) => {
      const configured = spec.detect();
      const status: ProviderStatus["status"] =
        spec.name === active ? "active" : configured ? "configured" : "not_configured";
      return {
        name: spec.name,
        label: spec.label,
        envHint: spec.envHint,
        status,
        model: configured || spec.name === active ? this.getProvider(spec.name).defaultModel : null,
      };
    });
  }
}

export const providerFactory = new ProviderFactory();
