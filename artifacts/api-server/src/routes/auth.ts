import { Router, type Request } from "express";
import { z } from "zod/v4";
import {
  AUTH_COOKIE,
  SESSION_MAX_AGE_MS,
  authRequired,
  clearLoginAttempts,
  isAuthenticated,
  registerLoginAttempt,
  sessionToken,
  verifyPassword,
} from "../lib/auth";
import { logActivity } from "../lib/activity-logger";

const router = Router();

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (first ?? req.ip ?? "unknown").trim();
}

function isSecure(req: Request): boolean {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

router.get("/auth/status", (req, res) => {
  res.json({ required: authRequired(), authenticated: isAuthenticated(req) });
});

router.post("/auth/login", async (req, res) => {
  if (!authRequired()) {
    res.json({ ok: true, required: false });
    return;
  }

  const ip = clientIp(req);
  if (!registerLoginAttempt(ip)) {
    res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    return;
  }

  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body ?? {});
  if (!parsed.success || !verifyPassword(parsed.data.password)) {
    res.status(401).json({ error: "Wrong password" });
    return;
  }

  clearLoginAttempts(ip);
  res.cookie(AUTH_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure(req),
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
  await logActivity({
    entityType: "auth",
    action: "login",
    actorType: "user",
    actorName: "Founder",
    details: { ip },
  });
  res.json({ ok: true, required: true, token: sessionToken() });
});

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.json({ ok: true });
});

export default router;
