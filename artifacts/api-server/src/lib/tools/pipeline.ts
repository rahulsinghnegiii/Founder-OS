import { toolRegistry } from "./registry";
import { logger } from "../logger";
import { createEnvelope, publishEnvelope, newCorrelationId, type CorrelationContext } from "../event-envelope";
import type { ToolContext, ToolResult } from "./types";

export type ToolStatus = "success" | "failure" | "not_found" | "invalid_args";

export type ToolExecutionResult = ToolResult & {
  tool: string;
  status: ToolStatus;
  durationMs: number;
  startedAt: string;
};

/**
 * Maps a tool name to the domain event emitted on a successful run, so
 * downstream subscribers (e.g. the Workflow Engine) can react to real
 * business changes rather than internal tool mechanics.
 */
const DOMAIN_EVENT_BY_TOOL: Record<string, string> = {
  "task.create": "task.created",
  "task.delete": "task.deleted",
  "department.create": "department.created",
  "department.rename": "department.renamed",
};

/**
 * Single execution path for every tool. Wraps the registry call with:
 *  - lifecycle events on the Event Bus (started / completed / failed)
 *  - a derived domain event for successful business mutations
 *  - timing + structured status for future observability
 * Tool-level activity logging stays inside each tool; the pipeline does not
 * duplicate it.
 */
export async function runTool(
  name: string,
  args: unknown,
  ctx: ToolContext = {},
): Promise<ToolExecutionResult> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const correlationId = newCorrelationId();
  const corr: CorrelationContext = { correlationId };

  publishEnvelope(createEnvelope("tool.execution.started", "tool-pipeline", { tool: name, args }, corr));

  const result = await toolRegistry.execute(name, args, ctx);
  const durationMs = Date.now() - start;

  let status: ToolStatus = result.ok ? "success" : "failure";
  if (!toolRegistry.has(name)) status = "not_found";
  else if (!result.ok && result.message.startsWith("Invalid arguments")) status = "invalid_args";

  const execution: ToolExecutionResult = {
    ...result,
    tool: name,
    status,
    durationMs,
    startedAt,
  };

  publishEnvelope(
    createEnvelope(
      result.ok ? "tool.execution.completed" : "tool.execution.failed",
      "tool-pipeline",
      { tool: name, status, durationMs, message: result.message },
      corr,
    ),
  );

  if (result.ok) {
    const domainEvent = DOMAIN_EVENT_BY_TOOL[name];
    const id =
      result.data && typeof result.data === "object" && "id" in (result.data as object)
        ? String((result.data as { id: unknown }).id)
        : undefined;
    publishEnvelope(
      createEnvelope(domainEvent ?? `tool.${name}.success`, "tool-pipeline", {
        tool: name,
        id,
        result: result.message,
      }, corr),
    );
  }

  logger.info({ tool: name, status, durationMs }, "Tool execution finished");

  return execution;
}
