export const runtime = "nodejs";
export const maxDuration = 60;

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { readVerified } from "../verifiedStore";

// Read-only: lists every captured product (has shades.json) with its category,
// last-saved time, whether it is live in all-data(.usa).json and whether it has been verified.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

const LIST_CONCURRENCY = 16;
const TYPE_CONCURRENCY = 32;

// Product categories rarely change — keep them for the life of the server instance.
const typeCache = new Map();

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    return JSON.parse(await r.Body.transformToString());
  } catch {
    return null;
  }
}

async function listAll(params) {
  let ContinuationToken;
  const keys = [];
  const prefixes = [];
  do {
    const resp = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, ...params, ContinuationToken }));
    (resp.Contents || []).forEach((o) => o?.Key && keys.push(o));
    (resp.CommonPrefixes || []).forEach((p) => p?.Prefix && prefixes.push(p.Prefix));
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return { keys, prefixes };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

async function resolveType(root, brand, product) {
  const meta = await getJSON(`${root}/${brand}/product_shade_values/${product}/meta.json`);
  if (meta?.productType) return meta.productType;
  const typeMap =
    (await getJSON(`${root}/${brand}/type/${product}/type.json`)) ||
    (await getJSON(`${root}/${brand}/product_shade_values/${product}/type.json`));
  if (typeMap && typeof typeMap === "object") {
    const first = Object.values(typeMap).find(Boolean);
    if (first) return String(first);
  }
  return "";
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const usa = searchParams.get("usa") === "1";
    const root = usa ? "brands_usa" : "brands";
    const allDataKey = usa ? "all-data-usa.json" : "all-data.json";

    const [{ prefixes }, allData] = await Promise.all([
      listAll({ Prefix: `${root}/`, Delimiter: "/" }),
      getJSON(allDataKey),
    ]);

    // live catalogue: { brand: [{ product: type }] }
    const live = new Map();
    for (const [brand, arr] of Object.entries(allData || {})) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        for (const [product, type] of Object.entries(entry || {})) live.set(`${brand}:::${product}`, type);
      }
    }

    const brands = prefixes.map((p) => p.slice(root.length + 1, -1)).filter(Boolean);

    // every brands/<brand>/product_shade_values/<product>/shades.json
    const perBrand = await mapLimit(brands, LIST_CONCURRENCY, async (brand) => {
      const base = `${root}/${brand}/product_shade_values/`;
      const { keys } = await listAll({ Prefix: base });
      const found = [];
      for (const { Key, LastModified } of keys) {
        const parts = Key.slice(base.length).split("/");
        if (parts.length === 2 && parts[1] === "shades.json" && parts[0]) {
          found.push({ brand, product: parts[0], updatedAt: LastModified ? new Date(LastModified).toISOString() : null });
        }
      }
      return found;
    });
    const products = perBrand.flat();

    await mapLimit(products, TYPE_CONCURRENCY, async (p) => {
      const k = `${p.brand}:::${p.product}`;
      const liveType = live.get(k);
      p.live = live.has(k);
      // "Face" is a placeholder written by generate-all-data, not a real category
      if (liveType && liveType !== "Face") { p.type = liveType; return; }
      const cacheKey = `${root}/${k}`;
      if (!typeCache.has(cacheKey)) typeCache.set(cacheKey, await resolveType(root, p.brand, p.product));
      p.type = typeCache.get(cacheKey);
    });

    const { verified } = await readVerified(usa ? "usa" : "india");

    return Response.json(
      {
        products: products.map((p) => {
          const brand = safeDecode(p.brand), product = safeDecode(p.product);
          return {
            brand,
            product,
            type: p.type || "",
            live: !!p.live,
            verified: !!(verified[brand]?.[product] || verified[p.brand]?.[p.product]),
            updatedAt: p.updatedAt,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json({ error: e?.message || "Catalog failed", products: [] }, { status: 500 });
  }
}
