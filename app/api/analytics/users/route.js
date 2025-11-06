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

// Layout: <bucket>/permanent/shopify/<id>/
const ROOT_PREFIX = "permanent/shopify/";

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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

/* -------------------- Normalizers -------------------- */

// premium_products: {"premium_products":[{brand,product,purchasedAt?},...]}
function normalizePremium(raw) {
  if (!raw) return [];
  if (raw && typeof raw === "object" && Array.isArray(raw.premium_products)) {
    return raw.premium_products
      .map((p) => ({
        brand: String(p?.brand ?? ""),
        product: String(p?.product ?? ""),
        purchasedAt: p?.purchasedAt ?? null,
      }))
      .filter((p) => p.brand || p.product);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((p) => ({
        brand: String(p?.brand ?? ""),
        product: String(p?.product ?? ""),
        purchasedAt: p?.purchasedAt ?? null,
      }))
      .filter((p) => p.brand || p.product);
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.products)) {
    return raw.products
      .map((p) => ({
        brand: String(p?.brand ?? ""),
        product: String(p?.product ?? ""),
        purchasedAt: p?.purchasedAt ?? null,
      }))
      .filter((p) => p.brand || p.product);
  }
  return [];
}

// favourites.json canonical: {"favourites": {"#hex": {...}}}
function normalizeFavourites(raw) {
  if (!raw) return [];
  let srcObj = null;
  if (raw && typeof raw === "object") {
    if (raw.favourites && typeof raw.favourites === "object" && !Array.isArray(raw.favourites)) {
      srcObj = raw.favourites;
    } else if (raw.favorites && typeof raw.favorites === "object" && !Array.isArray(raw.favorites)) {
      srcObj = raw.favorites;
    } else if (Array.isArray(raw.favourites)) {
      return raw.favourites.map(asFavRow).filter(validFav);
    } else if (Array.isArray(raw.favorites)) {
      return raw.favorites.map(asFavRow).filter(validFav);
    } else if (Array.isArray(raw.items)) {
      return raw.items.map(asFavRow).filter(validFav);
    }
  }
  if (Array.isArray(raw)) return raw.map(asFavRow).filter(validFav);
  if (!srcObj) return [];

  const out = [];
  for (const [hex, v] of Object.entries(srcObj)) {
    const obj = v && typeof v === "object" ? v : {};
    out.push({
      hex: String(hex || ""),
      brand: String(obj.brand ?? obj.Brand ?? ""),
      product: String(obj.product ?? obj.product_name ?? obj.productName ?? ""),
      name: String(obj.shade_name ?? obj.name ?? ""),
      link: String(obj.link ?? ""),
      price: typeof obj.price === "number" ? obj.price : (obj.price ? Number(obj.price) : null),
      type: String(obj.type ?? ""),
      filter: String(obj.filter ?? ""),
    });
  }
  return out.filter(validFav);
}

function asFavRow(x) {
  if (!x || typeof x !== "object") {
    return { brand: "", product: String(x ?? ""), name: "", hex: "", link: "", price: null, type: "", filter: "" };
  }
  return {
    hex: String(x.hex ?? x.shade_hex_code ?? ""),
    brand: String(x.brand ?? ""),
    product: String(x.product ?? x.product_name ?? x.productName ?? ""),
    name: String(x.shade_name ?? x.name ?? ""),
    link: String(x.link ?? ""),
    price: typeof x.price === "number" ? x.price : (x.price ? Number(x.price) : null),
    type: String(x.type ?? ""),
    filter: String(x.filter ?? ""),
  };
}

function validFav(f) {
  return Boolean(f && (f.brand || f.product || f.name || f.hex));
}

// viewed.json at BUCKET ROOT:
// {"viewed": { "<brand>": { "<product>": <viewsNumber> } } }
function normalizeViewedGlobal(raw) {
  const items = [];
  if (!raw || typeof raw !== "object") return { items, byBrand: [], byBrandProduct: [] };

  const root = raw.viewed && typeof raw.viewed === "object" ? raw.viewed : null;
  if (!root) return { items, byBrand: [], byBrandProduct: [] };

  const brandTotals = new Map();
  const brandProductTotals = new Map(); // key: brand:::product

  for (const [brand, prodMap] of Object.entries(root)) {
    if (!prodMap || typeof prodMap !== "object") continue;
    for (const [product, views] of Object.entries(prodMap)) {
      const v = Number(views) || 0;
      if (!brand || !product || v <= 0) continue;
      items.push({ brand, product, views: v });

      brandTotals.set(brand, (brandTotals.get(brand) || 0) + v);
      const bpKey = `${brand}:::${product}`;
      brandProductTotals.set(bpKey, (brandProductTotals.get(bpKey) || 0) + v);
    }
  }

  const byBrand = Array.from(brandTotals.entries())
    .map(([brand, views]) => ({ brand, views }))
    .sort((a, b) => b.views - a.views);

  const byBrandProduct = Array.from(brandProductTotals.entries())
    .map(([key, views]) => {
      const [brand, product] = key.split(":::", 2);
      return { brand, product, views };
    })
    .sort((a, b) => b.views - a.views);

  return { items, byBrand, byBrandProduct };
}

