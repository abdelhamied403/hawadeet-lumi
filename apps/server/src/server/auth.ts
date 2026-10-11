import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { z } from "zod";
import { config } from "../config";

const COOKIE = "veogen_session";
const SESSION_SECONDS = 30 * 24 * 3600;
const ALGORITHM = "HS256";

// The same rules as the app's login form.
export const loginSchema = z.object({ password: z.string().min(1).max(200) });

// With no password set the server is the old local-only dashboard: no login, loopback only.
export const authEnabled = Boolean(config.AUTH_PASSWORD && config.JWT_SECRET);

type Scope = "session" | "media";

async function issue(scope: Scope): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: "owner", scope, iat: now, exp: now + SESSION_SECONDS }, config.JWT_SECRET as string, ALGORITHM);
}

async function holds(token: string | undefined, scope: Scope): Promise<boolean> {
  if (!token) return false;
  try {
    return (await verify(token, config.JWT_SECRET as string, ALGORITHM)).scope === scope;
  } catch {
    return false;
  }
}

// Wrong passwords from anyone count together: there is one owner, so a burst of failures is an attack.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
let failures = 0;
let lockedUntil = 0;

export type LoginResult = { ok: true } | { ok: false; status: 401 | 429; error: string };

export async function login(context: Context, password: string): Promise<LoginResult> {
  if (Date.now() < lockedUntil) return { ok: false, status: 429, error: "Too many wrong passwords. Try again in 15 minutes." };
  const given = Buffer.from(password);
  const expected = Buffer.from(config.AUTH_PASSWORD as string);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    failures += 1;
    if (failures >= MAX_FAILURES) {
      failures = 0;
      lockedUntil = Date.now() + LOCK_MS;
    }
    return { ok: false, status: 401, error: "Wrong password" };
  }
  failures = 0;
  setCookie(context, COOKIE, await issue("session"), {
    httpOnly: true,
    // Behind the HTTPS proxy the cookie is HTTPS-only; a plain-HTTP test on the home network still works.
    secure: context.req.header("x-forwarded-proto") === "https",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return { ok: true };
}

export function logout(context: Context): void {
  deleteCookie(context, COOKIE, { path: "/" });
}

export const signedIn = (context: Context) => holds(getCookie(context, COOKIE), "session");

// For audio, image and video players, which load files outside the app's own requests and so do not
// send the session cookie. It only opens /media.
export const mediaToken = () => issue("media");

export const requireSession: MiddlewareHandler = async (context, next) => {
  if (!authEnabled || (await signedIn(context))) return next();
  return context.json({ error: "Sign in first" }, 401);
};

export const requireMediaAccess: MiddlewareHandler = async (context, next) => {
  if (!authEnabled || (await signedIn(context)) || (await holds(context.req.query("t"), "media"))) return next();
  return context.json({ error: "Sign in first" }, 401);
};
