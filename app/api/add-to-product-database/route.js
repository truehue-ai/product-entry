// app/api/add-to-product-database/route.js
export const runtime = "nodejs";

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/* --------------------------- Thresholds & Mapping -------------------------- */
const brightnessThresholds = {
  neutrals: [[40, 59, "D"], [60, 74, "M"], [75, 100, "L"]],
  pinks: [[40, 59, "D"], [60, 74, "M"], [75, 100, "L"]],
  bold: [[0, 25, "D"], [26, 35, "M"], [36, 50, "L"]],
  bright: [[75, 80, "D"], [81, 90, "M"], [91, 100, "L"]],
  reds_browns: [[0, 35, "D"], [36, 60, "M"], [61, 80, "L"]],
  random: [[0, 50, "D"], [50, 70, "M"], [70, 100, "L"]],
};

// Map the HSV-display category keys to the threshold keys above
const CATEGORY_KEY_MAP = {
  "daily-neutrals": "neutrals",
  "perfect-pinks": "pinks",
  "bold-and-deep": "bold",
  "bright-and-fun": "bright",
  "reds-and-browns": "reds_browns",
  "random": "random",
};

/* --------------------------------- Utils ---------------------------------- */
function getPriceBucket(price, size = 500, max = 5000) {
  const p = Number(price ?? 0);
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
  if (
    ((h <= 8 || h >= 350) && s >= 45 && s <= 75 && v >= 40) ||
    (h >= 325 && h < 350 && s >= 40 && v >= 50)
  ) {
    categories.push("perfect-pinks");
  }
  if (s > 55 && v < 50) categories.push("bold-and-deep");
  if (s > 75 && v > 75) categories.push("bright-and-fun");
  if (h >= 0 && h <= 15 && s > 70 && v < 70) categories.push("reds-and-browns");
  categories.push("random");
  return categories;
}

function getLMDBucketFromBrightness(v, displayKey) {
  const k = CATEGORY_KEY_MAP[displayKey] || displayKey;
  const range = brightnessThresholds[k] || [];
  for (const [min, max, label] of range) {
    if (v >= min && v <= max) return label;
  }
  return null;
}

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

/* -------------------------- Insertion (aligned) --------------------------- */
function insertShadeIntoDict(shade, dict, productCategory) {
  // Guard hex
  const hexRaw = String(shade.shade_hex_code || "");
  const hex = hexRaw.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return dict;

  // RGB -> HSV
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  let s = 0;
  let v = max;

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

  const isBaseProductCategory = ["foundation", "concealer", "skin-tint"].includes(
    String(productCategory || "").toLowerCase()
  );
  const isContourCategory = String(productCategory || "").toLowerCase() === "contour";

  // Match builder: for base categories, force all 3 coverage buckets
  const categoryList = isBaseProductCategory
    ? ["low", "medium", "full"]
    : isContourCategory
    ? [shade.finish || "any"]
    : getCategoriesFromHSV(h, s, v);

  // For base/contour, L/M/D from skintone; for others, from brightness thresholds
  const lmd = isBaseProductCategory || isContourCategory
    ? getLMDBucketFromSkintone(shade.skintone)
    : categoryList.map((cat) => getLMDBucketFromBrightness(v_scaled, cat));

  for (let i = 0; i < categoryList.length; i++) {
    const category = categoryList[i];
    const lmdLabel = (isBaseProductCategory || isContourCategory) ? lmd : lmd[i];
    if (!lmdLabel) continue;

    // Ensure structure
    if (!dict[category]) dict[category] = {};
    if (!dict[category][priceBucket]) dict[category][priceBucket] = { L: [], M: [], D: [] };

    const bucketArr = dict[category][priceBucket][lmdLabel];

    // De-dupe within bucket (brand+product+shade)
    const entryKey = `${shade.brand}:::${shade.product_name}:::${shade.shade_name}`;
    const exists = bucketArr.some((e) => getEntryKey(e) === entryKey);
    if (exists) continue;

    bucketArr.push({
      [`#${hex}`]: {
        brand: shade.brand,
        product_name: shade.product_name,
        shade_name: shade.shade_name,
        shade_hex_code: `#${hex}`,
        price: shade.price,
        link: shade.link || "",
        type: productCategory, // align with builder
      },
    });
  }

  return dict;
}

/* --------------------------------- Route ---------------------------------- */
export async function POST(req) {
  const { shades, product_category } = await req.json();

  if (!product_category || !Array.isArray(shades)) {
    return Response.json(
      { success: false, error: "Missing or invalid 'product_category' or 'shades'." },
      { status: 400 }
    );
  }

  const bucket = "truehue-backend-data";
  // ALIGN with builder path & filename
  const key = `find_products/product_database/${product_category}/categorised_LMD.json`;

  const s3 = new S3Client({
    region: process.env.X_AWS_REGION,
    credentials: {
      accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
    },
  });

  // Load existing dict (or start fresh)
  let currentDict = {};
  try {
    const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const streamToString = (stream) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      });

    const jsonText = await streamToString(data.Body);
    currentDict = JSON.parse(jsonText || "{}");
  } catch (err) {
    // Accept new file creation if not found
    if (
      err?.Code === "NoSuchKey" ||
      err?.name === "NoSuchKey" ||
      err?.$metadata?.httpStatusCode === 404
    ) {
      console.warn(`No existing dict at ${key}. Creating a new one.`);
      currentDict = {};
    } else {
      console.error("Failed to load existing product database:", err);
      return Response.json({ success: false, error: err.message || "Load failed" }, { status: 500 });
    }
  }

  // Insert shades
  try {
    for (const shade of shades) {
      insertShadeIntoDict(shade, currentDict, product_category);
    }

    const updatedJson = JSON.stringify(currentDict, null, 2);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: updatedJson,
        ContentType: "application/json",
      })
    );

    return Response.json({ success: true, bucket, key });
  } catch (err) {
    console.error("Product DB update failed:", err);
    return Response.json({ success: false, error: err.message || "Update failed" }, { status: 500 });
  }
}
