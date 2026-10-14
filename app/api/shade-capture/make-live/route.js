export const runtime = "nodejs";
export const maxDuration = 300;

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { ensureVerifiedFile } from "../verifiedStore";
import { rejectUnlessActionPassword } from "../actionAuth";
import { loadProduct } from "../../logs/loadProduct";
import { classifyShades } from "../../../components/shadeClassifier";

// Bulk "Make live": adds saved products to the app catalogue in one write.
// Same format as /api/update-all-data(-usa): { brand: [{ product: type }, ...] }
// Optional for foundation/concealer: auto-categorise each product's shades (skin tone + undertone) first,
// rewriting its shades.json in the nested { skintone: { undertone: { name: hex } } } format.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

const ALL_DATA_KEYS = {
  india: "all-data.json",
  usa: "all-data-usa.json",
};
const BRAND_ROOTS = { india: "brands", usa: "brands_usa" };
const AUTO_CATEGORISE_CATEGORIES = new Set(["foundation", "concealer"]);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readAllData(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    return { data: JSON.parse(await r.Body.transformToString()) || {}, etag: r.ETag, exists: true };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { data: {}, etag: null, exists: false };
    throw e;
  }
}

// Re-classify one product's shades and rewrite its shades.json (old file kept as a backup next to it).
async function autoCategorise(market, brand, product) {
  const { shades } = await loadProduct({ brand, product, usa: market === "usa" });
  if (!shades?.length) return { ok: false, reason: "no shades saved" };
  const results = classifyShades(shades.map((s) => s.hex));
  const bad = shades.filter((s, i) => !s.name || !results[i].skintone || !results[i].undertone);
  if (bad.length) return { ok: false, reason: `${bad.length} shade(s) without a valid hex/name` };

  const nested = {};
  shades.forEach((s, i) => {
    const { skintone, undertone } = results[i];
    ((nested[skintone] ||= {})[undertone] ||= {})[s.name] = s.hex;
  });

  const base = `${BRAND_ROOTS[market]}/${brand}/product_shade_values/${product}`;
  const old = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${base}/shades.json` }));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: `${base}/shades.before-auto-categorise-${stamp}.json`,
    Body: await old.Body.transformToString(), ContentType: "application/json",
  }));
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: `${base}/shades.json`, Body: JSON.stringify(nested, null, 2), ContentType: "application/json",
  }));
  return { ok: true, shades: shades.length };
}

// POST { market, category, items: [{ brand, product }], autoCategorise?: boolean }
export async function POST(req) {
  try {
    const { market = "india", category, items: requested, autoCategorise: doCategorise = false, password } = await req.json();
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
    const Key = ALL_DATA_KEYS[market];
    if (!Key) return json({ error: "Unknown market" }, 400);
    if (!category) return json({ error: "Missing category" }, 400);
    if (!Array.isArray(requested) || requested.length === 0) return json({ error: "No products selected" }, 400);
    if (requested.length > 2000) return json({ error: "Too many products at once (max 2000)" }, 400);

    // Optional: auto-categorise first; products that can't be categorised are not made live.
    let items = requested;
    const categorised = [], failed = [];
    if (doCategorise) {
      if (!AUTO_CATEGORISE_CATEGORIES.has(category)) return json({ error: "Auto-categorise is only for foundation and concealer" }, 400);
      items = [];
      let next = 0;
      const worker = async () => {
        while (next < requested.length) {
          const it = requested[next++];
          try {
            const r = await autoCategorise(market, it.brand, it.product);
            if (r.ok) { items.push(it); categorised.push({ ...it, shades: r.shades }); }
            else failed.push({ ...it, reason: r.reason });
          } catch (e) {
            failed.push({ ...it, reason: e?.message || "auto-categorise failed" });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, requested.length) }, worker));
      if (!items.length) return json({ success: true, added: [], alreadyLive: [], categorised, failed });
    }

    // Snapshot "verified = live" before anything new goes live, so newly live products start unverified.
    await ensureVerifiedFile(market);

    // Read-modify-write with an ETag check so a concurrent "Make live" isn't overwritten.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, etag, exists } = await readAllData(Key);
      const added = [];
      const alreadyLive = [];
      for (const { brand, product } of items) {
        if (!brand || !product) continue;
        if (!Array.isArray(data[brand])) data[brand] = [];
        if (data[brand].some((entry) => Object.keys(entry || {})[0] === product)) { alreadyLive.push({ brand, product }); continue; }
        data[brand].push({ [product]: category });
        added.push({ brand, product });
      }
      if (!added.length) return json({ success: true, added, alreadyLive, categorised, failed });

      try {
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key,
          Body: JSON.stringify(data, null, 2),
          ContentType: "application/json",
          ...(exists ? { IfMatch: etag } : { IfNoneMatch: "*" }),
        }));
        return json({ success: true, added, alreadyLive, categorised, failed });
      } catch (e) {
        const code = e?.$metadata?.httpStatusCode;
        if (code === 412 || code === 409) continue; // someone else wrote first — re-read and retry
        throw e;
      }
    }
    return json({ error: `${Key} was changed by someone else at the same time — please try again.` }, 409);
  } catch (e) {
    return json({ error: e?.message || "Make live failed" }, 500);
  }
}
