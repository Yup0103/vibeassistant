import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { sign, unsign } from "cookie-signature";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "insecure-dev-secret-change-me";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const COOKIE_NAME = "mcp_assistant_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthedRequest extends Request {
  userId?: string;
}

interface SessionPayload {
  userId: string;
  exp: number;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export function issueSessionCookie(res: Response, userId: string): void {
  const payload: SessionPayload = { userId, exp: Date.now() + SESSION_TTL_MS };
  const signed = sign(JSON.stringify(payload), SESSION_SECRET);
  res.cookie(COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = value;
  }
  return out;
}

/** Express middleware: attaches req.userId if a valid session cookie is present. */
export function readSession(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return next();

  const unsigned = unsign(raw, SESSION_SECRET);
  if (!unsigned) return next();

  try {
    const payload = JSON.parse(unsigned) as SessionPayload;
    if (payload.exp > Date.now()) {
      req.userId = payload.userId;
    }
  } catch {
    // malformed cookie — ignore, treat as logged out
  }
  next();
}

/** Express middleware: 401s if readSession() didn't find a valid session. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }
  next();
}
