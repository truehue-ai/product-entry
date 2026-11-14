export const runtime = "nodejs";

import { isDhruvi } from "../../lib/auth";

/**
 * POST /api/send-notification
 * Proxies to the Python backend's /send_push_notification endpoint.
 * Body: { number, title, body, data? }
 */
export async function POST(req) {
  if (!(await isDhruvi())) {
    return new Response(JSON.stringify({ error: "Only dhruvi can send notifications" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  try {
    const payload = await req.json();

    const backendUrl = process.env.BACKEND_URL || "https://api.th-fargate.in";

    const upstream = await fetch(`${backendUrl}/send_push_notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await upstream.json();

    return new Response(JSON.stringify(json), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || "Proxy failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}