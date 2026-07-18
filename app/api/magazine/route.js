export const runtime = "nodejs";

const BACKEND_URL = "https://api.th-fargate.in";
const AUTH = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJudW1iZXIiOiI3MzgzMjMxNjEyIiwiZXhwIjoxNzgwNDgxNTc2fQ.VeMjLIbgFR-V2jtIkaIhyQr3q-15QGceP-JTtPA2Ma0";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/magazine/feed/personalized`, {
      headers: { Authorization: AUTH },
      cache: "no-store",
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND_URL}/magazine/article`, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}