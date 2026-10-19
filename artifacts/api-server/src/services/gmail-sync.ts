import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, integrationsTable, leadsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { logActivity } from "../lib/activity-logger";
import { publishOperationalEvent } from "../lib/event-bus";
import {
  GMAIL_SCOPE,
  GmailClient,
  GoogleApiError,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  type OAuthClient,
} from "./gmail-client";
import { normalizeEmail, summarizeEmailActivity, syncCursor } from "./gmail-rules";
import { salesAgent } from "./sales-agent";

/**
 * Optional Gmail sync. The founder connects Gmail once; every few minutes
 * FounderOS reads the headers of new mail (never bodies) and moves each
 * lead's last-contact date to the latest email either way, so the silence
 * clock stays right without logging contacts by hand.
 */

const PROVIDER = "gmail";
const STATE_TTL_MS = 10 * 60 * 1000;
export const GMAIL_CALLBACK_PATH = "/api/integrations/gmail/callback";

type Lead = typeof leadsTable.$inferSelect;
type SyncTrigger = "connect" | "startup" | "scheduled" | "manual" | "mcp";

export type GmailSyncResult = {
  trigger: SyncTrigger;
  since: string;
  finishedAt: string;
  messagesRead: number;
  leadsMatched: number;
  clocksMoved: number;
  draftsClosed: number;
  truncated: boolean;
};

export type GmailStatus = {
  configured: boolean;
  problem: string | null;
  connected: boolean;
  needsReconnect: boolean;
  accountEmail: string | null;
  lastSyncedAt: string | null;
  lastSync: GmailSyncResult | null;
  lastError: string | null;
  syncing: boolean;
  redirectUri: string | null;
  intervalMinutes: number;
  scope: string;
};

/** Expected failures with an HTTP status the route can pass through. */
export class GmailSyncError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "GmailSyncError";
  }
}

function envNumber(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

const intervalMinutes = () => envNumber("GMAIL_SYNC_INTERVAL_MINUTES", 15, 1);
const lookbackDays = () => envNumber("GMAIL_SYNC_LOOKBACK_DAYS", 30, 1);
const maxMessages = () => envNumber("GMAIL_SYNC_MAX_MESSAGES", 2000, 50);

function oauthClient(): OAuthClient | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function gmailConfigProblem(): string | null {
  return oauthClient() ? null : "Gmail sync is off. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart.";
}

/** The redirect URI when the deployment pins one; otherwise the route derives it from the browser's origin. */
export function configuredRedirectUri(): string | null {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.APP_URL?.trim().replace(/\/$/, "");
  return appUrl ? `${appUrl}${GMAIL_CALLBACK_PATH}` : null;
}

// ───────────────────────────── secrets ─────────────────────────────

/** Keys derived from GOOGLE_CLIENT_SECRET, one per purpose. Rotating the secret means reconnecting Gmail. */
export function deriveKey(purpose: "token" | "state", secret?: string): Buffer {
  const material = secret ?? oauthClient()?.clientSecret;
  if (!material) throw new GmailSyncError(gmailConfigProblem() ?? "Gmail sync is not configured.", 412);
  return createHash("sha256").update(`founderos-gmail:${purpose}:v1:${material}`).digest();
}

export function encryptSecret(plain: string, key = deriveKey("token")): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string, key = deriveKey("token")): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized token format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

type OAuthState = { nonce: string; redirectUri: string; exp: number };

