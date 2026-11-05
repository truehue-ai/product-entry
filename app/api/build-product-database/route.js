// app/api/build-product-database/route.js
export const runtime = "nodejs";
export const maxDuration = 300;

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { getSessionUser } from "../../lib/auth";
import { rejectUnlessActionPassword } from "../shade-capture/actionAuth";

const REGION = process.env.X_AWS_REGION;

const DATA_BUCKET = "truehue-full-data";     // where categorised_LMD.json lives; each build saves here (after backing up the old file)
const WORK_BUCKET = process.env.X_AWS_BUCKET_NAME;
// India (default) reads brands/ and targets find_products/; USA ({ usa: true }) reads brands_usa/ and targets find_products_usa/
const brandsRoot = (usa) => (usa ? "brands_usa" : "brands");
const dbKey = (usa, category) => `${usa ? "find_products_usa" : "find_products"}/product_database/${category}/categorised_LMD.json`;

const s3 = new S3Client({
  region: REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
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

async function listAllBrandProducts(usa = false) {
  const prefix = `${brandsRoot(usa)}/`;
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
        new RegExp(`^${brandsRoot(usa)}/([^/]+)/product_shade_values/([^/]+)/(shades\\.json|links\\.json|price\\.json|types?\\.json)$`)
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

// ---------- category helpers ----------
const LIP_CATEGORIES = new Set([
  "matte-lipstick",
  "satin-lipstick",
]);

const BLUSH_EYESHADOW_CATEGORIES = new Set([
  "powder-blush",
  "cream-blush",
  "powder-eyeshadow",
  "cream-eyeshadow",
  "bronzer",
  "highlighter",
]);

const GLOSS_CATEGORIES = new Set([
  "lip-gloss",
  "lip-oil",
  "lip-balm",
  "lip-tint",
]);

function isGlossCategory(cat) {
  return GLOSS_CATEGORIES.has(String(cat || "").toLowerCase());
}

function isBlushEyeshadowCategory(cat) {
  return BLUSH_EYESHADOW_CATEGORIES.has(String(cat || "").toLowerCase());
}

function isLipCategory(cat) {
  return LIP_CATEGORIES.has(String(cat || "").toLowerCase());
}

// NEW: base category helper
function isBaseCategory(cat) {
  const lower = String(cat || "").toLowerCase();
  return lower === "foundation" || lower === "concealer" || lower === "skin-tint";
}

async function hasEditedFinalShades(brand, product, usa = false) {
  // Folder-style prefix check: brands/<brand>/edited_final_shades/<product>/**
  const folderPrefix = `${brandsRoot(usa)}/${brand}/edited_final_shades/${product}/`;
  const folderResp = await s3.send(
    new ListObjectsV2Command({
      Bucket: WORK_BUCKET,
      Prefix: folderPrefix,
      MaxKeys: 1,
    })
  );
  if ((folderResp.Contents || []).length > 0) return true;

  // File-style fallback: brands/<brand>/edited_final_shades/${product}.json
  const filePrefix = `${brandsRoot(usa)}/${brand}/edited_final_shades/${product}.json`;
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

async function loadMergedShades(brand, product, usa = false) {
  const root = brandsRoot(usa);
  const base = `${root}/${brand}/product_shade_values/${product}`;
  // all candidate files read at once (same files and same fallback order as before)
  const [shades, meta, links1, links2, price1, price2, type1, type2, type3, type4] = await Promise.all([
    getJSON(WORK_BUCKET, `${base}/shades.json`),
    getJSON(WORK_BUCKET, `${base}/meta.json`),
    getJSON(WORK_BUCKET, `${base}/links.json`),
    getJSON(WORK_BUCKET, `${root}/${brand}/links/${product}/links.json`),
    getJSON(WORK_BUCKET, `${base}/price.json`),
    getJSON(WORK_BUCKET, `${root}/${brand}/price/${product}/price.json`),
    getJSON(WORK_BUCKET, `${base}/types.json`),
    getJSON(WORK_BUCKET, `${base}/type.json`),
    getJSON(WORK_BUCKET, `${root}/${brand}/type/${product}/types.json`),
    getJSON(WORK_BUCKET, `${root}/${brand}/type/${product}/type.json`),
  ]);
  const links = links1 || links2;
  const price = price1 || price2;
  const type = type1 || type2 || type3 || type4;

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
  "random": "random",
};

const brightnessThresholds = {
  random:        [[0, 51, "D"], [51, 73, "M"], [73, 100, "L"]],
  random_bright: [[0, 80, "D"], [80, 90, "M"], [90, 100, "L"]],
  random_gloss:  [[0, 72, "D"], [72, 85, "M"], [85, 100, "L"]],
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

function getCategoriesWithDepth(h, s, v) {
  const results = [];
  const hInRange = (h, ...ranges) => ranges.some(([lo, hi]) => h >= lo && h <= hi);
  const lmd = getLMDFromSV(s, v, "lip");

  if (hInRange(h, [0,10],[350,359]) && s>=45 && s<=60)
    results.push({ category: "daily-neutrals", lmd });

  if (hInRange(h, [0,5],[345,359]) && s>=40 && s<65)
    results.push({ category: "perfect-pinks", lmd });

  if (hInRange(h, [0,7],[353,359]) && s>=65 && s<=85)
    results.push({ category: "reds-and-browns", lmd });

  if (hInRange(h, [0,25],[330,359]) && s>65)
    results.push({ category: "bold-and-deep", lmd });

  if (hInRange(h, [0,25],[330,359]) && s>70)
    results.push({ category: "bright-and-fun", lmd });

  return results;
}

// Blush/eyeshadow variant — v thresholds shifted up by ~15 to account for
// Blush/eyeshadow variant — uses centroid-based S+V boundary for LMD
function getCategoriesWithDepth_bright(h, s, v) {
  const results = [];
  const hInRange = (h, ...ranges) => ranges.some(([lo, hi]) => h >= lo && h <= hi);
  const lmd = getLMDFromSV(s, v, "bright");

  if (hInRange(h, [0,10],[350,359]) && s>=30 && s<=60)
    results.push({ category: "daily-neutrals", lmd });

  if (hInRange(h, [0,5],[345,359]) && s>=40 && s<65)
    results.push({ category: "perfect-pinks", lmd });

  if (hInRange(h, [0,7],[353,359]) && s>=65 && s<=85)
    results.push({ category: "reds-and-browns", lmd });

  if (hInRange(h, [0,25],[330,359]) && s>=65)
    results.push({ category: "bold-and-deep", lmd });

  if (hInRange(h, [0,25],[330,359]) && s>65)
    results.push({ category: "bright-and-fun", lmd });

  return results;
}

// Gloss variant — v thresholds shifted up vs matte/satin since glosses are
// inherently high-v products. D=v<78, M=v78-89, L=v>=89 (data-driven from actual gloss distribution)
// Gloss variant — uses centroid-based S+V boundary for LMD
function getCategoriesWithDepth_gloss(h, s, v) {
  const results = [];
  const hInRange = (h, ...ranges) => ranges.some(([lo, hi]) => h >= lo && h <= hi);
  const lmd = getLMDFromSV(s, v, "gloss");

  if (hInRange(h, [0,10],[350,359]) && s>=45 && s<=62)
    results.push({ category: "daily-neutrals", lmd });

  if (hInRange(h, [0,5],[345,359]) && s>=40 && s<65)
    results.push({ category: "perfect-pinks", lmd });

  if (hInRange(h, [0,7],[353,359]) && s>=65 && s<=85)
    results.push({ category: "reds-and-browns", lmd });

  if (hInRange(h, [0,25],[330,359]) && s>65)
    results.push({ category: "bold-and-deep", lmd });

  if (hInRange(h, [0,25],[330,359]) && s>70)
    results.push({ category: "bright-and-fun", lmd });

  return results;
}

// Centroids for each category per depth — midpoint of H, S, V ranges
const CATEGORY_CENTROIDS = {
  L: {
    "daily-neutrals":  { h: 5,    s: 45,   v: 85 },
    "perfect-pinks":   { h: 2.5,  s: 55,   v: 85 },
    "reds-and-browns": { h: 3.5,  s: 70,   v: 88 },
    "bold-and-deep":   { h: 12.5, s: 75,   v: 88 },
    "bright-and-fun":  { h: 12.5, s: 82,   v: 89 },
  },
  M: {
    "daily-neutrals":  { h: 5,    s: 45,   v: 60 },
    "perfect-pinks":   { h: 2.5,  s: 55,   v: 60 },
    "reds-and-browns": { h: 3.5,  s: 70,   v: 60 },
    "bold-and-deep":   { h: 12.5, s: 75,   v: 60 },
    "bright-and-fun":  { h: 12.5, s: 82,   v: 60 },
  },
  D: {
    "daily-neutrals":  { h: 5,    s: 45,   v: 42 },
    "perfect-pinks":   { h: 2.5,  s: 55,   v: 42 },
    "reds-and-browns": { h: 3.5,  s: 70,   v: 42 },
    "bold-and-deep":   { h: 12.5, s: 75,   v: 42 },
    "bright-and-fun":  { h: 12.5, s: 82,   v: 42 },
  },
};

// Blush/eyeshadow centroids — v values shifted up by ~15
const CATEGORY_CENTROIDS_BRIGHT = {
  L: {
    "daily-neutrals":  { h: 5,    s: 45, v: 87 },
    "perfect-pinks":   { h: 2.5,  s: 52, v: 90 },
    "reds-and-browns": { h: 3.5,  s: 75, v: 97 },
    "bold-and-deep":   { h: 12.5, s: 75, v: 97 },
    "bright-and-fun":  { h: 12.5, s: 70, v: 97 },
  },
  M: {
    "daily-neutrals":  { h: 5,    s: 45, v: 73 },
    "perfect-pinks":   { h: 2.5,  s: 52, v: 78 },
    "reds-and-browns": { h: 3.5,  s: 75, v: 90 },
    "bold-and-deep":   { h: 12.5, s: 75, v: 90 },
    "bright-and-fun":  { h: 12.5, s: 70, v: 89 },
  },
  D: {
    "daily-neutrals":  { h: 5,    s: 45, v: 65 },
    "perfect-pinks":   { h: 2.5,  s: 52, v: 65 },
    "reds-and-browns": { h: 3.5,  s: 75, v: 65 },
    "bold-and-deep":   { h: 12.5, s: 75, v: 65 },
    "bright-and-fun":  { h: 12.5, s: 70, v: 65 },
  },
};

// Gloss centroids — midpoints of v78/89 bands, s from actual data
const CATEGORY_CENTROIDS_GLOSS = {
  L: {
    "daily-neutrals":  { h: 5,    s: 53, v: 93  },
    "perfect-pinks":   { h: 2.5,  s: 52, v: 93  },
    "reds-and-browns": { h: 3.5,  s: 75, v: 93  },
    "bold-and-deep":   { h: 12.5, s: 73, v: 93  },
    "bright-and-fun":  { h: 12.5, s: 78, v: 93  },
  },
  M: {
    "daily-neutrals":  { h: 5,    s: 53, v: 79  },
    "perfect-pinks":   { h: 2.5,  s: 52, v: 79  },
    "reds-and-browns": { h: 3.5,  s: 75, v: 79  },
    "bold-and-deep":   { h: 12.5, s: 73, v: 79  },
    "bright-and-fun":  { h: 12.5, s: 78, v: 79  },
  },
  D: {
    "daily-neutrals":  { h: 5,    s: 53, v: 55  },
    "perfect-pinks":   { h: 2.5,  s: 52, v: 55  },
    "reds-and-browns": { h: 5,    s: 75, v: 55  },
    "bold-and-deep":   { h: 12.5, s: 73, v: 48  },
    "bright-and-fun":  { h: 12.5, s: 78, v: 48  },
  },
};

// Hue rule definitions — mirrors the conditions in getCategoriesWithDepth/_bright
const CATEGORY_HUE_RULES = [
  { category: "daily-neutrals", hRanges: [[0,10],[350,359]] },
  { category: "perfect-pinks",  hRanges: [[0,5],[345,359]]  },
  { category: "reds-and-browns",hRanges: [[0,10],[355,359]] },
  { category: "bold-and-deep",  hRanges: [[0,25],[330,359]] },
  { category: "bright-and-fun", hRanges: [[0,25],[330,359]] },
];

function hInRange(h, ranges) {
  return ranges.some(([lo, hi]) => h >= lo && h <= hi);
}

function getNearestCategoryAndDepth(h, s, v, centroidsTable) {
  // 1) Find which categories this shade's hue qualifies for
  const hueMatches = CATEGORY_HUE_RULES
    .filter(rule => hInRange(h, rule.hRanges))
    .map(rule => rule.category);

  const candidates = hueMatches.length > 0 ? hueMatches : null;
  if (!candidates) return { category: "random", lmd: null };

  // 2) Search across all L/M/D tiers for those candidates — pick best by s+v only
  let nearest = candidates[0];
  let nearestLmd = "L";
  let minDist = Infinity;

  for (const lmd of ["L", "M", "D"]) {
    const tierCentroids = centroidsTable[lmd];
    for (const category of candidates) {
      const c = tierCentroids[category];
      if (!c) continue;
      const dist = Math.sqrt((s - c.s) ** 2 + (v - c.v) ** 2);
      if (dist < minDist) {
        minDist = dist;
        nearest = category;
      }
    }
  }

  // Use getLMDFromSV for consistent lmd assignment instead of centroid-derived lmd
  const type = centroidsTable === CATEGORY_CENTROIDS_BRIGHT
    ? "bright"
    : centroidsTable === CATEGORY_CENTROIDS_GLOSS
      ? "gloss"
      : "lip";
  return { category: nearest, lmd: getLMDFromSV(s, v, type) };
}

// Centroid-based S+V classifier — derived from perpendicular bisectors of
// ideal skintone centroids. Replaces flat v-only thresholds in depth functions.
function getLMDFromSV(s, v, type = "lip") {
  if (type === "bright") {
    // Blush/eyeshadow centroids derived from actual data (v-thirds):
    // D=(s=43.4, v=46.0)  M=(s=44.6, v=71.8)  L=(s=32.8, v=88.3)
    // L/M boundary: v = 0.7152*s + 52.37
    // M/D boundary: v = -0.0465*s + 60.95
    if (v >= 0.7152 * s + 52.37) return "L";
    if (v >= -0.0465 * s + 60.95) return "M";
    return "D";
} else if (type === "gloss") {
    // Gloss ideals derived from actual gloss data centroids:
    // D=(s=62.5, v=67.5)  M=(s=56.3, v=84.6)  L=(s=50.8, v=94.7)
    // L/M boundary: v = 0.5446*s + 60.49
    // M/D boundary: v = 0.3626*s + 54.51
    if (v >= 0.5446 * s + 60.49) return "L";
    if (v >= 0.3626 * s + 54.51) return "M";
    return "D";
} else {
    // Lip (matte/satin) ideals: L=(57,81) M=(62,63) D=(65,40)
    // L/M boundary: v = (10s + 1997) / 36
    // M/D boundary: v = (6s + 1988) / 46
    if (v >= (10 * s + 1997) / 36) return "L";
    if (v >= (6  * s + 1988) / 46) return "M";
    return "D";
  }
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

  const baseCategory = isBaseCategory(requestedCategory);
  const isContour = requestedCategory === "contour";

  // *** CHANGE: coverage buckets for base categories
  if (baseCategory) {
    // Base products: coverage buckets x skintone-based LMD
    const coverageList = ["low", "medium", "full"];
    const lmdLabel = getLMDBucketFromSkintone(shade.skintone);
    if (lmdLabel) {
      for (const coverage of coverageList) {
        if (!dict[coverage]) dict[coverage] = {};
        if (!dict[coverage][priceBucket]) dict[coverage][priceBucket] = { L: [], M: [], D: [] };
        dict[coverage][priceBucket][lmdLabel].push({
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
    }
  } else if (isContour) {
    // Contour: finish-based category x skintone-based LMD
    const category = shade.finish || "any";
    const lmdLabel = getLMDBucketFromSkintone(shade.skintone);
    if (lmdLabel) {
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
  } else {
    // Lip/colour products: depth-aware category matching
    // Blush/eyeshadow use brightness-shifted thresholds and centroids
    const useBright = isBlushEyeshadowCategory(requestedCategory);
    const useGloss  = isGlossCategory(requestedCategory);

    let categoryDepthPairs = useBright
      ? getCategoriesWithDepth_bright(h, s, v)
      : useGloss
        ? getCategoriesWithDepth_gloss(h, s, v)
        : getCategoriesWithDepth(h, s, v);

    // If shade matched nothing except random, find nearest category for its depth
    const realMatches = categoryDepthPairs.filter(p => p.category !== "random");

    if (realMatches.length === 0) {
      const centroidsTable = useBright
        ? CATEGORY_CENTROIDS_BRIGHT
        : useGloss
          ? CATEGORY_CENTROIDS_GLOSS
          : CATEGORY_CENTROIDS;
      const { category: nearest, lmd } = getNearestCategoryAndDepth(h, s, v_scaled, centroidsTable);
      if (nearest === "random") {
        categoryDepthPairs = []; // skip named categories; random will still be added below
      } else {
        categoryDepthPairs = [{ category: nearest, lmd }];
      }
    }

    // Always add to random using brightness-based LMD (existing behavior)
    const randomKey = useBright ? "random_bright" : useGloss ? "random_gloss" : (CATEGORY_KEY_MAP["random"] || "random");
    const randomLmd = getLMDBucketFromBrightness(v_scaled, randomKey);
    if (randomLmd) {
      categoryDepthPairs.push({ category: "random", lmd: randomLmd });
    }

    for (const { category, lmd: lmdLabel } of categoryDepthPairs) {
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
  }
  return dict;
}

// ---------- Existing dict loader + product index ----------
async function loadExistingCategoryDict(category, usa = false) {
  const key = dbKey(usa, category);
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

// ---------- POST: build, save to S3 (old file backed up first) + return for download ----------
export async function POST(req) {
  let stage = "starting";
  try {
    const { category, mode = "rebuild", usa: usaRaw = false, password } = await req.json();
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
    if ((await getSessionUser()) !== "dhruvi") {
      return new Response(JSON.stringify({ success: false, error: "Only dhruvi can build the product database" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    const usa = usaRaw === true || usaRaw === "1" || usaRaw === "usa";
    if (!category) {
      return new Response(JSON.stringify({ success: false, error: "Missing 'category'" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    // mode: "incremental" = skip products already in existing dict (default)
    //        "rebuild"     = ignore existing dict, build from scratch

    // 1) load existing dict + index products inside it
    stage = "reading the current database file";
    const existingDict = await loadExistingCategoryDict(category, usa);
    const existingIndex = indexExistingProducts(existingDict);

    // 2) discover products and build dict (skipping products already present)
    stage = `listing ${brandsRoot(usa)}/`;
    const all = await listAllBrandProducts(usa);

    stage = "reading products";
    // load products 25 at a time (in parallel); results are used in the same order as before
    const loaded = [];
    for (let i = 0; i < all.length; i += 25) {
      const batch = await Promise.all(all.slice(i, i + 25).map(async ({ brand, product }) => {
        const { rows, productType } = await loadMergedShades(brand, product, usa);
        if (!rows?.length || productType !== category) return null; // (no edited_final_shades requirement any more)
        return { brand, product, rows };
      }));
      loaded.push(...batch);
    }

    stage = "building the dictionary";
    const built = {};
    const considered = [];
    for (const item of loaded) {
      if (!item) continue;
      const { brand, product, rows } = item;

      // Skip if this product already exists in the current CategorisedLMD
      // Skip if this product already exists in the current CategorisedLMD (incremental mode only)
      if (mode === "incremental" && existingIndex.has(`${brand}:::${product}`)) continue;

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

    // 3) merge new build into existing (incremental) or use fresh build only (rebuild)
    const merged = mode === "rebuild" ? built : deepMergeDicts(existingDict || {}, built);

    // 4) enforce at least 6 items per L/M/D per price bucket
    const finalDict = ensureMinPerBucket(merged, 6);

    // 5) save to S3: copy the current file to backups/ first (a new file, nothing deleted), then overwrite it
    const targetKey = dbKey(usa, category);
    let backupKey = null;
    let saved = false;
    let saveError = null;
    try {
      // never overwrite the database with an empty build
      if (!considered.length) throw new Error(mode === "incremental"
        ? `No new ${category} products in ${brandsRoot(usa)}/ — nothing to add, the current file is unchanged`
        : `No ${category} products found in ${brandsRoot(usa)}/ — nothing saved, the current file is unchanged`);
      if (existingDict) {
        stage = "backing up the current file";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupKey = targetKey.replace(/categorised_LMD\.json$/, `backups/categorised_LMD.${stamp}.json`);
        await s3.send(new CopyObjectCommand({
          Bucket: DATA_BUCKET,
          CopySource: `${DATA_BUCKET}/${targetKey.split("/").map(encodeURIComponent).join("/")}`,
          Key: backupKey,
        }));
      }
      stage = "saving to S3";
      await s3.send(new PutObjectCommand({
        Bucket: DATA_BUCKET,
        Key: targetKey,
        Body: JSON.stringify(finalDict, null, 2),
        ContentType: "application/json",
      }));
      saved = true;
    } catch (e) {
      // the build is still returned for download; the old file is untouched if the backup step failed
      saveError = `Failed while ${stage}: ${e?.name || ""} ${e?.message || ""}`.trim();
      console.error("[build-product-database]", saveError);
      if (!existingDict || stage === "backing up the current file") backupKey = null;
    }

    return new Response(
      JSON.stringify({
        success: true,
        filename: usa ? `CategorisedLMD.usa.${category}.json` : `CategorisedLMD.${category}.json`,
        market: usa ? "usa" : "india",
        saved,
        save_error: saveError,
        bucket: DATA_BUCKET,
        key: targetKey,
        backup_key: backupKey,
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
    const error = `Failed while ${stage}: ${e?.name || ""} ${e?.message || "Failed"}`.trim();
    console.error("[build-product-database]", error, e);
    return new Response(JSON.stringify({ success: false, error }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
