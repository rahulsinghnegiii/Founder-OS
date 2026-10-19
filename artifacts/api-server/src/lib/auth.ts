import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Single-founder password guard.
 *
 * FounderOS is a one-person tool, so auth is deliberately simple: set
 * APP_PASSWORD and every /api route (except health and auth) requires a
 * session cookie or bearer token derived from it. Leave APP_PASSWORD unset
 * for local development and the guard disappears entirely.
 */

export const AUTH_COOKIE = "founderos_session";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function authRequired(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

function sessionSecret(): string {
  return process.env.SESSION_SECRET?.trim() || process.env.APP_PASSWORD?.trim() || "";
}

/** Deterministic token: changing APP_PASSWORD or SESSION_SECRET signs everyone out. */
export function sessionToken(): string {
  return createHmac("sha256", sessionSecret()).update("founderos-session:v1").digest("hex");
}

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyPassword(candidate: string): boolean {
  return safeEqual(candidate, process.env.APP_PASSWORD?.trim() ?? "");
}

export function isAuthenticated(req: Request): boolean {
  if (!authRequired()) return true;
  const expected = sessionToken();
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[AUTH_COOKIE];
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  return safeEqual(cookie, expected) || safeEqual(bearer, expected);
}

/** Whether cookies should be marked Secure. COOKIE_SECURE=1/0 overrides detection. */
export function isSecureRequest(req: Request): boolean {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

/** Returns true when this IP may attempt a login, and records the attempt. */
export function registerLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

export function clearLoginAttempts(ip: string): void {
  attempts.delete(ip);
}

const PUBLIC_PATHS = ["/healthz", "/auth/status", "/auth/login", "/auth/logout"];

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!authRequired()) return next();
  if (PUBLIC_PATHS.includes(req.path)) return next();
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "Authentication required" });
}
