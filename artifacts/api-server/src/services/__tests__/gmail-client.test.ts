import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// gmail-sync imports the db module, which throws at import time without a URL.
// Nothing below queries the database, so an unreachable address is fine.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:9/test";

const { GMAIL_SCOPE, GmailClient, GoogleApiError, buildAuthUrl, exchangeCode, refreshAccessToken } = await import("../gmail-client");
const { decryptSecret, deriveKey, encryptSecret, signState, verifyState } = await import("../gmail-sync");

/**
 * A stand-in for Google's token endpoint and the Gmail API: 250 messages,
 * one per hour going back from NOW, newest first, 100 per page.
 */
const NOW = Date.UTC(2026, 9, 19, 12);
const HOUR = 60 * 60 * 1000;
const MESSAGES = Array.from({ length: 250 }, (_, i) => ({
  id: `m${i}`,
  internalDate: String(NOW - i * HOUR),
  labelIds: i % 2 ? ["INBOX"] : ["SENT"],
  payload: {
    headers: [
      { name: "From", value: i % 2 ? `Lead ${i} <lead${i}@example.com>` : "me@founder.dev" },
      { name: "to", value: i % 2 ? "me@founder.dev" : `lead${i}@example.com` },
      { name: "Subject", value: `Message ${i}` },
    ],
  },
}));

let server: Server;
let gets = 0;
let flakyLeft = 0;
const tokenForms: URLSearchParams[] = [];

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      tokenForms.push(form);
      if (form.get("refresh_token") === "revoked") return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      return json(200, {
        access_token: `access-${tokenForms.length}`,
        expires_in: 3599,
        scope: GMAIL_SCOPE,
        token_type: "Bearer",
        ...(form.get("grant_type") === "authorization_code" ? { refresh_token: "refresh-1" } : {}),
      });
    }

    if (!req.headers.authorization?.startsWith("Bearer access-")) return json(401, { error: { message: "Invalid Credentials", status: "UNAUTHENTICATED" } });

    if (url.pathname === "/gmail/v1/users/me/profile") return json(200, { emailAddress: "me@founder.dev" });

    if (url.pathname === "/gmail/v1/users/me/messages") {
      assert.equal(url.searchParams.get("q"), null, "the metadata scope does not allow q");
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = MESSAGES.slice(start, start + 100);
      return json(200, {
        messages: page.map((m) => ({ id: m.id, threadId: m.id })),
        ...(start + 100 < MESSAGES.length ? { nextPageToken: String(start + 100) } : {}),
      });
    }

    const match = url.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/(m\d+)$/);
    if (match) {
      gets++;
      assert.equal(url.searchParams.get("format"), "metadata");
      assert.deepEqual(url.searchParams.getAll("metadataHeaders"), ["From", "To", "Cc", "Subject"]);
      if (flakyLeft > 0) {
        flakyLeft--;
        return json(429, { error: { message: "Rate limit", status: "RESOURCE_EXHAUSTED" } });
      }
      const msg = MESSAGES.find((m) => m.id === match[1]);
      return msg ? json(200, msg) : json(404, { error: { message: "Not Found", status: "NOT_FOUND" } });
    }

    json(404, { error: { message: "unknown route" } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  process.env.GOOGLE_API_EMULATOR_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  delete process.env.GOOGLE_API_EMULATOR_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const client = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "client-secret" };

describe("Google OAuth", () => {
  it("asks for the metadata scope with offline access", () => {
    const url = new URL(buildAuthUrl({ ...client, redirectUri: "http://localhost:5000/api/integrations/gmail/callback", state: "abc" }));
    assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.metadata");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "abc");
  });

  it("exchanges a code for a refresh token and refreshes it later", async () => {
    const tokens = await exchangeCode({ ...client, code: "code-1", redirectUri: "http://localhost:5000/cb" });
    assert.equal(tokens.refreshToken, "refresh-1");
    assert.ok(tokens.expiresAt > Date.now());
    assert.equal(tokenForms.at(-1)?.get("redirect_uri"), "http://localhost:5000/cb");

    const refreshed = await refreshAccessToken({ ...client, refreshToken: "refresh-1" });
    assert.match(refreshed.accessToken, /^access-/);
    assert.equal(tokenForms.at(-1)?.get("grant_type"), "refresh_token");
  });

  it("surfaces invalid_grant so a revoked connection can ask to reconnect", async () => {
    await assert.rejects(refreshAccessToken({ ...client, refreshToken: "revoked" }), (err) => {
      assert.ok(err instanceof GoogleApiError);
      assert.equal(err.code, "invalid_grant");
      return true;
    });
  });
});

describe("GmailClient", () => {
  const gmail = new GmailClient(async () => "access-test");

  it("reads the mailbox profile", async () => {
    assert.equal((await gmail.getProfile()).emailAddress, "me@founder.dev");
  });

  it("parses headers case-insensitively", async () => {
    const msg = await gmail.getMessageHeaders("m1");
    assert.equal(msg.to, "me@founder.dev");
    assert.equal(msg.from, "Lead 1 <lead1@example.com>");
    assert.equal(msg.cc, null);
    assert.equal(msg.internalDate, NOW - HOUR);
  });

  it("pages back only as far as the cursor", async () => {
    gets = 0;
    const { messages, truncated } = await gmail.listMessagesSince(new Date(NOW - 150 * HOUR), 5000);
    assert.equal(messages.length, 151);
    assert.equal(truncated, false);
    assert.equal(gets, 200, "stops after the page that crosses the cursor");
  });

  it("stops at the message cap and says so", async () => {
    const { messages, truncated } = await gmail.listMessagesSince(new Date(NOW - 1000 * HOUR), 120);
    assert.equal(messages.length, 120);
    assert.equal(truncated, true);
  });

  it("retries rate limits", async () => {
    flakyLeft = 1;
    const msg = await gmail.getMessageHeaders("m2");
    assert.equal(msg.id, "m2");
  });

  it("reports auth failures with Google's message", async () => {
    const bad = new GmailClient(async () => "wrong");
    await assert.rejects(bad.getProfile(), /401.*Invalid Credentials/);
  });
});

describe("token and state sealing", () => {
  const key = deriveKey("token", "secret-a");

  it("round-trips a refresh token and hides it at rest", () => {
    const sealed = encryptSecret("1//refresh-token", key);
    assert.doesNotMatch(sealed, /refresh-token/);
    assert.equal(decryptSecret(sealed, key), "1//refresh-token");
  });

  it("refuses to decrypt with a different client secret", () => {
    const sealed = encryptSecret("1//refresh-token", key);
    assert.throws(() => decryptSecret(sealed, deriveKey("token", "secret-b")));
  });

  it("accepts its own state and rejects tampered or expired state", () => {
    const stateKey = deriveKey("state", "secret-a");
    const payload = { nonce: "n1", redirectUri: "http://localhost:5000/api/integrations/gmail/callback", exp: Date.now() + 60_000 };
    const state = signState(payload, stateKey);
    assert.deepEqual(verifyState(state, stateKey), payload);

    const [body, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, redirectUri: "https://evil.example/cb" })).toString("base64url");
    assert.equal(verifyState(`${forged}.${sig}`, stateKey), null);
    assert.equal(verifyState(`${body}.${sig}`, deriveKey("state", "secret-b")), null);
    assert.equal(verifyState(state, stateKey, payload.exp + 1), null);
  });
});
