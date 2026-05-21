export const runtime = "nodejs";

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

// We want product-entry logs, not user analytics.
// Canonical shades path: brands/<brand>/product_shade_values/<product>/shades.json
const BRANDS_PREFIX = "brands/";
const BRANDS_USA_PREFIX = "brands_usa/";

// ── In-memory cache ──────────────────────────────────────────────────────────
let _cache = null;
let _cacheUSA = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getCachedItems(usa = false) {
  const now = Date.now();
  const cache = usa ? _cacheUSA : _cache;
  if (cache && now - cache.populatedAt < CACHE_TTL_MS) {
    return cache.items;
  }
  const prefix = usa ? BRANDS_USA_PREFIX : BRANDS_PREFIX;
  const allKeys = await listAllKeys(prefix);
  const re = usa
    ? /^brands_usa\/([^/]+)\/product_shade_values\/([^/]+)\/shades\.json$/
    : /^brands\/([^/]+)\/product_shade_values\/([^/]+)\/shades\.json$/;
  const set = new Set();
  for (const k of allKeys) {
    const m = k.match(re);
    if (!m) continue;
    try {
      const brand = decodeURIComponent(m[1]);
      const product = decodeURIComponent(m[2]);
      set.add(`${brand}:::${product}`);
    } catch { console.log("Failed to decode key:", k); }
  }
  const items = Array.from(set).map((pk) => {
    const [brand, product] = pk.split(":::");
    return { brand, product };
  });
  items.sort((a, b) => a.product.localeCompare(b.product) || a.brand.localeCompare(b.brand));
  if (usa) _cacheUSA = { items, populatedAt: now };
  else _cache = { items, populatedAt: now };
  return items;
}
// ─────────────────────────────────────────────────────────────────────────────

async function listAllKeys(prefix) {
  let ContinuationToken = undefined;
  const keys = [];
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken })
    );
    (resp.Contents || []).forEach((o) => o?.Key && keys.push(o.Key));
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

export async function GET(req) { 
  console.log("REQ URL:", req.url);
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const q = (searchParams.get("q") || "").trim().toLowerCase();

    // 1) Get cached (or freshly fetched) list — force refresh with ?refresh=1
    const forceRefresh = searchParams.get("refresh") === "1";
    const usa = searchParams.get("usa") === "1";
    if (forceRefresh) { _cache = null; _cacheUSA = null; }
    let items = await getCachedItems(usa);

    // 2) Optional search filter
    if (q) {
      items = items.filter(
        (it) =>
          it.brand.toLowerCase().includes(q) ||
          it.product.toLowerCase().includes(q)
      );
    }

    return new Response(JSON.stringify({ items }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || "list failed", items: [] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
