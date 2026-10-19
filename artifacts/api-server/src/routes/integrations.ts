import { Router, type Response } from "express";
import { z } from "zod/v4";
import { isSecureRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import { GMAIL_CALLBACK_PATH, GmailSyncError, configuredRedirectUri, gmailSync } from "../services/gmail-sync";

const router = Router();

/** Binds the OAuth round trip to the browser that started it. */
const NONCE_COOKIE = "founderos_gmail_oauth";
const NONCE_COOKIE_PATH = "/api/integrations/gmail";

function fail(res: Response, err: unknown, fallback: string): void {
  if (err instanceof GmailSyncError) {
    res.status(err.httpStatus).json({ error: err.message });
    return;
  }
  logger.error({ err }, fallback);
  res.status(502).json({ error: err instanceof Error ? err.message : fallback });
}

router.get("/integrations/gmail", async (_req, res) => {
  try {
    res.json(await gmailSync.status());
  } catch (err) {
    fail(res, err, "Failed to read Gmail status");
  }
});

router.post("/integrations/gmail/connect", (req, res) => {
  const body = z.object({ origin: z.string().url().optional() }).safeParse(req.body ?? {});
  const origin = body.success && body.data.origin ? new URL(body.data.origin).origin : null;
  const redirectUri = configuredRedirectUri() ?? (origin ? `${origin}${GMAIL_CALLBACK_PATH}` : null);
  if (!redirectUri) {
    res.status(400).json({ error: "Send the app's origin, or set APP_URL or GOOGLE_REDIRECT_URI on the server." });
    return;
  }
  try {
    const { url, nonce } = gmailSync.beginConnect(redirectUri);
    res.cookie(NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(req),
      maxAge: 10 * 60 * 1000,
      path: NONCE_COOKIE_PATH,
    });
    res.json({ url, redirectUri });
  } catch (err) {
    fail(res, err, "Failed to start Gmail connection");
  }
});

/** Google sends the browser here. Always lands back on Settings with the outcome in the query string. */
router.get("/integrations/gmail/callback", async (req, res) => {
  const back = (outcome: "connected" | "error", reason?: string) => {
    res.clearCookie(NONCE_COOKIE, { path: NONCE_COOKIE_PATH });
    res.redirect(303, `/settings?gmail=${outcome}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`);
  };

  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    back("error", error === "access_denied" ? "You declined Gmail access on Google's screen." : `Google returned "${error}".`);
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) {
    back("error", "Google's reply was missing the authorization code.");
    return;
  }

  try {
    const cookies = (req as typeof req & { cookies?: Record<string, string> }).cookies;
    await gmailSync.completeConnect({ code, state, nonce: cookies?.[NONCE_COOKIE] });
    back("connected");
  } catch (err) {
    if (!(err instanceof GmailSyncError)) logger.error({ err }, "Gmail connection failed");
    back("error", err instanceof Error ? err.message : "Gmail connection failed.");
  }
});

router.post("/integrations/gmail/sync", async (_req, res) => {
  try {
    res.json(await gmailSync.sync("manual"));
  } catch (err) {
    fail(res, err, "Gmail sync failed");
  }
});

router.delete("/integrations/gmail", async (_req, res) => {
  try {
    res.json(await gmailSync.disconnect());
  } catch (err) {
    fail(res, err, "Failed to disconnect Gmail");
  }
});

export default router;
