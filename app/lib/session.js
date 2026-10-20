// Signed login sessions (HS256 JWT, signed with SESSION_SECRET). No Node-only APIs, so middleware can use it too.
//   th_auth  HttpOnly, Secure, SameSite=Strict — the signed session; the only thing the server trusts
//   th_user  readable by the page, display only (which name to show / which menu) — never trusted for access

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "th_auth";
export const USER_COOKIE = "th_user";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
export const USERS = ["dhruvi", "aastha"];

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