/** Signed OAuth state: the callback can trust the redirect URI it carries. */
export function signState(payload: OAuthState, key = deriveKey("state")): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function verifyState(state: string, key = deriveKey("state"), now = Date.now()): OAuthState | null {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;
  const given = Buffer.from(signature);
  const expected = Buffer.from(createHmac("sha256", key).update(body).digest("base64url"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    return typeof payload.exp === "number" && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

// ───────────────────────────── service ─────────────────────────────

class GmailSync {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private accessToken: { value: string; expiresAt: number } | null = null;

  /** Periodic sync while Gmail is connected. Does nothing until the OAuth client is configured. */
  start(): void {
    if (!oauthClient()) return;
    const everyMs = intervalMinutes() * 60 * 1000;

    const firstRun = setTimeout(() => void this.backgroundSync("startup"), 30_000);
    firstRun.unref();
    this.timer = setInterval(() => void this.backgroundSync("scheduled"), everyMs);
    this.timer.unref();

    logger.info({ everyMinutes: intervalMinutes() }, "Gmail sync scheduler started");
  }

  async status(): Promise<GmailStatus> {
    const row = await this.connection();
    return {
      configured: oauthClient() !== null,
      problem: gmailConfigProblem(),
      connected: Boolean(row),
      needsReconnect: row?.status === "reconnect",
      accountEmail: row?.accountEmail ?? null,
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
      lastSync: (row?.lastSyncResult as GmailSyncResult | null | undefined) ?? null,
      lastError: row?.lastError ?? null,
      syncing: this.syncing,
      redirectUri: configuredRedirectUri(),
      intervalMinutes: intervalMinutes(),
      scope: GMAIL_SCOPE,
    };
  }

  /** Step 1 of connecting: Google's consent URL, plus a nonce the route pins to the browser in a cookie. */
  beginConnect(redirectUri: string): { url: string; nonce: string } {
    const client = oauthClient();
    if (!client) throw new GmailSyncError(gmailConfigProblem()!, 412);
    const nonce = randomBytes(16).toString("base64url");
    const state = signState({ nonce, redirectUri, exp: Date.now() + STATE_TTL_MS });
    return { url: buildAuthUrl({ ...client, redirectUri, state }), nonce };
  }

  /** Step 2: Google redirected back with a code. Store the refresh token and run a first sync. */
  async completeConnect(params: { code: string; state: string; nonce: string | undefined }): Promise<{ accountEmail: string }> {
    const client = oauthClient();
    if (!client) throw new GmailSyncError(gmailConfigProblem()!, 412);

    const state = verifyState(params.state);
    if (!state || !params.nonce || state.nonce !== params.nonce) {
      throw new GmailSyncError("This Gmail connection link expired or was opened in another browser. Start again from Settings.", 400);
    }

    const tokens = await exchangeCode({ ...client, code: params.code, redirectUri: state.redirectUri });
    if (tokens.scope && !tokens.scope.split(" ").includes(GMAIL_SCOPE)) {
      throw new GmailSyncError("Gmail access wasn't granted. Connect again and tick the Gmail permission on Google's screen.", 400);
    }
    if (!tokens.refreshToken) {
      throw new GmailSyncError(
        "Google didn't return a long-lived token. Remove FounderOS under Google Account → Security → Third-party access, then connect again.",
        400,
      );
    }

    this.accessToken = { value: tokens.accessToken, expiresAt: tokens.expiresAt };
    const profile = await new GmailClient(() => this.getAccessToken()).getProfile();

    const values = {
      accountEmail: profile.emailAddress,
      refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
      scope: tokens.scope,
      status: "connected",
      lastSyncedAt: null,
      lastSyncResult: null,
      lastError: null,
    };
    await db
      .insert(integrationsTable)
      .values({ provider: PROVIDER, ...values })
      .onConflictDoUpdate({ target: integrationsTable.provider, set: { ...values, updatedAt: new Date() } });

    await logActivity({
      entityType: "integration",
      action: "gmail_connected",
      actorType: "user",
      actorName: "Founder",
      details: { accountEmail: profile.emailAddress },
    });

    void this.backgroundSync("connect");
    return { accountEmail: profile.emailAddress };
  }

  async disconnect(): Promise<{ disconnected: boolean; revokedAtGoogle: boolean }> {
    const row = await this.connection();
    if (!row) return { disconnected: false, revokedAtGoogle: false };

    let revokedAtGoogle = false;
    try {
      revokedAtGoogle = await revokeToken(decryptSecret(row.refreshTokenEncrypted));
    } catch {
      // Undecryptable token: nothing we can revoke, still remove it locally.
    }
    await db.delete(integrationsTable).where(eq(integrationsTable.provider, PROVIDER));
    this.accessToken = null;

    await logActivity({
      entityType: "integration",
      action: "gmail_disconnected",
      actorType: "user",
      actorName: "Founder",
      details: { accountEmail: row.accountEmail, revokedAtGoogle },
    });
    return { disconnected: true, revokedAtGoogle };
  }

  /** Read new mail headers and update leads. Throws GmailSyncError when it can't run. */
  async sync(trigger: SyncTrigger): Promise<GmailSyncResult> {
    if (!oauthClient()) throw new GmailSyncError(gmailConfigProblem()!, 412);
    if (this.syncing) throw new GmailSyncError("A Gmail sync is already running. Try again in a minute.", 409);
    const row = await this.connection();
    if (!row) throw new GmailSyncError("Gmail isn't connected. Connect it in Settings first.", 412);
    if (row.status === "reconnect") throw new GmailSyncError(row.lastError ?? "Reconnect Gmail in Settings.", 412);

    this.syncing = true;
    const startedAt = new Date();
    try {
      const since = syncCursor(row.lastSyncedAt, startedAt, lookbackDays());
      const gmail = new GmailClient(() => this.getAccessToken());
      const { messages, truncated } = await gmail.listMessagesSince(since, maxMessages());

      const leads = await db
        .select()
        .from(leadsTable)
        .where(and(isNull(leadsTable.deletedAt), isNotNull(leadsTable.email)));
      const byEmail = new Map<string, Lead[]>();
      for (const lead of leads) {
        const key = normalizeEmail(lead.email ?? "");
        if (key) byEmail.set(key, [...(byEmail.get(key) ?? []), lead]);
      }

      let leadsMatched = 0;
      let clocksMoved = 0;
      let draftsClosed = 0;
      for (const [email, activity] of summarizeEmailActivity(messages, byEmail.keys())) {
        for (const lead of byEmail.get(email) ?? []) {
          leadsMatched++;
          const outcome = await salesAgent.applyEmailActivity(lead, activity);
          if (outcome.clockMoved) clocksMoved++;
          if (outcome.draftClosed) draftsClosed++;
        }
      }

      const result: GmailSyncResult = {
        trigger,
        since: since.toISOString(),
        finishedAt: new Date().toISOString(),
        messagesRead: messages.length,
        leadsMatched,
        clocksMoved,
        draftsClosed,
        truncated,
      };
      await db
        .update(integrationsTable)
        .set({ lastSyncedAt: startedAt, lastSyncResult: result, lastError: null, updatedAt: new Date() })
        .where(eq(integrationsTable.provider, PROVIDER));

      if (clocksMoved || draftsClosed) publishOperationalEvent("sales.gmail.synced", { ...result });
      logger.info(result, "Gmail sync finished");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(integrationsTable)
        .set({ lastError: message, updatedAt: new Date() })
        .where(eq(integrationsTable.provider, PROVIDER))
        .catch(() => undefined);
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  private async backgroundSync(trigger: SyncTrigger): Promise<void> {
    try {
      const row = await this.connection();
      if (!row || row.status !== "connected" || this.syncing) return;
      await this.sync(trigger);
    } catch (err) {
      logger.warn({ err, trigger }, "Background Gmail sync failed");
    }
  }

  private async connection() {
    const [row] = await db.select().from(integrationsTable).where(eq(integrationsTable.provider, PROVIDER)).limit(1);
    return row ?? null;
  }

  private async markNeedsReconnect(message: string): Promise<void> {
    this.accessToken = null;
    await db
      .update(integrationsTable)
      .set({ status: "reconnect", lastError: message, updatedAt: new Date() })
      .where(eq(integrationsTable.provider, PROVIDER));
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > Date.now()) return this.accessToken.value;

    const client = oauthClient();
    const row = await this.connection();
    if (!client || !row) throw new GmailSyncError("Gmail isn't connected.", 412);

    let refreshToken: string;
    try {
      refreshToken = decryptSecret(row.refreshTokenEncrypted);
    } catch {
      const message = "Saved Gmail credentials can't be read (did GOOGLE_CLIENT_SECRET change?). Reconnect Gmail in Settings.";
      await this.markNeedsReconnect(message);
      throw new GmailSyncError(message, 412);
    }

    try {
      const tokens = await refreshAccessToken({ ...client, refreshToken });
      this.accessToken = { value: tokens.accessToken, expiresAt: tokens.expiresAt };
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof GoogleApiError && err.code === "invalid_grant") {
        const message =
          "Google ended FounderOS's access to Gmail (revoked, password changed, or the 7-day limit for apps in Testing mode). Reconnect Gmail in Settings.";
        await this.markNeedsReconnect(message);
        throw new GmailSyncError(message, 412);
      }
      throw err;
    }
  }
}

export const gmailSync = new GmailSync();
