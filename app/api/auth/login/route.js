export const runtime = "nodejs";

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { USERS, SESSION_COOKIE, USER_COOKIE, signSession, cookieOptions } from "../../../lib/session";

// POST { user, password } -> sets the signed session cookie (HttpOnly) + a display-only user cookie.
// Passwords live in env vars (LOGIN_PASSWORD_DHRUVI / LOGIN_PASSWORD_AASTHA), never in the browser bundle.

const PASSWORD_ENV = { dhruvi: "LOGIN_PASSWORD_DHRUVI", aastha: "LOGIN_PASSWORD_AASTHA" };

// constant-time compare (hash first so lengths match)
const same = (a, b) => timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());

export async function POST(req) {
  const { user, password } = await req.json().catch(() => ({}));
  if (!USERS.includes(user)) return NextResponse.json({ error: "Pick a user" }, { status: 400 });

  const expected = process.env[PASSWORD_ENV[user]];
  if (!expected || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    return NextResponse.json({ error: "Login isn't configured on the server" }, { status: 500 });
  }
  if (!password || !same(password, expected)) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ success: true, user });
  res.cookies.set(SESSION_COOKIE, await signSession(user), cookieOptions(true));
  res.cookies.set(USER_COOKIE, user, cookieOptions(false));
  return res;
}
