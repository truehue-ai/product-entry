export const runtime = "nodejs";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

// ---- helpers ---------------------------------------------------------------

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch (e) {
    // console.warn("S3 getJSON failed for", Key, e?.name, e?.message);
    return null;
  }
}

async function firstExisting(keys) {
  for (const k of keys) {
    const data = await getJSON(k);
    if (data) return { data, key: k };
  }
  return { data: null, key: null };
}

// detect nested foundation object: F/FM/MD/D1/D2/VD at top level
function isFoundationNested(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const toneKeys = ["F", "FM", "MD", "D1", "D2", "VD"];
  return toneKeys.some((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

// flatten: {F:{W:{'118':'#hex',...},N:{...},C:{...}}, FM:{...}, ...} -> array
function flattenFoundation(obj) {
  const out = [];
  for (const [skintone, undertones] of Object.entries(obj)) {
    if (!undertones || typeof undertones !== "object") continue;
    for (const [undertone, shadesObj] of Object.entries(undertones)) {
      if (!shadesObj || typeof shadesObj !== "object") continue;
      for (const [shadeName, hex] of Object.entries(shadesObj)) {
        out.push({
          name: String(shadeName),
          hex: String(hex),
          skintone,
          undertone,
        });
      }
    }
  }
  return out;
}

// ensure any object-y values become readable strings
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

// ---- handler ---------------------------------------------------------------

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const brand = searchParams.get("brand");
  const product = searchParams.get("product");
  if (!brand || !product) {
    return new Response(JSON.stringify({ error: "Missing brand or product" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // canonical base where shades.json lives
  const shadesBase = `brands/${brand}/product_shade_values/${product}`;

  // other known layouts for links/price/type
  const linksPaths = [
    `${shadesBase}/links.json`,                       // sometimes alongside shades
    `brands/${brand}/links/${product}/links.json`,    // your separate folder
  ];
  const pricePaths = [
    `${shadesBase}/price.json`,
    `brands/${brand}/price/${product}/price.json`,
  ];
  const typePaths = [
    `${shadesBase}/types.json`,
    `${shadesBase}/type.json`,
    `brands/${brand}/type/${product}/types.json`,
    `brands/${brand}/type/${product}/type.json`,
  ];

  // fetch files
  const shades = await getJSON(`${shadesBase}/shades.json`);
  const meta = await getJSON(`${shadesBase}/meta.json`);
  const { data: links, key: linksKey } = await firstExisting(linksPaths);
  const { data: price, key: priceKey } = await firstExisting(pricePaths);
  const { data: type,  key: typeKey  } = await firstExisting(typePaths);

  // merge into a single array of shade rows
  let combinedShades = [];

  if (Array.isArray(shades)) {
    // already array of shade objects
    combinedShades = shades.map((s) => ({
      name: s.name,
      hex: s.hex,
      skintone: normalizeTone(s.skintone),
      undertone: normalizeTone(s.undertone),
      link: links?.[s.name] || "",
      price: price?.[s.name] ?? "",
      type: type?.[s.name],
    }));
  } else if (isFoundationNested(shades)) {
    // your nested foundation format
    const flat = flattenFoundation(shades);
    combinedShades = flat.map((s) => ({
      ...s,
      link: links?.[s.name] || "",
      price: price?.[s.name] ?? "",
      type: type?.[s.name],
    }));
  } else if (shades && typeof shades === "object") {
    // simple map: { "ShadeName": "#hex" }
    combinedShades = Object.entries(shades).map(([name, hex]) => ({
      name,
      hex,
      skintone: "",
      undertone: "",
      link: links?.[name] || "",
      price: price?.[name] ?? "",
      type: type?.[name],
    }));
  } // else: no shades found
  // derive productType from `type` map or from per-shade entries
    let productType = "";
    if (type && typeof type === "object") {
    const vals = Object.values(type).filter(Boolean);
    if (vals.length) {
        // if all types are the same, use that; else first non-empty
        productType = vals.every((v) => v === vals[0]) ? String(vals[0]) : String(vals[0]);
    }
    }
    if (!productType && combinedShades.length) {
    const firstWithType = combinedShades.find((s) => !!s.type);
    if (firstWithType) productType = String(firstWithType.type);
    }

     // prefer meta.productType if present
    if (meta?.productType) productType = meta.productType;


    return new Response(
        JSON.stringify({
        brand,
        product,
        productType,
        meta: {
            hasLinks: !!links,
            hasPrice: !!price,
            hasType: !!type,
            matchedPaths: { linksKey, priceKey, typeKey },
            lastSavedBy: meta?.lastSavedBy || null,   // <—
            lastSavedAt: meta?.lastSavedAt || null,   // <—
        },
        shades: combinedShades,
        }),
        { headers: { "Content-Type": "application/json" } }
    );
      
}
