import "server-only";

// Who is calling, for route handlers — from the signed session cookie only.
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, META_ADS_ONLY } from "./session";

// -> "dhruvi" | "aastha" | null
export async function getSessionUser() {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export const isDhruvi = async () => (await getSessionUser()) === "dhruvi";
// Meta Ads overview (data + Refresh now): dhruvi, plus the Meta-Ads-only users
export const canViewMetaAds = async () => { const u = await getSessionUser(); return u === "dhruvi" || META_ADS_ONLY.has(u); };
