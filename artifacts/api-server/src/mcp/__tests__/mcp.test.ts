import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// The db module throws at import time without a URL. Nothing below queries the
// database (tool listing and auth only), so an unreachable address is fine.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:9/test";

const { checkMcpAuth, mcpConfigProblem, redactMcpPath } = await import("../auth");
const { createFounderOsMcpServer, MCP_TOOL_NAMES, MCP_WRITE_TOOLS, MCP_SERVER_NAME } = await import("../server");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

const TOKEN = "test-token-0123456789abcdefghij";

function withToken<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.MCP_TOKEN;
  if (value === undefined) delete process.env.MCP_TOKEN;
  else process.env.MCP_TOKEN = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.MCP_TOKEN;
    else process.env.MCP_TOKEN = previous;
  }
}

describe("MCP token auth", () => {
  it("is disabled until MCP_TOKEN is set", () => {
    withToken(undefined, () => {
      assert.match(mcpConfigProblem() ?? "", /disabled/);
      const result = checkMcpAuth({ authorization: `Bearer ${TOKEN}` });
      assert.deepEqual(result.ok ? null : result.status, 503);
    });
  });

  it("rejects tokens that are too short to be safe", () => {
    withToken("short", () => {
      assert.match(mcpConfigProblem() ?? "", /too short/);
      assert.equal(checkMcpAuth({ pathToken: "short" }).ok, false);
    });
  });

  it("accepts the token as a bearer header, case-insensitively", () => {
    withToken(TOKEN, () => {
      assert.equal(checkMcpAuth({ authorization: `Bearer ${TOKEN}` }).ok, true);
      assert.equal(checkMcpAuth({ authorization: `bearer   ${TOKEN}` }).ok, true);
    });
  });

  it("accepts the token as a path segment for clients that cannot send headers", () => {
    withToken(TOKEN, () => {
      assert.equal(checkMcpAuth({ pathToken: TOKEN }).ok, true);
    });
  });

  it("returns 401 for wrong or missing tokens", () => {
    withToken(TOKEN, () => {
      for (const input of [{}, { authorization: "Bearer nope" }, { pathToken: `${TOKEN}x` }, { authorization: TOKEN }]) {
        const result = checkMcpAuth(input);
        assert.equal(result.ok, false);
        assert.equal(result.ok ? 0 : result.status, 401);
      }
    });
  });

  it("redacts the token from logged paths", () => {
    assert.equal(redactMcpPath(`/mcp/${TOKEN}`), "/mcp/[redacted]");
    assert.equal(redactMcpPath("/mcp"), "/mcp");
    assert.equal(redactMcpPath("/api/leads"), "/api/leads");
  });
});

describe("MCP tool surface", () => {
  it("registers exactly the advertised tools, each documented and annotated", async () => {
    const server = createFounderOsMcpServer({ baseUrl: "https://example.test" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      assert.equal(client.getServerVersion()?.name, MCP_SERVER_NAME);
      assert.match(client.getInstructions() ?? "", /never sends email/);

      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), [...MCP_TOOL_NAMES].sort());

      for (const tool of tools) {
        assert.ok(tool.title, `${tool.name} needs a title`);
        assert.ok((tool.description ?? "").length > 40, `${tool.name} needs a real description`);
        const writes = MCP_WRITE_TOOLS.has(tool.name);
        assert.equal(tool.annotations?.readOnlyHint, !writes, `${tool.name} readOnlyHint`);
        assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} destructiveHint`);
      }

      const search = tools.find((t) => t.name === "search");
      assert.deepEqual(search?.inputSchema.required, ["query"]);
      const fetchTool = tools.find((t) => t.name === "fetch");
      assert.deepEqual(fetchTool?.inputSchema.required, ["id"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects invalid arguments before touching the database", async () => {
    const server = createFounderOsMcpServer({ baseUrl: "https://example.test" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "founderos_list_leads", arguments: { limit: 500 } });
      assert.equal(result.isError, true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("MCP over Streamable HTTP", () => {
  let httpServer: Server;
  let baseUrl: string;
  const previousToken = process.env.MCP_TOKEN;

  before(async () => {
    process.env.MCP_TOKEN = TOKEN;
    const express = (await import("express")).default;
    const mcpRouter = (await import("../router")).default;
    const app = express();
    app.use(express.json());
    app.use(mcpRouter);
    await new Promise<void>((resolve) => {
      httpServer = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (previousToken === undefined) delete process.env.MCP_TOKEN;
    else process.env.MCP_TOKEN = previousToken;
  });

  const initialize = (url: string, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "0" } },
      }),
    });

  it("refuses requests without the token", async () => {
    const res = await initialize(`${baseUrl}/mcp`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.match(body.error?.message ?? "", /MCP token/);
  });

  it("answers GET with 405 because the server is stateless", async () => {
    const res = await fetch(`${baseUrl}/mcp/${TOKEN}`);
    assert.equal(res.status, 405);
  });

  it("initializes with the token in the path (ChatGPT style)", async () => {
    const res = await initialize(`${baseUrl}/mcp/${TOKEN}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    assert.equal(body.result?.serverInfo?.name, MCP_SERVER_NAME);
  });

  it("lists tools through the SDK client with a bearer header (Claude style)", async () => {
    const client = new Client({ name: "test-http-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, MCP_TOOL_NAMES.length);
    } finally {
      await client.close();
    }
  });
});
