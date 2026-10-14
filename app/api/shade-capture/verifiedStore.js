// "Verified" products per market, kept next to the live catalogue:
//   verified.json / verified-usa.json  =  { brand: { product: { by, at } } }
// Before the file exists, every live product (in all-data.json / all-data-usa.json) counts as verified.
// The first write creates the file from that live list, so products made live afterwards start unverified.
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

export const ALL_DATA_KEYS = { india: "all-data.json", usa: "all-data-usa.json" };
export const VERIFIED_KEYS = { india: "verified.json", usa: "verified-usa.json" };

export async function readJSONWithEtag(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    return { data: JSON.parse(await r.Body.transformToString()) || {}, etag: r.ETag, exists: true };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { data: {}, etag: null, exists: false };
    throw e;
  }
}

// { brand: [{ product: type }] } -> { brand: { product: { by, at } } }
function verifiedFromLive(allData) {
  const at = new Date().toISOString();
  const out = {};
  for (const [brand, arr] of Object.entries(allData || {})) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      for (const product of Object.keys(entry || {})) {
        (out[brand] ||= {})[product] = { by: "live-before-verification", at };
      }
    }
  }
  return out;
}

// Current verified map. `exists: false` means it's derived from the live catalogue (file not created yet).
export async function readVerified(market) {
  const v = await readJSONWithEtag(VERIFIED_KEYS[market]);
  if (v.exists) return { verified: v.data, exists: true };
  const live = await readJSONWithEtag(ALL_DATA_KEYS[market]);
  return { verified: verifiedFromLive(live.data), exists: false };
}

// Create the verified file from today's live list if it doesn't exist yet (no-op otherwise).
export async function ensureVerifiedFile(market) {
  const Key = VERIFIED_KEYS[market];
  const v = await readJSONWithEtag(Key);
  if (v.exists) return;
  const live = await readJSONWithEtag(ALL_DATA_KEYS[market]);
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key, Body: JSON.stringify(verifiedFromLive(live.data), null, 2),
      ContentType: "application/json", IfNoneMatch: "*",
    }));
  } catch (e) {
    const code = e?.$metadata?.httpStatusCode;
    if (code !== 412 && code !== 409) throw e; // someone else created it first — fine
  }
}

// Mark / unmark one product, with an ETag check so concurrent changes aren't lost.
export async function setVerified(market, brand, product, verified, user) {
  await ensureVerifiedFile(market);
  const Key = VERIFIED_KEYS[market];
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, etag } = await readJSONWithEtag(Key);
    const has = !!data[brand]?.[product];
    if (has === verified) return { changed: false, entry: data[brand]?.[product] || null };
    let entry = null;
    if (verified) {
      entry = { by: user || "unknown", at: new Date().toISOString() };
      (data[brand] ||= {})[product] = entry;
    } else {
      delete data[brand][product];
      if (!Object.keys(data[brand]).length) delete data[brand];
    }
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key, Body: JSON.stringify(data, null, 2), ContentType: "application/json", IfMatch: etag,
      }));
      return { changed: true, entry };
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 412 || code === 409) continue;
      throw e;
    }
  }
  throw new Error("The verified list was changed by someone else at the same time — please try again.");
}
