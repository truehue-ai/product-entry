export const runtime = "nodejs";

const BACKEND_URL = "https://api.th-fargate.in";
const AUTH = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJudW1iZXIiOiI2NjY2NjY2NjY2IiwiZXhwIjoxNzc5MjY0NjQ1fQ.IvTiiGLM54yFbMZ4ANMaXyl7-dsZ-pwWr3OKpScA8IA";

// GET /api/magazine/article/[id]
// Supports:
//   ?raw=1                          → returns raw unresolved template
//   ?sk_category=M&undertone=warm&number=9876543210  → returns fully resolved article
export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const isRaw = searchParams.get("raw") === "1";

    let backendUrl;
    if (isRaw) {
      backendUrl = `${BACKEND_URL}/magazine/article/${id}/raw`;
    } else {
      const sk_category = searchParams.get("sk_category") || "M";
      const undertone   = searchParams.get("undertone")   || "warm";
      const number      = searchParams.get("number")      || "";
      backendUrl = `${BACKEND_URL}/magazine/article/${id}?sk_category=${encodeURIComponent(sk_category)}&undertone=${encodeURIComponent(undertone)}&number=${encodeURIComponent(number)}`;
    }

    const res = await fetch(backendUrl, {
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

// PUT /api/magazine/article/[id]
export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const res = await fetch(`${BACKEND_URL}/magazine/article/${id}`, {
      method: "PUT",
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

// DELETE /api/magazine/article/[id]
export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const res = await fetch(`${BACKEND_URL}/magazine/article/${id}`, {
      method: "DELETE",
      headers: { Authorization: AUTH },
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