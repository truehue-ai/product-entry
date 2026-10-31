// Signed login sessions (HS256 JWT, signed with SESSION_SECRET). No Node-only APIs, so middleware can use it too.
//   th_auth  HttpOnly, Secure, SameSite=Strict — the signed session; the only thing the server trusts
//   th_user  readable by the page, display only (which name to show / which menu) — never trusted for access

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "th_auth";
export const USER_COOKIE = "th_user";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
export const USERS = ["dhruvi", "aastha", "riddhi", "jagat"];

// riddhi can only use Meta Ads (overview): the home page, /meta-ads and its data / refresh API. Checked in middleware.
export const META_ADS_ONLY = new Set(["riddhi"]);
export const META_ADS_ONLY_PATHS = (p) => p === "/" || p === "/meta-ads" || p === "/api/meta-ads" || p.startsWith("/api/auth/");

// jagat can only view Analytics, User Metrics, Product Analytics and Ads Platform Metrics: those pages, plus GET on
// the APIs they read. No POSTs there (scans, rebuilds, give premium). Plus Meta Ads overview, same as riddhi
// (/meta-ads and its data / Refresh now API). Checked in middleware.
export const ANALYTICS_VIEWERS = new Set(["jagat"]);
const under = (p, base) => p === base || p.startsWith(`${base}/`);
const VIEWER_PAGES = ["/analytics", "/product-analytics", "/ads-platform-metrics"]; // /analytics covers /analytics/usage
const VIEWER_API = ["/api/analytics/users", "/api/analytics/buyers", "/api/analytics/steps", "/api/analytics/steps-graph",
  "/api/analytics/usage", "/api/analytics/ads-platform"];
export const ANALYTICS_VIEWER_PATHS = (p, method) => p === "/" || p.startsWith("/api/auth/")
  || p === "/meta-ads" || p === "/api/meta-ads"
  || VIEWER_PAGES.some((b) => under(p, b))
  || (method === "GET" && VIEWER_API.some((b) => under(p, b)));

function secretKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) return null; // fail closed: no (or weak) secret = nobody is logged in
  return new TextEncoder().encode(s);
}

export async function signSession(user) {
  const key = secretKey();
  if (!key) throw new Error("SESSION_SECRET is missing or shorter than 32 characters");
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key);
}

// -> "dhruvi" | "aastha" | null
export async function verifySession(token) {
  const key = secretKey();
  if (!key || !token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return USERS.includes(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

export const cookieOptions = (httpOnly) => ({
  httpOnly, secure: true, sameSite: "strict", path: "/", maxAge: SESSION_MAX_AGE,
});
