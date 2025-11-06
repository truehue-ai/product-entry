// app/api/build-product-database/route.js
export const runtime = "nodejs";

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const REGION = process.env.X_AWS_REGION;
const ACCESS_KEY_ID = process.env.X_AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.X_AWS_SECRET_ACCESS_KEY;

const DATA_BUCKET = "truehue-backend-data";     // read-only reference bucket (existing CategorisedLMD.json)
const WORK_BUCKET = process.env.X_AWS_BUCKET_NAME;

const s3 = new S3Client({
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

// ---------- S3 helpers ----------
async function getJSON(Bucket, Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function listAllBrandProducts() {
  const prefix = "brands/";
  let ContinuationToken;
  const items = new Map();

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: WORK_BUCKET,
        Prefix: prefix,
        ContinuationToken,
      })
    );
    for (const obj of resp.Contents || []) {
      const k = obj.Key || "";
      const m = k.match(
        /^brands\/([^/]+)\/product_shade_values\/([^/]+)\/(shades\.json|links\.json|price\.json|types?\.json)$/
      );
      if (m) {
        const [, brand, product] = m;
        items.set(`${brand}:::${product}`, { brand, product });
      }
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return [...items.values()].sort((a, b) =>
    a.brand === b.brand ? a.product.localeCompare(b.product) : a.brand.localeCompare(b.brand)
  );
}

// ---------- lip gating ----------
const LIP_CATEGORIES = new Set([
  "matte-lipstick",
  "satin-lipstick",
  "lip-gloss",
  "lip-tint",
  "lip-balm",
  "lip-oil",
]);
function isLipCategory(cat) {
  return LIP_CATEGORIES.has(String(cat || "").toLowerCase());
}
async function hasEditedFinalShades(brand, product) {
  // Folder-style prefix check: brands/<brand>/edited_final_shades/<product>/**
  const folderPrefix = `brands/${brand}/edited_final_shades/${product}/`;
  const folderResp = await s3.send(
    new ListObjectsV2Command({
      Bucket: WORK_BUCKET,
      Prefix: folderPrefix,
      MaxKeys: 1,
    })
  );
  if ((folderResp.Contents || []).length > 0) return true;

  // File-style fallback: brands/<brand>/edited_final_shades/<product>.json
  const filePrefix = `brands/${brand}/edited_final_shades/${product}.json`;
  const fileResp = await s3.send(
    new ListObjectsV2Command({
      Bucket: WORK_BUCKET,
      Prefix: filePrefix,
      MaxKeys: 1,
    })
  );
  return (fileResp.Contents || []).length > 0;
}

// ---------- logs/get-compatible normalizers ----------
function isFoundationNested(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const toneKeys = ["F", "FM", "MD", "D1", "D2", "VD"];
  return toneKeys.some((k) => Object.prototype.hasOwnProperty.call(obj, k));
}
function flattenFoundation(obj) {
  const out = [];
  for (const [skintone, undertones] of Object.entries(obj || {})) {
    for (const [undertone, shadesObj] of Object.entries(undertones || {})) {
      for (const [name, hex] of Object.entries(shadesObj || {})) {
        out.push({ name: String(name), hex: String(hex), skintone, undertone });
      }
    }
  }
  return out;
}
function normalizeTone(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    try {
      const keys = Object.keys(v).filter((k) => !!v[k]);
      return (keys.length ? keys : Object.keys(v)).join(",");
    } catch {
      return "";
    }
  }
  return String(v);
}

