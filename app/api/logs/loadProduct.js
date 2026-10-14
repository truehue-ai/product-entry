// Shared loader for product-entry logs (used by /api/logs/get and /api/logs/brand).
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

// ---- helpers ---------------------------------------------------------------

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch (e) {
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

// ---- loader ----------------------------------------------------------------

export async function loadProduct({ brand, product, usa = false }) {
  const brandsRoot = usa ? "brands_usa" : "brands";

  // canonical base where shades.json lives
  const shadesBase = `${brandsRoot}/${brand}/product_shade_values/${product}`;

  // other known layouts for links/price/type
  const linksPaths = [
    `${shadesBase}/links.json`,
    `${brandsRoot}/${brand}/links/${product}/links.json`,
  ];
  const pricePaths = [
    `${shadesBase}/price.json`,
    `${brandsRoot}/${brand}/price/${product}/price.json`,
  ];
  const typePaths = [
    `${shadesBase}/types.json`,
    `${shadesBase}/type.json`,
    `${brandsRoot}/${brand}/type/${product}/types.json`,
    `${brandsRoot}/${brand}/type/${product}/type.json`,
  ];

  const [shades, meta, linksRes, priceRes, typeRes] = await Promise.all([
    getJSON(`${shadesBase}/shades.json`),
    getJSON(`${shadesBase}/meta.json`),
    firstExisting(linksPaths),
    firstExisting(pricePaths),
    firstExisting(typePaths),
  ]);
  const { data: links, key: linksKey } = linksRes;
  const { data: price, key: priceKey } = priceRes;
  const { data: type, key: typeKey } = typeRes;

  // merge into a single array of shade rows
  let combinedShades = [];

  if (Array.isArray(shades)) {
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
    combinedShades = flattenFoundation(shades).map((s) => ({
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
  }

  // derive productType: meta.productType > type map > per-shade entries
  let productType = "";
  if (type && typeof type === "object") {
    const vals = Object.values(type).filter(Boolean);
    if (vals.length) productType = String(vals[0]);
  }
  if (!productType && combinedShades.length) {
    const firstWithType = combinedShades.find((s) => !!s.type);
    if (firstWithType) productType = String(firstWithType.type);
  }
  if (meta?.productType) productType = meta.productType;

  return {
    brand,
    product,
    productType,
    meta: {
      hasLinks: !!links,
      hasPrice: !!price,
      hasType: !!type,
      matchedPaths: { linksKey, priceKey, typeKey },
      lastSavedBy: meta?.lastSavedBy || null,
      lastSavedAt: meta?.lastSavedAt || null,
    },
    shades: combinedShades,
  };
}
