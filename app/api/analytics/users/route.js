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

/* -------------------- S3 helpers -------------------- */

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getText(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return text;
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

// premium_products.json at ROOT:
// Flexible parsing – handles:
// { "premium": { "<brand>": { "<product>": <count> } }, "updatedAt": ... }
// or flatter variants with numeric leaves.
function normalizePremiumGlobal(raw) {
  const result = { topBrands: [], topProducts: [], updatedAt: null };

  if (!raw || typeof raw !== "object") return result;

  result.updatedAt = raw.updatedAt ?? null;

  // Prefer raw.premium, else use raw itself
  const root =
    raw.premium && typeof raw.premium === "object" ? raw.premium : raw;

  const brandTotals = new Map();
  const brandProductTotals = new Map(); // key: brand:::product

  function walk(node, path) {
    if (node == null) return;

    if (typeof node === "number") {
      // numeric leaf = a count
      const count = Number(node) || 0;
      if (count <= 0) return;

      // derive brand + product from path
      // e.g. ["rare-beauty", "soft-pinch"] -> brand, product
      let brand = "unknown";
      let product = "unknown";

      if (path.length >= 2) {
        brand = String(path[path.length - 2] ?? "unknown");
        product = String(path[path.length - 1] ?? "unknown");
      } else if (path.length === 1) {
        brand = String(path[0] ?? "unknown");
        product = "(all)";
      }

      // aggregate
      brandTotals.set(brand, (brandTotals.get(brand) || 0) + count);
      const bpKey = `${brand}:::${product}`;
      brandProductTotals.set(bpKey, (brandProductTotals.get(bpKey) || 0) + count);
      return;
    }

    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "updatedAt") continue; // skip timestamp
        walk(v, [...path, k]);
      }
    }
  }

  walk(root, []);

  result.topBrands = Array.from(brandTotals.entries())
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count);

  result.topProducts = Array.from(brandProductTotals.entries())
    .map(([key, count]) => {
      const [brand, product] = key.split(":::", 2);
      return { brand, product, count };
    })
    .sort((a, b) => b.count - a.count);

  return result;
}


// perfect_product_premium_5.json & _24.json at ROOT:
// Flexible parsing – handles:
// { "counts": { "<category>": <count> }, "updatedAt": ... }
// or { "premium": { "<category>": <count> }, ... } or other nested numeric leaves.
function normalizePerfectProductGlobal(raw) {
  const result = { categories: [], updatedAt: null };

  if (!raw || typeof raw !== "object") return result;

  result.updatedAt = raw.updatedAt ?? null;

  // Prefer raw.counts, else raw.premium, else raw itself
  const root =
    (raw.counts && typeof raw.counts === "object" && raw.counts) ||
    (raw.premium && typeof raw.premium === "object" && raw.premium) ||
    raw;

  const catTotals = new Map();

  function walk(node, path) {
    if (node == null) return;

    if (typeof node === "number") {
      const count = Number(node) || 0;
      if (count <= 0) return;

      // last key in the path is the category name
      const category =
        path.length > 0 ? String(path[path.length - 1]) : "unknown";

      catTotals.set(category, (catTotals.get(category) || 0) + count);
      return;
    }

    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "updatedAt") continue;
        walk(v, [...path, k]);
      }
    }
  }

  walk(root, []);

  result.categories = Array.from(catTotals.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return result;
}

// steps_taken.json: flexible parsing
// supports:
// 1) ["step1", "step2"]
// 2) [{ step: "x", at: 123 }, ...]
// 3) { steps: [...] } or { steps_taken: [...] }
function normalizeSteps(raw) {
  if (!raw) return [];

  const arr =
    Array.isArray(raw) ? raw :
    (Array.isArray(raw.steps) ? raw.steps :
    (Array.isArray(raw.steps_taken) ? raw.steps_taken : null));

  if (!arr) return [];

  return arr
    .map((x) => {
      if (typeof x === "string") return { step: x, at: null };
      if (!x || typeof x !== "object") return { step: String(x ?? ""), at: null };
      return {
        step: String(x.step ?? x.name ?? x.event ?? ""),
        at: x.at ?? x.ts ?? x.time ?? x.createdAt ?? null,
      };
    })
    .filter((s) => s.step);
}




/* -------------------- Helpers -------------------- */