async function loadMergedShades(brand, product) {
  const base = `brands/${brand}/product_shade_values/${product}`;
  const shades = await getJSON(WORK_BUCKET, `${base}/shades.json`);
  const meta   = await getJSON(WORK_BUCKET, `${base}/meta.json`);

  const links =
    (await getJSON(WORK_BUCKET, `${base}/links.json`)) ||
    (await getJSON(WORK_BUCKET, `brands/${brand}/links/${product}/links.json`));

  const price =
    (await getJSON(WORK_BUCKET, `${base}/price.json`)) ||
    (await getJSON(WORK_BUCKET, `brands/${brand}/price/${product}/price.json`));

  const type =
    (await getJSON(WORK_BUCKET, `${base}/types.json`)) ||
    (await getJSON(WORK_BUCKET, `${base}/type.json`)) ||
    (await getJSON(WORK_BUCKET, `brands/${brand}/type/${product}/types.json`)) ||
    (await getJSON(WORK_BUCKET, `brands/${brand}/type/${product}/type.json`));

  let combined = [];
  if (Array.isArray(shades)) {
    combined = shades.map((s) => ({
      name: s.name,
      hex: s.hex,
      skintone: normalizeTone(s.skintone),
      undertone: normalizeTone(s.undertone),
      link: links?.[s.name] || "",
      price: price?.[s.name] ?? "",
      type: type?.[s.name] || "",
    }));
  } else if (isFoundationNested(shades)) {
    const flat = flattenFoundation(shades);
    combined = flat.map((s) => ({
      ...s,
      link: links?.[s.name] || "",
      price: price?.[s.name] ?? "",
      type: type?.[s.name] || "",
    }));
  } else if (shades && typeof shades === "object") {
    combined = Object.entries(shades).map(([name, hex]) => ({
      name,
      hex,
      skintone: "",
      undertone: "",
      link: links?.[name] || "",
      price: price?.[name] ?? "",
      type: type?.[name] || "",
    }));
  }

  let productType = "";
  if (type && typeof type === "object") {
    const vals = Object.values(type).filter(Boolean);
    if (vals.length) productType = vals.every((v) => v === vals[0]) ? String(vals[0]) : String(vals[0]);
  }
  if (!productType && combined.length) {
    const first = combined.find((s) => !!s.type);
    if (first) productType = String(first.type);
  }
  if (meta?.productType) productType = meta.productType;

  return { rows: combined, productType };
}

// ---------- Bucketing rules (same thresholds + name map) ----------
const CATEGORY_KEY_MAP = {
  "daily-neutrals": "neutrals",
  "perfect-pinks": "pinks",
  "bold-and-deep": "bold",
  "bright-and-fun": "bright",
  "reds-and-browns": "reds_browns",
  "random": "random",
};

const brightnessThresholds = {
  neutrals: [[40, 59, "D"], [60, 74, "M"], [75, 100, "L"]],
  pinks: [[40, 59, "D"], [60, 74, "M"], [75, 100, "L"]],
  bold: [[0, 25, "D"], [26, 35, "M"], [36, 50, "L"]],
  bright: [[75, 80, "D"], [81, 90, "M"], [91, 100, "L"]],
  reds_browns: [[0, 35, "D"], [36, 60, "M"], [61, 80, "L"]],
  random: [[0, 50, "D"], [50, 70, "M"], [70, 100, "L"]],
};

function getPriceBucket(price, size = 500, max = 5000) {
  const p = Number(price || 0);
  if (Number.isNaN(p)) return "0";
  return p > max ? `${max}` : `${Math.floor(p / size) * size}`;
}

function getLMDBucketFromSkintone(skintone) {
  if (["F", "FM"].includes(skintone)) return "L";
  if (["MD", "D1"].includes(skintone)) return "M";
  if (["D2", "VD"].includes(skintone)) return "D";
  return null;
}

function getCategoriesFromHSV(h, s, v) {
  const categories = [];
  if (s > 40 && s < 65 && v > 35 && v < 70) categories.push("daily-neutrals");
  if (((h <= 8 || h >= 350) && s >= 45 && s <= 75 && v >= 40) || (h >= 325 && h < 350 && s >= 40 && v >= 50)) categories.push("perfect-pinks");
  if (s > 55 && v < 50) categories.push("bold-and-deep");
  if (s > 75 && v > 75) categories.push("bright-and-fun");
  if (h >= 0 && h <= 15 && s > 70 && v < 70) categories.push("reds-and-browns");
  categories.push("random");
  return categories;
}

function getLMDBucketFromBrightness(v, categoryKeyForThresholds) {
  const range = brightnessThresholds[categoryKeyForThresholds] || [];
  for (const [min, max, label] of range) {
    if (v >= min && v <= max) return label;
  }
  return null;
}

