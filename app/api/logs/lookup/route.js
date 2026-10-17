export const runtime = "nodejs";

import { S3Client, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

// Cheap S3 lookups for one market (no full catalogue scan):
//   GET ?usa=1&brand=B&product=P  -> { found: { brand, product } | null }   is <root>/B/product_shade_values/P/shades.json there?
//   GET ?usa=1&brand=B            -> { brand, products: [...] }             product folders of one brand
//   GET ?usa=1&brands=1           -> { brands: [...] }                      top-level brand folders
// Names are matched exactly first, then ignoring case/spaces/punctuation.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function listFolders(Prefix) {
  const out = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, Delimiter: "/", ContinuationToken }));
    (r.CommonPrefixes || []).forEach((p) => p.Prefix && out.push(p.Prefix.slice(Prefix.length, -1)));
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out.filter(Boolean);
}

async function hasShades(root, brand, product) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `${root}/${brand}/product_shade_values/${product}/shades.json` }));
    return true;
  } catch {
    return false;
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const root = searchParams.get("usa") === "1" ? "brands_usa" : "brands";
    const brand = searchParams.get("brand") || "";
    const product = searchParams.get("product") || "";

    if (searchParams.get("brands")) {
      const brands = await listFolders(`${root}/`);
      return json({ brands: brands.sort((a, b) => a.trim().localeCompare(b.trim())) });
    }
    if (!brand) return json({ error: "Missing brand" }, 400);

    // brand folder: exact, else by normalised name
    const resolveBrand = async () => {
      const folders = await listFolders(`${root}/${brand}/product_shade_values/`);
      if (folders.length) return { brandFolder: brand, products: folders };
      const all = await listFolders(`${root}/`);
      const match = all.find((b) => norm(b) === norm(brand));
      return match ? { brandFolder: match, products: await listFolders(`${root}/${match}/product_shade_values/`) } : { brandFolder: null, products: [] };
    };

    if (!product) {
      const { brandFolder, products } = await resolveBrand();
      return json({ brand: brandFolder, products: products.sort((a, b) => a.localeCompare(b)) });
    }

    // exact product first (one HEAD request)
    if (await hasShades(root, brand, product)) return json({ found: { brand, product } });
    // then the same name ignoring case/spacing, within the brand
    const { brandFolder, products } = await resolveBrand();
    const match = brandFolder && products.find((p) => norm(p) === norm(product));
    if (match && (await hasShades(root, brandFolder, match))) return json({ found: { brand: brandFolder, product: match } });
    return json({ found: null, brand: brandFolder });
  } catch (e) {
    return json({ error: e?.message || "Lookup failed" }, 500);
  }
}
