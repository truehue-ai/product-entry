export const runtime = "nodejs";
export const maxDuration = 60;

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { denyUnlessDhruvi, json } from "../backend";

// POST /api/magazine/check { sections } — dhruvi only, read-only.
// For every product slot in an article, shows what the backend will pull, the same way it resolves slots
// (app.py _resolve_lmd_slot / _resolve_shade_rec_slot), without try-ons:
//   LMD_lookup -> find_products/product_database/<source>/categorised_LMD.json (truehue-full-data), per depth L / M / D
//                 (foundation / concealer: per undertone group too)
//   shade_rec  -> brands/<brand>/product_shade_values/<product>/shades.json exists? If not, lists that brand's products.

const DATA_BUCKET = "truehue-full-data";               // categorised_LMD.json (same as build-product-database)
const BRAND_BUCKET = process.env.X_AWS_BUCKET_NAME;     // brands/<brand>/product_shade_values/… (same as shade capture)
const s3 = new S3Client({ region: process.env.X_AWS_REGION, credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) });

const PRODUCT_SOURCES = ["matte-lipstick", "satin-lipstick", "lip-gloss", "lip-tint", "cream-blush", "powder-blush",
  "cream-eyeshadow", "powder-eyeshadow", "concealer", "foundation"];
const SLUG = /^[a-z0-9][a-z0-9._-]{0,150}$/i;
const DEPTHS = ["L", "M", "D"];
const UNDERTONE_GROUPS = [["warm", "low"], ["neutral", "medium"], ["cool", "high"]];

async function getJSON(Bucket, Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
    return JSON.parse(await r.Body.transformToString());
  } catch {
    return null;
  }
}

// categorised_LMD.json is large; keep each one for 5 minutes per server instance
const lmdCache = new Map();
async function loadLmd(source) {
  const hit = lmdCache.get(source);
  if (hit && hit.at > Date.now() - 5 * 60_000) return hit.data;
  const data = await getJSON(DATA_BUCKET, `find_products/product_database/${source}/categorised_LMD.json`);
  if (data) lmdCache.set(source, { at: Date.now(), data });
  return data;
}

// same filtering as the backend: needs a price, deduped, first max_products
function pick(list, max) {
  const out = [], seen = new Set();
  let total = 0;
  for (const obj of Array.isArray(list) ? list : []) {
    if (!obj || typeof obj !== "object") continue;
    const [hex, info] = Object.entries(obj)[0] || [];
    if (!info || info.price === "" || info.price == null || !Number.isFinite(Number(info.price))) continue;
    const key = [info.brand, info.product_name, info.shade_name, String(hex).toLowerCase()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    if (out.length < max) out.push({ brand: info.brand, product: info.product_name, shade: info.shade_name, hex, price: Number(info.price) });
  }
  return { total, products: out };
}

async function checkLmd(params) {
  const source = params.source, category = params.category, bucket = String(params.price_bucket ?? "0");
  const max = Math.max(1, Math.min(20, parseInt(params.max_products || 5, 10) || 5));
  if (!PRODUCT_SOURCES.includes(source)) return { ok: false, error: "Pick a product source" };
  const isBase = source === "foundation" || source === "concealer";
  if (!isBase && !category) return { ok: false, error: "Pick a category (e.g. perfect-pinks)" };
  const lmd = await loadLmd(source);
  if (!lmd) return { ok: false, error: `Couldn't read the ${source} product database` };

  const groups = isBase ? UNDERTONE_GROUPS : [[null, category]];
  const results = [];
  for (const [label, top] of groups) {
    for (const depth of DEPTHS) {
      const r = pick(lmd?.[top]?.[bucket]?.[depth], max);
      results.push({ depth, undertone: label, ...r });
    }
  }
  const empty = results.filter((r) => r.products.length === 0);
  return {
    ok: empty.length === 0,
    warning: empty.length ? `No products for ${empty.map((r) => (r.undertone ? `${r.undertone} ` : "") + r.depth).join(", ")}: those readers will see an empty slot` : null,
    results,
  };
}

async function listFolders(Prefix) {
  const names = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BRAND_BUCKET, Prefix, Delimiter: "/", ContinuationToken }));
    for (const p of r.CommonPrefixes || []) names.push(p.Prefix.slice(Prefix.length, -1));
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken && names.length < 2000);
  return names;
}

async function checkShadeRec(params) {
  const { product_type: type, brand, product_name: product } = params;
  if (!PRODUCT_SOURCES.includes(type)) return { ok: false, error: "Pick a product type" };
  if (!SLUG.test(brand || "")) return { ok: false, error: "Enter the brand exactly as saved (e.g. nars)" };
  if (!SLUG.test(product || "")) return { ok: false, error: "Enter the product exactly as saved (e.g. powermatte-lipstick)" };
  const shades = await getJSON(BRAND_BUCKET, `brands/${brand}/product_shade_values/${product}/shades.json`);
  if (shades) {
    const count = Object.keys(shades).length;
    return { ok: true, note: `Found: ${count} shade${count === 1 ? "" : "s"}. The backend picks the ${params.pick || "natural"} shade for each reader.` };
  }
  const products = await listFolders(`brands/${brand}/product_shade_values/`);
  if (!products.length) return { ok: false, error: `No brand "${brand}" in the product database` };
  const q = product.toLowerCase().split(/[-_]/).filter(Boolean);
  const close = products
    .map((p) => ({ p, score: q.filter((w) => p.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))
    .slice(0, 12).map((x) => x.p);
  return { ok: false, error: `No product "${product}" under ${brand}`, suggestions: close };
}

export async function POST(req) {
  const denied = await denyUnlessDhruvi();
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const sections = Array.isArray(body?.sections) ? body.sections : null;
  if (!sections) return json({ error: "Send { sections: [...] }" }, 400);
  const slots = sections.filter((s) => s?.type === "product_card").slice(0, 30);
  const out = await Promise.all(slots.map(async (s) => {
    const base = { slot: s.slot, heading: s.heading || s.slot, resolver: s.resolver };
    try {
      const params = s.params || {};
      if (s.resolver === "LMD_lookup") return { ...base, ...(await checkLmd(params)) };
      if (s.resolver === "shade_rec") return { ...base, ...(await checkShadeRec(params)) };
      return { ...base, ok: false, error: "Unknown resolver" };
    } catch (e) {
      return { ...base, ok: false, error: e?.message || "Check failed" };
    }
  }));
  return json({ slots: out });
}
