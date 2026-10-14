// Who saved what, per day — activity/activity.json:
//   { users: { <user>: { "YYYY-MM-DD": [ { market, brand, product, productType, shades, isNew, at } ] } },
//     holidays: { <user>: { "YYYY-MM-DD": { by, at } } }, updatedAt }
// One entry per save (a product saved twice in a day has two entries; the activity page shows it once).
// Days are India time (IST). Written with an ETag check so two saves at once don't overwrite each other.
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;
export const ACTIVITY_KEY = "activity/activity.json";
const AUDIT_ROOTS = { india: "audit/daily/", usa: "audit_usa/daily/" };

// "YYYY-MM-DD" in India time
export function istDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function readJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    return { data: JSON.parse(await r.Body.transformToString()), etag: r.ETag, exists: true };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { data: null, etag: null, exists: false };
    throw e;
  }
}

export async function readActivity() {
  const { data } = await readJSON(ACTIVITY_KEY);
  return data && typeof data === "object" ? data : { users: {} };
}

async function writeActivity(change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag, exists } = await readJSON(ACTIVITY_KEY);
    const current = data && typeof data === "object" ? data : { users: {} };
    const next = change(current);
    next.updatedAt = new Date().toISOString();
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: ACTIVITY_KEY, Body: JSON.stringify(next, null, 2), ContentType: "application/json",
        ...(exists ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      }));
      return next;
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 412 || code === 409) continue;
      throw e;
    }
  }
  throw new Error("activity.json was changed by someone else at the same time");
}

// Called after a successful Shade Capture save.
export async function recordSave({ user, market, brand, product, productType, shades, isNew, at = new Date() }) {
  if (!user || !brand || !product) return;
  const day = istDay(at);
  await writeActivity((data) => {
    data.users ||= {};
    const days = (data.users[user] ||= {});
    (days[day] ||= []).push({ market, brand, product, productType: productType || "", shades: shades || 0, isNew: !!isNew, at: at.toISOString() });
    return data;
  });
}

// Mark / unmark a day as a holiday for a user (left out of averages on the activity page).
export async function setHoliday(user, day, holiday, by) {
  if (!user || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Bad user or day");
  const next = await writeActivity((data) => {
    data.holidays ||= {};
    const h = (data.holidays[user] ||= {});
    if (holiday) h[day] = { by: by || "unknown", at: new Date().toISOString() };
    else delete h[day];
    return data;
  });
  return next.holidays?.[user] || {};
}

async function listKeys(Prefix) {
  const keys = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, ContinuationToken }));
    (r.Contents || []).forEach((o) => o.Key && keys.push(o.Key));
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

// Rebuild one user's activity from the existing daily audit logs (India + USA).
// The first time a product appears in the logs counts as its add; later saves are updates.
export async function rebuildFromAudit(user) {
  const entries = [];
  for (const [market, root] of Object.entries(AUDIT_ROOTS)) {
    const keys = (await listKeys(root)).filter((k) => k.endsWith(`/${user}.json`));
    for (let i = 0; i < keys.length; i += 16) {
      const batch = await Promise.all(keys.slice(i, i + 16).map((k) => readJSON(k).then((r) => r.data).catch(() => null)));
      batch.forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((e) => {
          if (!e?.brand || !e?.product) return;
          entries.push({
            market, brand: e.brand, product: e.product, productType: e.productType || "",
            shades: Array.isArray(e.added) ? e.added.length : 0, at: e.at || null,
          });
        });
      });
    }
  }
  entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const seen = new Set();
  const days = {};
  for (const e of entries) {
    const k = `${e.market}:::${e.brand}:::${e.product}`;
    const isNew = !seen.has(k);
    seen.add(k);
    const day = e.at ? istDay(new Date(e.at)) : "unknown";
    (days[day] ||= []).push({ ...e, isNew });
  }
  await writeActivity((data) => {
    data.users ||= {};
    data.users[user] = days;
    return data;
  });
  return { saves: entries.length, products: seen.size, days: Object.keys(days).length };
}
