import "server-only";

// Who is calling, for route handlers — from the signed session cookie only.
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./session";

// -> "dhruvi" | "aastha" | null
export async function getSessionUser() {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export const isDhruvi = async () => (await getSessionUser()) === "dhruvi";
