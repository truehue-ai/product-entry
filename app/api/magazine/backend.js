import "server-only";

// Shared by the /api/magazine routes: who may use them, and how they reach the backend's /magazine API.
// Backend auth: the backend's /magazine routes need a JWT (HS256, { number, exp }) signed with its JWT secret.
//   MAGAZINE_JWT_SECRET set -> a fresh 10-minute token is signed for every request (never goes stale)
//   otherwise                -> the fixed MAGAZINE_API_TOKEN is sent as-is (expires; kept as a fallback)
// MAGAZINE_JWT_NUMBER = the account the token is for (default: the internal test account).
// The base URL can be overridden with MAGAZINE_BACKEND_URL. Nothing here is ever sent to the browser.
import { SignJWT } from "jose";
import { isDhruvi } from "../../lib/auth";

export const BACKEND_URL = process.env.MAGAZINE_BACKEND_URL || "https://api.th-fargate.in";

// Article ids are URL slugs — anything else could reach a different backend path
export const ARTICLE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// The Edit is dhruvi's tool: every magazine route returns this for anyone else
export async function denyUnlessDhruvi() {
  return (await isDhruvi()) ? null : json({ error: "Only dhruvi can use The Edit" }, 403);
}

async function backendToken() {
  const secret = process.env.MAGAZINE_JWT_SECRET;
  if (secret) {
    return new SignJWT({ number: process.env.MAGAZINE_JWT_NUMBER || "7383231612" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(secret));
  }
  return process.env.MAGAZINE_API_TOKEN || null;
}

// fetch the backend with a server-side token; returns the backend's JSON and status as-is
export async function backend(path, init = {}) {
  const token = await backendToken();
  if (!token) return json({ error: "Set MAGAZINE_JWT_SECRET (or MAGAZINE_API_TOKEN) on the server" }, 500);
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({ error: `Backend returned ${res.status}` }));
    return json(data, res.status);
  } catch (e) {
    return json({ error: e?.message || "Backend request failed" }, 502);
  }
}
