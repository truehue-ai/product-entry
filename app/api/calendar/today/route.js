export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { isDhruvi } from "../../../lib/auth";
import { parseIcs, eventsOnDay, todayIst } from "../../../lib/ics";

// Today's to-do for the home page (dhruvi only), read live from her Google Calendar.
// GOOGLE_CALENDAR_ICS_URL = the calendar's "Secret address in iCal format" (Google Calendar → Settings →
// your calendar → Integrate calendar). Read-only: edits are made in Google Calendar and show up here.
// The URL is a secret: it stays on the server and is never sent to the browser or logged.
// GET -> { configured, day, events: [{ id, title, start, end, allDay }] }

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function GET() {
  if (!(await isDhruvi())) return json({ error: "Not available" }, 403);
  const url = process.env.GOOGLE_CALENDAR_ICS_URL;
  const day = todayIst();
  if (!url) return json({ configured: false, day, events: [] });
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return json({ configured: true, day, events: [], error: `Google Calendar returned ${r.status}` }, 502);
    const events = eventsOnDay(parseIcs(await r.text()), day);
    return json({ configured: true, day, events });
  } catch (e) {
    return json({ configured: true, day, events: [], error: e?.name === "TimeoutError" ? "Google Calendar took too long" : "Couldn't read Google Calendar" }, 502);
  }
}
