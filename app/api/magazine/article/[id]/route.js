export const runtime = "nodejs";

import { backend, denyUnlessDhruvi, json, ARTICLE_ID } from "../../backend";

// /api/magazine/article/[id] — dhruvi only; the backend token stays on the server (MAGAZINE_API_TOKEN).
// GET ?raw=1                                       -> raw template (for the editor)
// GET ?sk_category=M&undertone=warm&number=…       -> article resolved for that user (preview)
// PUT                                              -> update the template
// DELETE                                           -> delete it

async function checkId(params) {
  const { id } = await params;
  return ARTICLE_ID.test(String(id || "")) ? id : null;
}

export async function GET(req, { params }) {
  const denied = await denyUnlessDhruvi();
  if (denied) return denied;
  const id = await checkId(params);
  if (!id) return json({ error: "Invalid article ID" }, 400);
  const sp = new URL(req.url).searchParams;
  if (sp.get("raw") === "1") return backend(`/magazine/article/${id}/raw`);
  const q = new URLSearchParams({
    sk_category: sp.get("sk_category") || "M",
    undertone: sp.get("undertone") || "warm",
    number: sp.get("number") || "",
  });
  return backend(`/magazine/article/${id}?${q}`);
}

export async function PUT(req, { params }) {
  const denied = await denyUnlessDhruvi();
  if (denied) return denied;
  const id = await checkId(params);
  if (!id) return json({ error: "Invalid article ID" }, 400);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Invalid JSON body" }, 400);
  return backend(`/magazine/article/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function DELETE(req, { params }) {
  const denied = await denyUnlessDhruvi();
  if (denied) return denied;
  const id = await checkId(params);
  if (!id) return json({ error: "Invalid article ID" }, 400);
  return backend(`/magazine/article/${id}`, { method: "DELETE" });
}