async function listUserIds() {
  const all = await listAllKeys(ROOT_PREFIX);
  const ids = new Set();
  for (const k of all) {
    const m = k.match(/^permanent\/shopify\/([^/]+)\//);
    if (m) ids.add(m[1]);
  }
  return Array.from(ids);
}

async function fetchUserMinimal(id) {
  const base = `${ROOT_PREFIX}${id}/`;
  const infoCandidates = [`${base}user_info.json`, `${base}user_info`];
  let info = null;

  for (const k of infoCandidates) {
    const v = await getJSON(k);
    if (v) {
      info = v;
      break;
    }
  }

  return {
    id,
    name: info?.name || "",
    number: info?.number || "",
    // NEW: pass timestamps through for sorting
    lastLogin: info?.lastLogin ?? info?.last_login ?? null,
    createdAt: info?.createdAt ?? null,
  };
}


async function fetchUserFull(id) {
  const base = `${ROOT_PREFIX}${id}/`;
  const premiumKey = `${base}premium_products.json`;
  const favCandidates = [`${base}favourites.json`, `${base}favorites.json`];
  const infoCandidates = [`${base}user_info.json`, `${base}user_info`];
  const paidKey = `${base}paid_data.json`;
  const latestKey = `${base}latest.txt`;

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

  // paid_data
  const paidRaw = await (async () => {
    const val = await getJSON(paidKey);
    return val ? { data: val, key: paidKey } : { data: null, key: null };
  })();

  // latest version (for user image path)
  let latestVersion = null;
  const latestTxt = await getText(latestKey);
  if (latestTxt) {
    const maybe = parseInt(latestTxt.trim(), 10);
    if (!Number.isNaN(maybe)) {
      latestVersion = maybe;
    }
  }

  const userInfo = infoRaw.data || {};

    // Try number-path first, then fallback to id-path
  const stepsCandidates = [
    id ? `${base}steps_taken.json` : null,
    `${base}steps_taken.json`,
  ].filter(Boolean);

  const stepsRaw = await (async () => {
    for (const k of stepsCandidates) {
      const val = await getJSON(k);
      if (val) return { data: val, key: k };
    }
    return { data: null, key: null };
  })();

  const steps = normalizeSteps(stepsRaw.data);
  
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

  const paidData = paidRaw.data || {};
  const coinsRaw = paidData?.paid_data?.coins;
  const coins = typeof coinsRaw === "number" ? coinsRaw : (coinsRaw ? Number(coinsRaw) : 0);
  const subscriber = String(paidData?.paid_data?.subscriber ?? "").toLowerCase() === "true";

  return {
    id,
    info: {
      id: userInfo.id ?? id,
      name: userInfo.name ?? "",
      email: userInfo.email ?? "",
      phone: userInfo.phone ?? "",
      number: userInfo.number ?? "",
      createdAt: userInfo.createdAt ?? null,
      lastLogin: userInfo.lastLogin ?? null,
      skinTone: userInfo.skin_tone ?? userInfo.skinTone ?? "",
      undertone: userInfo.undertone ?? "",
      modelPath: userInfo.model_path ?? userInfo.modelPath ?? "",
      latestVersion, // <—— used by frontend to build CloudFront URL
    },
    wallet: { coins, subscriber },
    premium: { count: paidCount, lastPurchase, products: premiumList },
    favourites: { count: favourites.length, items: favourites },
    steps: { count: steps.length, items: steps },
    matchedKeys: {
      infoKey: infoRaw.key,
      premiumKey: premiumRaw.key,
      favouritesKey: favRaw.key,
      paidKey: paidRaw.key,
      stepsKey: stepsRaw.key,
    },
  };
}

/* -------------------- Handler -------------------- */

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    // Detail mode: /api/analytics/users?id=<userId>
    if (id) {
      const user = await fetchUserFull(id);
      return new Response(
        JSON.stringify({ generatedAt: Date.now(), user }),
        { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    // List mode: lightweight name + number only
    const ids = await listUserIds();
    const users = await Promise.all(ids.map(fetchUserMinimal));

    // Viewed summary (global)
    const viewedRaw = await getJSON("viewed.json");
    const viewedGlobal = normalizeViewedGlobal(viewedRaw);
    const topViewedBrands = viewedGlobal.byBrand.slice(0, 10);
    const topViewedProducts = viewedGlobal.byBrandProduct.slice(0, 20);

    // Premium products summary (global)
    const premiumRootRaw = await getJSON("premium_products.json");
    const premiumGlobal = normalizePremiumGlobal(premiumRootRaw);
    const topPremiumBrands = premiumGlobal.topBrands.slice(0, 10);
    const topPremiumProducts = premiumGlobal.topProducts.slice(0, 20);
    const premiumUpdatedAt = premiumGlobal.updatedAt || null;

    // Perfect Product premium (1-hour)
    const perfect5Raw = await getJSON("perfect_product_premium_5.json");
    const perfect5 = normalizePerfectProductGlobal(perfect5Raw);
    const topPerfectProduct5Categories = perfect5.categories.slice(0, 20);
    const perfectProduct5UpdatedAt = perfect5.updatedAt || null;

    // Perfect Product premium (24-hour)
    const perfect24Raw = await getJSON("perfect_product_premium_24.json");
    const perfect24 = normalizePerfectProductGlobal(perfect24Raw);
    const topPerfectProduct24Categories = perfect24.categories.slice(0, 20);
    const perfectProduct24UpdatedAt = perfect24.updatedAt || null;

    return new Response(
      JSON.stringify({
        generatedAt: Date.now(),
        users,
        topViewedBrands,
        topViewedProducts,
        topPremiumBrands,
        topPremiumProducts,
        premiumUpdatedAt,
        topPerfectProduct5Categories,
        perfectProduct5UpdatedAt,
        topPerfectProduct24Categories,
        perfectProduct24UpdatedAt,
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
