import { z } from "zod/v4";

export type ToolContext = Record<string, unknown>;

export type ToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

export interface Tool {
  /** Unique tool name, namespaced by domain, e.g. "task.create". */
  name: string;
  /** Plain-language description used for AI discovery. */
  description: string;
  /** Human-readable parameter schema used in the command discovery prompt. */
  parametersDescription: string;
  /** Zod schema — source of truth for argument validation. */
  parameters: z.ZodType;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