/* -------------------- Handler -------------------- */

export async function GET() {
  try {
    // discover user IDs
    const allKeys = await listAllKeys(ROOT_PREFIX);
    const ids = new Set();
    for (const k of allKeys) {
      const m = k.match(/^permanent\/shopify\/([^/]+)\//);
      if (m) ids.add(m[1]);
    }

    // per-user fetch
    const users = await Promise.all(
      Array.from(ids).map(async (id) => {
        const base = `${ROOT_PREFIX}${id}/`;

        const premiumKey = `${base}premium_products.json`;
        const favCandidates = [`${base}favourites.json`, `${base}favorites.json`];
        const infoCandidates = [`${base}user_info.json`, `${base}user_info`];

        // info
        const infoRaw = await (async () => {
          for (const k of infoCandidates) {
            const val = await getJSON(k);
            if (val) return { data: val, key: k };
          }
          return { data: null, key: null };
        })();

        // premium
        const premiumRaw = await (async () => {
          const val = await getJSON(premiumKey);
          return val ? { data: val, key: premiumKey } : { data: null, key: null };
        })();

        // favourites
        const favRaw = await (async () => {
          for (const k of favCandidates) {
            const val = await getJSON(k);
            if (val) return { data: val, key: k };
          }
          return { data: null, key: null };
        })();

        const userInfo = infoRaw.data || {};
        const premiumList = normalizePremium(premiumRaw.data);
        const favourites = normalizeFavourites(favRaw.data);

        const paidCount = premiumList.length;
        const lastPurchase =
          (
            premiumList
              .map((p) =>
                typeof p?.purchasedAt === "number"
                  ? p.purchasedAt
                  : Date.parse(String(p?.purchasedAt ?? ""))
              )
              .filter((n) => !Number.isNaN(n))
              .sort((a, b) => b - a)[0]
          ) ?? null;

        return {
          id,
          info: {
            id: userInfo.id ?? id,
            name: userInfo.name ?? "",
            email: userInfo.email ?? "",
            phone: userInfo.phone ?? "",
            createdAt: userInfo.createdAt ?? null,
            skinTone: userInfo.skin_tone ?? userInfo.skinTone ?? "",
            undertone: userInfo.undertone ?? "",
          },
          premium: {
            count: paidCount,
            lastPurchase,
            products: premiumList,
          },
          favourites: {
            count: favourites.length,
            items: favourites,
          },
          matchedKeys: {
            infoKey: infoRaw.key,
            premiumKey: premiumRaw.key,
            favouritesKey: favRaw.key,
          },
        };
      })
    );

    // root viewed.json (global)
    const viewedRaw = await getJSON("viewed.json");
    const viewedGlobal = normalizeViewedGlobal(viewedRaw);

    // rollups
    const totals = {
      usersCount: users.length,
      premiumUsers: users.filter((u) => (u.premium?.count || 0) > 0).length,
      totalPremiumProducts: users.reduce((acc, u) => acc + (u.premium?.count || 0), 0),
      topBrands: (() => {
        const map = new Map();
        users.forEach((u) =>
          (u.premium?.products || []).forEach((p) => {
            if (!p.brand) return;
            map.set(p.brand, (map.get(p.brand) || 0) + 1);
          })
        );
        return Array.from(map.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([brand, count]) => ({ brand, count }));
      })(),
      topFavouriteBrands: (() => {
        const map = new Map();
        users.forEach((u) =>
          (u.favourites?.items || []).forEach((f) => {
            if (!f.brand) return;
            map.set(f.brand, (map.get(f.brand) || 0) + 1);
          })
        );
        return Array.from(map.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([brand, count]) => ({ brand, count }));
      })(),
      // viewed globals (already sorted; slice here for UI)
      topViewedBrands: viewedGlobal.byBrand.slice(0, 10),
      topViewedProducts: viewedGlobal.byBrandProduct.slice(0, 20),
    };

    return new Response(
      JSON.stringify({
        generatedAt: Date.now(),
        users,
        totals,
        viewedGlobal, // expose for brand modal
      }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || "Analytics failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
