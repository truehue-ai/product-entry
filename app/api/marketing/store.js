import "server-only";

// Marketing Organiser data — three JSON files in the app's S3 bucket:
//   permanent/marketing/config.json   categories, requirements, concepts, weekly template, date offsets, series, ad quota
//   permanent/marketing/items.json    { organic: [...], ads: [...] }
//   permanent/marketing/inspo.json    [ saved Instagram reels / posts ]
// A missing file reads as its default; the first write creates it. Every write is read → change → write with an
// ETag check (retried), so two tabs saving at once don't overwrite each other.
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentials, awsRegion } from "../meta-ads/aws";
import { seedConfig } from "../../marketing/lib";

const s3 = new S3Client({ region: awsRegion, credentials: awsCredentials });
const BUCKET = process.env.X_AWS_BUCKET_NAME;

export const KEYS = {
  config: "permanent/marketing/config.json",
  items: "permanent/marketing/items.json",
  inspo: "permanent/marketing/inspo.json",
};
const DEFAULTS = { config: seedConfig, items: () => ({ organic: [], ads: [] }), inspo: () => [] };

export async function read(name) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEYS[name] }));
    const data = JSON.parse(await r.Body.transformToString());
    return { data: data ?? DEFAULTS[name](), etag: r.ETag };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { data: DEFAULTS[name](), etag: null };
    throw e;
  }
}

export async function readAll() {
  const [config, items, inspo] = await Promise.all([read("config"), read("items"), read("inspo")]);
  return { config: config.data, items: items.data, inspo: inspo.data };
}

export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// change(data) edits `data` in place or returns a new value; throw StoreError to refuse the change
export async function update(name, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await read(name);
    const next = (await change(data)) ?? data;
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: KEYS[name], Body: JSON.stringify(next), ContentType: "application/json",
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      }));
      return next;
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 412 || code === 409) continue; // someone saved in between — redo on their version
      throw e;
    }
  }
  throw new StoreError("Someone else saved at the same time — please try again.", 409);
}
