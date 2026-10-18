import { Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { checkMcpAuth } from "./auth";
import { createFounderOsMcpServer } from "./server";
import { logger } from "../lib/logger";

/**
 * Stateless Streamable HTTP endpoint. A fresh server and transport handle
 * every POST, so there is no session state to lose across restarts or
 * replicas.
 */
const router = Router();

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function publicBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

async function handlePost(req: Request, res: Response): Promise<void> {
  const token = typeof req.params.token === "string" ? req.params.token : null;
  const auth = checkMcpAuth({ authorization: req.headers.authorization, pathToken: token });
  if (!auth.ok) {
    jsonRpcError(res, auth.status, -32001, auth.message);
    return;
  }

  const server = createFounderOsMcpServer({ baseUrl: publicBaseUrl(req) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, "MCP request failed");
    if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
  }
}

function methodNotAllowed(_req: Request, res: Response): void {
  jsonRpcError(res, 405, -32000, "Method not allowed. This MCP server is stateless; use POST.");
}

router.post("/mcp", handlePost);
router.post("/mcp/:token", handlePost);
router.get(["/mcp", "/mcp/:token"], methodNotAllowed);
router.delete(["/mcp", "/mcp/:token"], methodNotAllowed);

export default router;
