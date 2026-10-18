import { timingSafeEqual } from "node:crypto";

/**
 * Access control for the MCP endpoint.
 *
 * MCP is off until MCP_TOKEN is set, because connecting ChatGPT requires a
 * public HTTPS URL and an open endpoint would expose the whole pipeline.
 * Two ways to present the token:
 *
 *   POST /mcp            Authorization: Bearer <MCP_TOKEN>   (Claude, Cursor, Inspector)
 *   POST /mcp/<MCP_TOKEN>                                     (ChatGPT, which cannot send custom headers)
 */

export const MIN_MCP_TOKEN_LENGTH = 24;

export function mcpToken(): string | null {
  const token = process.env.MCP_TOKEN?.trim();
  return token ? token : null;
}

/** Null when MCP is usable, otherwise a message explaining how to enable it. */
export function mcpConfigProblem(): string | null {
  const token = mcpToken();
  if (!token) {
    return "MCP is disabled. Set MCP_TOKEN in the server environment to a random string of at least 24 characters and restart.";
  }
  if (token.length < MIN_MCP_TOKEN_LENGTH) {
    return `MCP_TOKEN is too short (${token.length} characters). Use at least ${MIN_MCP_TOKEN_LENGTH} random characters.`;
  }
  return null;
}

export type McpAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string };

function safeEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkMcpAuth(input: { authorization?: string | null; pathToken?: string | null }): McpAuthResult {
  const problem = mcpConfigProblem();
  if (problem) return { ok: false, status: 503, message: problem };
  const expected = mcpToken()!;

  if (input.pathToken && safeEqual(input.pathToken, expected)) return { ok: true };

  const header = input.authorization?.trim();
  const bearer = header && /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, "").trim() : null;
  if (bearer && safeEqual(bearer, expected)) return { ok: true };

  return {
    ok: false,
    status: 401,
    message: "Invalid or missing MCP token. Send Authorization: Bearer <MCP_TOKEN>, or use the /mcp/<MCP_TOKEN> URL.",
  };
}

/** Replace a token embedded in an /mcp/<token> path so it never reaches logs. */
export function redactMcpPath(url: string | undefined): string | undefined {
  return url?.replace(/^\/mcp\/[^/?#]+/, "/mcp/[redacted]");
}
