export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { SESSION_COOKIE, USER_COOKIE, cookieOptions } from "../../../lib/session";

// POST -> clears both cookies (the session cookie is HttpOnly, so the page can't clear it itself)
export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(true), maxAge: 0 });
  res.cookies.set(USER_COOKIE, "", { ...cookieOptions(false), maxAge: 0 });
  return res;
}
