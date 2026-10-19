import type { MessageHeaders } from "./gmail-rules";

/**
 * The few Google OAuth and Gmail API calls Gmail sync needs, over plain
 * fetch so FounderOS does not pull in the googleapis package.
 */

/** Headers only: Google's consent screen says FounderOS cannot read message bodies. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

type Endpoints = { auth: string; token: string; revoke: string; gmail: string };

export function googleEndpoints(): Endpoints {
  // Points every call at a local stand-in for Google. Used by the test suite.
  const emulator = process.env.GOOGLE_API_EMULATOR_URL?.trim().replace(/\/$/, "");
  if (emulator) {
    return {
      auth: `${emulator}/o/oauth2/v2/auth`,
      token: `${emulator}/token`,
      revoke: `${emulator}/revoke`,
      gmail: `${emulator}/gmail/v1/users/me`,
    };
  }
  return {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: "https://oauth2.googleapis.com/revoke",
    gmail: "https://gmail.googleapis.com/gmail/v1/users/me",
  };
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google's error code, e.g. "invalid_grant" when access was revoked. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type TokenSet = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
  scope: string | null;
};

export type OAuthClient = { clientId: string; clientSecret: string };

export function buildAuthUrl(params: OAuthClient & { redirectUri: string; state: string }): string {
  const url = new URL(googleEndpoints().auth);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    // offline + consent makes Google return a refresh token every time.
    access_type: "offline",
    prompt: "consent",
    state: params.state,
  }).toString();
  return url.toString();
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(googleEndpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    const code = typeof body.error === "string" ? body.error : undefined;
    const detail = typeof body.error_description === "string" ? body.error_description : code;
    throw new GoogleApiError(`Google token request failed (${res.status})${detail ? `: ${detail}` : ""}`, res.status, code);
  }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

export function exchangeCode(params: OAuthClient & { code: string; redirectUri: string }): Promise<TokenSet> {
  return tokenRequest({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
}

export function refreshAccessToken(params: OAuthClient & { refreshToken: string }): Promise<TokenSet> {
  return tokenRequest({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
  });
}

/** Best effort: disconnecting locally must work even if Google is unreachable. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(googleEndpoints().revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type RawMessage = {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
};

export function toMessageHeaders(raw: RawMessage): MessageHeaders {
  const header = (name: string) =>
    raw.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  return {
    id: raw.id,
    internalDate: Number(raw.internalDate ?? 0),
    labelIds: raw.labelIds ?? [],
    from: header("From"),
    to: header("To"),
    cc: header("Cc"),
    subject: header("Subject"),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gmail calls for one mailbox. `getAccessToken` refreshes as needed. */
export class GmailClient {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  private async get<T>(path: string, query?: URLSearchParams): Promise<T> {
    const url = `${googleEndpoints().gmail}${path}${query ? `?${query}` : ""}`;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as T;

      // Rate limits and Google-side hiccups are worth a short retry.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
      throw new GoogleApiError(
        `Gmail API ${path} failed (${res.status})${body.error?.message ? `: ${body.error.message}` : ""}`,
        res.status,
        body.error?.status,
      );
    }
  }

  getProfile(): Promise<{ emailAddress: string }> {
    return this.get("/profile");
  }

  async listMessageIds(pageToken?: string): Promise<{ ids: string[]; nextPageToken: string | null }> {
    const query = new URLSearchParams({ maxResults: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const body = await this.get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>("/messages", query);
    return { ids: (body.messages ?? []).map((m) => m.id), nextPageToken: body.nextPageToken ?? null };
  }

  async getMessageHeaders(id: string): Promise<MessageHeaders> {
    const query = new URLSearchParams({ format: "metadata" });
    for (const name of ["From", "To", "Cc", "Subject"]) query.append("metadataHeaders", name);
    return toMessageHeaders(await this.get<RawMessage>(`/messages/${encodeURIComponent(id)}`, query));
  }

  /**
   * Headers of every message newer than `since`, newest first, up to `max`.
   * Gmail lists newest first, so reading stops at the first page that
   * reaches back past `since`.
   */
  async listMessagesSince(since: Date, max: number, concurrency = 8): Promise<{ messages: MessageHeaders[]; truncated: boolean }> {
    const messages: MessageHeaders[] = [];
    let pageToken: string | undefined;

    for (;;) {
      const page = await this.listMessageIds(pageToken);
      const headers: MessageHeaders[] = [];
      for (let i = 0; i < page.ids.length; i += concurrency) {
        headers.push(...(await Promise.all(page.ids.slice(i, i + concurrency).map((id) => this.getMessageHeaders(id)))));
      }

      let reachedCursor = false;
      for (const msg of headers) {
        if (msg.internalDate < since.getTime()) {
          reachedCursor = true;
          continue;
        }
        messages.push(msg);
        if (messages.length >= max) return { messages, truncated: true };
      }
      if (reachedCursor || !page.nextPageToken) return { messages, truncated: false };
      pageToken = page.nextPageToken;
    }
  }
}
