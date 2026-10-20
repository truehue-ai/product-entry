export const runtime = "nodejs";

import { getSessionUser } from "../../../lib/auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

// Products skipped from the Shade Capture to-do queue, one file per market:
//   skipped/skipped-india.json, skipped/skipped-usa.json
//   [{ ...to-do item (id, brand, product, category, links, …), reason, skippedBy, skippedAt,
//      duplicateOf?: { brand, product, link } }]   <- for "already-added": the saved product it duplicates
// Skipping moves an item out of left-to-update-<market>/todo.json into this list; restoring moves it back.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

const SKIPPED_KEYS = { india: "skipped/skipped-india.json", usa: "skipped/skipped-usa.json" };
const TODO_KEYS = { india: "left-to-update-india/todo.json", usa: "left-to-update-usa/todo.json" };
const SKIP_REASONS = {
  "already-added": "Already added",
  "website-not-found": "Couldn't find website",
  "discontinued": "Product discontinued",
  "out-of-stock": "All shades out of stock",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const normKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sameItem = (a, b) => (a.id && b.id && a.id === b.id) || (normKey(a.brand) === normKey(b.brand) && normKey(a.product) === normKey(b.product));

async function readList(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const items = JSON.parse(await r.Body.transformToString());
    return { items: Array.isArray(items) ? items : [], etag: r.ETag, exists: true };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { items: [], etag: null, exists: false };
    throw e;
  }
}

// Read-modify-write with an ETag check; `create` allows writing a list that doesn't exist yet.
async function updateList(Key, change, { create = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { items, etag, exists } = await readList(Key);
    if (!exists && !create) return items;
    const next = change(items);
    if (next === items) return items;
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key, Body: JSON.stringify(next, null, 2), ContentType: "application/json",
        ...(exists ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      }));
      return next;
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 412 || code === 409) continue;
      throw e;
    }
  }
  throw new Error(`${Key} was changed by someone else at the same time — please try again.`);
}

const keysFor = (market) => (SKIPPED_KEYS[market] ? { skippedKey: SKIPPED_KEYS[market], todoKey: TODO_KEYS[market] } : null);

// GET /api/shade-capture/skipped?market=india
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const keys = keysFor(searchParams.get("market") || "india");
    if (!keys) return json({ error: "Unknown market" }, 400);
    const { items } = await readList(keys.skippedKey);
    return json({ items, reasons: SKIP_REASONS });
  } catch (e) {
    return json({ error: e?.message || "Failed to load skipped list", items: [] }, 500);
  }
}

// POST { market, item, reason, duplicateOf? }  -> skip: add to skipped list, remove from the to-do list
//   reason "already-added" requires duplicateOf: { brand, product, link? } (the saved product it is)
// POST { market, action: "restore", id, brand, product } -> put back on the to-do list
export async function POST(req) {
  try {
    const body = await req.json();
    const keys = keysFor(body.market || "india");
    if (!keys) return json({ error: "Unknown market" }, 400);
    const user = (await getSessionUser()) || "unknown";

    if (body.action === "restore") {
      const target = { id: body.id, brand: body.brand, product: body.product };
      let restored = null;
      const skipped = await updateList(keys.skippedKey, (items) => {
        restored = items.find((it) => sameItem(it, target)) || null;
        return restored ? items.filter((it) => !sameItem(it, target)) : items;
      });
      if (!restored) return json({ error: "Not in the skipped list" }, 404);
      const { reason, skippedBy, skippedAt, duplicateOf, ...todoItem } = restored;
      const todo = await updateList(keys.todoKey, (items) => (items.some((it) => sameItem(it, todoItem)) ? items : [...items, todoItem]), { create: true });
      return json({ success: true, skipped, todo, restored: todoItem });
    }

    const { item, reason, duplicateOf } = body;
    if (!item?.brand && !item?.product) return json({ error: "Missing item" }, 400);
    if (!SKIP_REASONS[reason]) return json({ error: "Unknown reason" }, 400);
    if (reason === "already-added" && (!duplicateOf?.brand || !duplicateOf?.product)) {
      return json({ error: "Pick which saved product it already is" }, 400);
    }
    const entry = { ...item, reason, skippedBy: user, skippedAt: new Date().toISOString() };
    if (reason === "already-added") {
      entry.duplicateOf = {
        brand: String(duplicateOf.brand), product: String(duplicateOf.product),
        ...(duplicateOf.link ? { link: String(duplicateOf.link) } : {}),
      };
    }

    // 1) add to the skipped list (replacing an older skip of the same product)
    const skipped = await updateList(keys.skippedKey, (items) => [...items.filter((it) => !sameItem(it, entry)), entry], { create: true });
    // 2) take it off the to-do list
    const todo = await updateList(keys.todoKey, (items) => {
      const next = items.filter((it) => !sameItem(it, entry));
      return next.length === items.length ? items : next;
    });
    return json({ success: true, entry, skipped, todo });
  } catch (e) {
    return json({ error: e?.message || "Skip failed" }, 500);
  }
}
