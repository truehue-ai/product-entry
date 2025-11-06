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
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();

    // 1) List all brand/product shades.json keys
    const allKeys = await listAllKeys(BRANDS_PREFIX);

    // Match: brands/<brand>/product_shade_values/<product>/shades.json
    const re = /^brands\/([^/]+)\/product_shade_values\/([^/]+)\/shades\.json$/;

    const set = new Set();
    for (const k of allKeys) {
      const m = k.match(re);
      if (!m) continue;
      const brand = decodeURIComponent(m[1]);
      const product = decodeURIComponent(m[2]);
      const pairKey = `${brand}:::${product}`;
      if (!set.has(pairKey)) set.add(pairKey);
    }

    // 2) Build items array
    let items = Array.from(set).map((pk) => {
      const [brand, product] = pk.split(":::");
      return { brand, product };
    });

    // 3) Optional search filter
    if (q) {
      items = items.filter(
        (it) =>
          it.brand.toLowerCase().includes(q) ||
          it.product.toLowerCase().includes(q)
      );
    }

    // 4) Sort for stable UI
    items.sort((a, b) =>
      a.product.localeCompare(b.product) || a.brand.localeCompare(b.brand)
    );

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
