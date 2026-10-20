export const runtime = "nodejs";

import { getSessionUser } from "../../../lib/auth";
import { rejectUnlessActionPassword } from "../../shade-capture/actionAuth";

// Grant premium (subscriber=true, lifetime) to one user via the backend's /give_premium_access.
// purchaseId is fixed per user per day, so the backend's idempotency guard (24h) turns repeat clicks into no-ops.
const BACKEND_URL = process.env.BACKEND_URL || "https://api.th-fargate.in";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// POST { number, password }
export async function POST(req) {
  try {
    const { number, password } = await req.json();
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
    if ((await getSessionUser()) !== "dhruvi") return json({ error: "Only dhruvi can grant premium" }, 403);
    const n = String(number || "").trim();
    if (!n) return json({ error: "Missing number" }, 400);

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const purchaseId = `admin-grant-${n}-${day}`;
    const resp = await fetch(`${BACKEND_URL}/give_premium_access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: n, purchaseId }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return json({ error: body.error || `Backend returned ${resp.status}` }, 502);
    return json({ success: true, alreadyProcessed: !!body.already_processed, subscriber: !!body.subscriber, purchaseId });
  } catch (e) {
    return json({ error: e?.message || "Grant failed" }, 500);
  }
}
