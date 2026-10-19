import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// An "Ollama" that accepts the request and never answers.
let server: Server;

before(async () => {
  server = createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  process.env.AI_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  delete process.env.AI_PROVIDER;
  delete process.env.OLLAMA_BASE_URL;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("callAIWithRouting timeoutMs", () => {
  it("stops waiting and returns an error result the caller can fall back on", async () => {
    const { callAIWithRouting } = await import("../router");
    const started = Date.now();
    const result = await callAIWithRouting([{ role: "user", content: "Ping" }], { timeoutMs: 1500 });
    const waited = Date.now() - started;

    assert.ok(waited >= 1400 && waited < 5000, `waited ${waited} ms`);
    assert.equal(result.provider, "ollama");
    assert.match(result.error ?? "", /didn't reply within 2 seconds/);
  });
});
