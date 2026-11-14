export const runtime = "nodejs";

import { backend, denyUnlessDhruvi, json, ARTICLE_ID } from "./backend";

// GET  /api/magazine -> the article index (backend /magazine/feed/personalized)
// POST /api/magazine -> create an article template (backend /magazine/article)
// dhruvi only; the backend token stays on the server (MAGAZINE_API_TOKEN).

export async function GET() {
  const denied = await denyUnlessDhruvi();
  if (denied) return denied;
  return backend("/magazine/feed/personalized");
}

export async function POST(req) {
  const denied = await denyUnlessDhruvi();
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Invalid JSON body" }, 400);
  if (!ARTICLE_ID.test(String(body.id || ""))) return json({ error: "Article ID must be lowercase letters, numbers and dashes" }, 400);
  return backend("/magazine/article", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