function insertShadeIntoDict(shade, dict, requestedCategory) {
  const hex = (shade.shade_hex_code || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return dict;

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0, s = 0, v = max;
  s = max === 0 ? 0 : d / max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  s *= 100;
  v *= 100;
  const v_scaled = Math.round(v);
  const priceBucket = getPriceBucket(shade.price);

  const isBase = ["foundation", "concealer", "skin-tint"].includes(requestedCategory);
  const isContour = requestedCategory === "contour";

  const categoryList = isBase
    ? [shade.coverage || "any"]
    : isContour
    ? [shade.finish || "any"]
    : getCategoriesFromHSV(h, s, v);

  const lmd = (isBase || isContour)
    ? getLMDBucketFromSkintone(shade.skintone)
    : categoryList.map((cat) => {
        const key = CATEGORY_KEY_MAP[cat] || cat; // map hyphen names -> threshold keys
        return getLMDBucketFromBrightness(v_scaled, key);
      });

  for (let i = 0; i < categoryList.length; i++) {
    const category = categoryList[i];
    const lmdLabel = isBase || isContour ? lmd : lmd[i];
    if (!lmdLabel) continue;

    if (!dict[category]) dict[category] = {};
    if (!dict[category][priceBucket]) dict[category][priceBucket] = { L: [], M: [], D: [] };

    dict[category][priceBucket][lmdLabel].push({
      [`#${hex}`]: {
        brand: shade.brand,
        product_name: shade.product_name,
        shade_name: shade.shade_name,
        shade_hex_code: shade.shade_hex_code,
        price: shade.price,
        link: shade.link || "",
        type: requestedCategory,
      },
    });
  }
  return dict;
}

// ---------- Existing dict loader + product index ----------
async function loadExistingCategoryDict(category) {
  const key = `find_products/product_database/${category}/categorised_LMD.json`;
  return await getJSON(DATA_BUCKET, key); // may be null
}

function indexExistingProducts(existingDict) {
  const set = new Set(); // "Brand:::Product"
  if (!existingDict || typeof existingDict !== "object") return set;

  for (const top of Object.keys(existingDict)) {
    const priceMap = existingDict[top] || {};
    for (const price of Object.keys(priceMap)) {
      const lmdMap = priceMap[price] || {};
      for (const bucket of ["L", "M", "D"]) {
        const arr = lmdMap[bucket] || [];
        for (const entry of arr) {
          const inner = entry && typeof entry === "object" ? Object.values(entry)[0] : null;
          if (inner && inner.brand && inner.product_name) {
            set.add(`${inner.brand}:::${inner.product_name}`);
          }
        }
      }
    }
  }
  return set;
}

// ---------- merge + ensure-min helpers ----------
function getEntryKey(entry) {
  // entry = { "#HEX": { brand, product_name, shade_name, ... } }
  if (!entry || typeof entry !== "object") return "";
  const inner = Object.values(entry)[0];
  if (!inner || typeof inner !== "object") return "";
  const brand = inner.brand || "";
  const product = inner.product_name || "";
  const shade = inner.shade_name || "";
  return `${brand}:::${product}:::${shade}`;
}

function pushUnique(destArr, srcArr, needed, seen) {
  let added = 0;
  for (const e of srcArr) {
    if (added >= needed) break;
    const k = getEntryKey(e);
    if (!k) continue;
    if (seen.has(k)) continue; // avoid duplicates in the *target* array
    destArr.push(e);
    seen.add(k);
    added++;
  }
  return added;
}

function ensureMinPerBucket(dict, min = 6) {
  if (!dict || typeof dict !== "object") return dict;

  for (const top of Object.keys(dict)) {
    const priceMap = dict[top] || {};
    for (const price of Object.keys(priceMap)) {
      const lmd = priceMap[price] || {};
      lmd.L = Array.isArray(lmd.L) ? lmd.L : [];
      lmd.M = Array.isArray(lmd.M) ? lmd.M : [];
      lmd.D = Array.isArray(lmd.D) ? lmd.D : [];

      // Build a "seen" set for each bucket to avoid duplicates when borrowing
      const seenL = new Set(lmd.L.map(getEntryKey));
      const seenM = new Set(lmd.M.map(getEntryKey));
      const seenD = new Set(lmd.D.map(getEntryKey));

      // L: borrow from M, then D
      if (lmd.L.length < min) {
        let need = min - lmd.L.length;
        need -= pushUnique(lmd.L, lmd.M, need, seenL);
        if (need > 0) pushUnique(lmd.L, lmd.D, need, seenL);
      }
      // M: borrow from L, then D
      if (lmd.M.length < min) {
        let need = min - lmd.M.length;
        need -= pushUnique(lmd.M, lmd.L, need, seenM);
        if (need > 0) pushUnique(lmd.M, lmd.D, need, seenM);
      }
      // D: borrow from M, then L
      if (lmd.D.length < min) {
        let need = min - lmd.D.length;
        need -= pushUnique(lmd.D, lmd.M, need, seenD);
        if (need > 0) pushUnique(lmd.D, lmd.L, need, seenD);
      }

      priceMap[price] = lmd;
    }
    dict[top] = priceMap;
  }
  return dict;
}

function deepMergeDicts(baseDict, addDict) {
  // Merge addDict into baseDict (deep for category -> price -> L/M/D arrays)
  if (!baseDict || typeof baseDict !== "object") baseDict = {};
  if (!addDict || typeof addDict !== "object") return baseDict;

  const out = { ...baseDict };

  for (const cat of Object.keys(addDict)) {
    if (!out[cat]) out[cat] = {};
    const priceMap = out[cat];
    const addPriceMap = addDict[cat] || {};
    for (const price of Object.keys(addPriceMap)) {
      if (!priceMap[price]) priceMap[price] = { L: [], M: [], D: [] };
      const lmd = priceMap[price];
      const addLmd = addPriceMap[price] || {};
      for (const bucket of ["L", "M", "D"]) {
        const dest = Array.isArray(lmd[bucket]) ? lmd[bucket] : [];
        const src = Array.isArray(addLmd[bucket]) ? addLmd[bucket] : [];
        // concat, but avoid duplicates within the bucket by key
        const seen = new Set(dest.map(getEntryKey));
        for (const e of src) {
          const k = getEntryKey(e);
          if (!k || seen.has(k)) continue;
          dest.push(e);
          seen.add(k);
        }
        lmd[bucket] = dest;
      }
      priceMap[price] = lmd;
    }
    out[cat] = priceMap;
  }

  return out;
}

// ---------- POST: build + return (no upload) ----------
export async function POST(req) {
  try {
    const { category } = await req.json();
    if (!category) {
      return new Response(JSON.stringify({ success: false, error: "Missing 'category'" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // 1) load existing dict + index products inside it
    const existingDict = await loadExistingCategoryDict(category);
    const existingIndex = indexExistingProducts(existingDict);

    // 2) discover products and build dict (skipping products already present)
    const all = await listAllBrandProducts();

    const built = {};
    const considered = [];
    for (const { brand, product } of all) {
      const { rows, productType } = await loadMergedShades(brand, product);
      if (!rows?.length) continue;
      if (productType !== category) continue;

      // Lip-only: must have edited_final_shades
      if (isLipCategory(category)) {
        const ok = await hasEditedFinalShades(brand, product);
        if (!ok) continue;
      }

      // Skip if this product already exists in the current CategorisedLMD
      if (existingIndex.has(`${brand}:::${product}`)) continue;

      considered.push({ brand, product, count: rows.length });

      for (const s of rows) {
        const shade = {
          brand,
          product_name: product,
          shade_name: s.name,
          shade_hex_code: s.hex,
          price: s.price ?? 0,
          link: s.link || "",
          type: category,
          // base/contour helpers if needed later
          coverage: "",
          finish: "",
          skintone: s.skintone || "",
        };
        insertShadeIntoDict(shade, built, category);
      }
    }

    // 3) merge new build into existing (so the returned dict includes both)
    const merged = deepMergeDicts(existingDict || {}, built);

    // 4) enforce at least 6 items per L/M/D per price bucket
    const finalDict = ensureMinPerBucket(merged, 6);

    return new Response(
      JSON.stringify({
        success: true,
        filename: `CategorisedLMD.${category}.json`,
        target_key_if_uploaded: `find_products/product_database/${category}/categorised_LMD.json`,
        bucket_hint: DATA_BUCKET,
        considered,
        summary: {
          products_considered: considered.length,
          total_shades: considered.reduce((a, b) => a + (b.count || 0), 0),
          top_level_categories: Object.keys(finalDict || {}),
        },
        dict: finalDict, // <- return merged + min-enforced JSON here
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e?.message || "Failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
