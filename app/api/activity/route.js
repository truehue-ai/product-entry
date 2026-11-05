export const runtime = "nodejs";
export const maxDuration = 300;

import { getSessionUser } from "../../lib/auth";
import { readActivity, rebuildFromAudit, setHoliday, setPaid } from "./store";
import { rejectUnlessActionPassword } from "../shade-capture/actionAuth";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// GET /api/activity?user=aastha -> { user, days: { "YYYY-MM-DD": [entries] }, users: [...], updatedAt }
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const me = (await getSessionUser()) || "";
    const user = searchParams.get("user") || "aastha";
    // dhruvi can see anyone's activity; everyone else only their own
    if (me !== "dhruvi" && user !== me) return json({ error: "You can only view your own activity" }, 403);
    const data = await readActivity();
    return json({
      user, days: data.users?.[user] || {}, holidays: data.holidays?.[user] || {}, paid: data.paid?.[user] || {},
      users: Object.keys(data.users || {}), updatedAt: data.updatedAt || null,
    });
  } catch (e) {
    return json({ error: e?.message || "Failed to load activity" }, 500);
  }
}

// POST { action: "rebuild", user, password } -> rebuild that user's activity from the audit logs
// POST { action: "holiday", user, day, holiday: true|false } -> mark / unmark a holiday (dhruvi only)
// POST { action: "paid", user, month: "YYYY-MM", paid: true|false, amount } -> mark / unmark a month as paid (dhruvi only)
export async function POST(req) {
  try {
    const { action, user, password, day, holiday, month, paid, amount } = await req.json();
    if (action === "paid") {
      const me = (await getSessionUser()) || "";
      if (me !== "dhruvi") return json({ error: "Only dhruvi can mark months as paid" }, 403);
      if (!user || !month || typeof paid !== "boolean") return json({ error: "Missing user, month or paid" }, 400);
      const paidMap = await setPaid(user, month, paid, me, Number(amount));
      return json({ success: true, paid: paidMap });
    }
    if (action === "holiday") {
      const me = (await getSessionUser()) || "";
      if (me !== "dhruvi") return json({ error: "Only dhruvi can mark holidays" }, 403);
      if (!user || !day || typeof holiday !== "boolean") return json({ error: "Missing user, day or holiday" }, 400);
      const holidays = await setHoliday(user, day, holiday, me);
      return json({ success: true, holidays });
    }
    if ((await getSessionUser()) !== "dhruvi") return json({ error: "Only dhruvi can rebuild activity" }, 403);
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
    if (action !== "rebuild" || !user) return json({ error: "Unknown action" }, 400);
    const summary = await rebuildFromAudit(user);
    return json({ success: true, ...summary });
  } catch (e) {
    return json({ error: e?.message || "Rebuild failed" }, 500);
  }
}
