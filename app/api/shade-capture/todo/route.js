export const runtime = "nodejs";

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

// To-do list for Shade Capture, stored as one JSON array per market:
//   [{ id, brand, product, category, partial, needsReview: [], links: [] }, ...]
// Array order = priority. Items are removed when the product is saved in Shade Capture.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

const TODO_KEYS = {
  india: "left-to-update-india/todo.json",
  usa: "left-to-update-usa/todo.json",
};
const BRAND_ROOTS = { india: "brands", usa: "brands_usa" };
// Brand popularity order for the queue: { brands: ["most-popular-slug", ...] }
const RANKING_KEYS = {
  india: "left-to-update-india/brand-ranking.json",
  usa: "left-to-update-usa/brand-ranking.json",
};

async function readRanking(market) {
  const Key = RANKING_KEYS[market];
  if (!Key) return [];
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const data = JSON.parse(await r.Body.transformToString());
    return Array.isArray(data?.brands) ? data.brands : [];
  } catch {
    return []; // no ranking uploaded yet -> queue keeps the list order
  }
}

const normKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
// lowercase, words joined by "-" — same naming as everywhere else in S3
const slugify = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readTodo(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const items = JSON.parse(await r.Body.transformToString());
    return { items: Array.isArray(items) ? items : [], etag: r.ETag, exists: true };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { items: [], etag: null, exists: false };
    throw e;
  }
}

// Read-modify-write with an ETag check so two people saving at once can't overwrite each other.
// With create: true a missing list is created (only if nobody else creates it first).
async function updateTodo(Key, change, { create = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { items, etag, exists } = await readTodo(Key);
    if (!exists && !create) return { items, changed: false };
    const next = change(items);
    if (next === items) return { items, changed: false };
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key,
        Body: JSON.stringify(next, null, 2),
        ContentType: "application/json",
        ...(exists ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      }));
      return { items: next, changed: true };
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 412 || code === 409) continue; // someone else wrote first — re-read and retry
      throw e;
    }
  }
  throw new Error("The to-do list was changed by someone else at the same time — please try again.");
}

function keyFor(searchParamsOrBody) {
  const market = searchParamsOrBody.market || "india";
  return TODO_KEYS[market] || null;
}

// GET /api/shade-capture/todo?market=india
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const market = searchParams.get("market") || "india";
    const Key = keyFor({ market });
    if (!Key) return json({ items: [], exists: false, ranking: [] });
    const [{ items, exists }, ranking] = await Promise.all([readTodo(Key), readRanking(market)]);
    return json({ items, exists, ranking });
  } catch (e) {
    return json({ error: e?.message || "Failed to load to-do list", items: [] }, 500);
  }
}

async function hasShades(root, brand, product) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `${root}/${brand}/product_shade_values/${product}/shades.json` }));
    return true;
  } catch {
    return false;
  }
}

// POST { market, items: [{ brand, product, category? }] } — add products from an uploaded CSV.
// Skips anything already captured (has shades.json) or already on the to-do list; new items go to the end.
export async function POST(req) {
  try {
    const body = await req.json();
    const Key = keyFor(body);
    const root = BRAND_ROOTS[body.market || "india"];
    if (!Key || !root) return json({ error: "Unknown market" }, 400);
    if (!Array.isArray(body.items) || body.items.length === 0) return json({ error: "No rows to add" }, 400);
    if (body.items.length > 5000) return json({ error: "Too many rows (max 5000)" }, 400);

    const invalid = [];
    const seen = new Set();
    const candidates = [];
    for (const raw of body.items) {
      const brand = slugify(raw?.brand);
      const product = slugify(raw?.product);
      if (!brand || !product) { invalid.push({ brand: raw?.brand || "", product: raw?.product || "" }); continue; }
      const k = `${normKey(brand)}|${normKey(product)}`;
      if (seen.has(k)) continue; // duplicate row in the CSV
      seen.add(k);
      candidates.push({ brand, product, category: slugify(raw?.category), k });
    }

    // already captured in S3?
    const alreadyDone = [];
    const notDone = [];
    const CONCURRENCY = 16;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      const flags = await Promise.all(batch.map((c) => hasShades(root, c.brand, c.product)));
      batch.forEach((c, j) => (flags[j] ? alreadyDone : notDone).push(c));
    }

    let added = [];
    let alreadyTodo = [];
    const { items } = await updateTodo(Key, (current) => {
      added = []; alreadyTodo = []; // reset on retry
      const onList = new Set(current.map((it) => `${normKey(it.brand)}|${normKey(it.product)}`));
      const ids = new Set(current.map((it) => it.id));
      for (const c of notDone) {
        if (onList.has(c.k)) { alreadyTodo.push(c); continue; }
        let id = `${c.brand}--${c.product}`.slice(0, 180);
        while (ids.has(id)) id = `${id}-x`;
        ids.add(id);
        added.push({ id, brand: c.brand, product: c.product, category: c.category, partial: false, needsReview: [], links: [], source: "csv" });
      }
      return added.length ? [...current, ...added] : current;
    }, { create: true });

    const strip = ({ brand, product }) => ({ brand, product });
    return json({
      success: true,
      added,
      alreadyDone: alreadyDone.map(strip),
      alreadyTodo: alreadyTodo.map(strip),
      invalid,
      items,
    });
  } catch (e) {
    return json({ error: e?.message || "Upload failed" }, 500);
  }
}

// PATCH { market, id, brand, product, category } — fix an item's name/category
export async function PATCH(req) {
  try {
    const body = await req.json();
    const Key = keyFor(body);
    if (!Key || !body.id) return json({ error: "Missing market or id" }, 400);
    const brand = slugify(body.brand);
    const product = slugify(body.product);
    if (!brand || !product) return json({ error: "Brand and product are required" }, 400);

    let updated = null;
    await updateTodo(Key, (items) => {
      updated = null; // reset on retry
      const idx = items.findIndex((it) => it.id === body.id);
      if (idx === -1) return items;
      const next = [...items];
      updated = { ...items[idx], brand, product, category: body.category || items[idx].category, needsReview: [] };
      next[idx] = updated;
      return next;
    });
    if (!updated) return json({ error: "Item not found — it may already be done" }, 404);
    return json({ success: true, item: updated });
  } catch (e) {
    return json({ error: e?.message || "Update failed" }, 500);
  }
}

// DELETE { market, id?, brand?, product? } — called after a product is saved in Shade Capture
export async function DELETE(req) {
  try {
    const body = await req.json();
    const Key = keyFor(body);
    if (!Key) return json({ success: true, removed: 0 });
    const target = body.brand && body.product ? `${normKey(body.brand)}|${normKey(body.product)}` : null;
    if (!body.id && !target) return json({ error: "Missing id or brand/product" }, 400);

    let removed = 0;
    await updateTodo(Key, (items) => {
      removed = 0; // reset on retry
      const next = items.filter((it) => {
        const hit = (body.id && it.id === body.id) || (target && `${normKey(it.brand)}|${normKey(it.product)}` === target);
        if (hit) removed++;
        return !hit;
      });
      return removed ? next : items;
    });
    return json({ success: true, removed });
  } catch (e) {
    return json({ error: e?.message || "Remove failed" }, 500);
  }
}
