export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { isDhruvi } from "../../../lib/auth";

// Saved push-notification recipient list — so the Notification Center doesn't re-read every user each time.
//   permanent/analytics/notifications/recipients.json
//   { updatedAt, checked: { id: "YYYY-MM-DD" (day it was checked) }, recipients: { id: { name } } }
// recipients = users with a push_token.json. Tokens themselves aren't kept here: they're read fresh at send time.
// GET              -> { exists, updatedAt, recipients: [{ id, name }], checkedCount }
// POST { mode }    -> "new" (default): only checks user folders never checked before, adds the ones with a token
//                     "full": re-checks everyone (picks up users who turned notifications on later)
// Users whose folder no longer exists are dropped either way. dhruvi only.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
  requestHandler: new NodeHttpHandler({ maxSockets: 200 }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const ROOT_PREFIX = "permanent/shopify/";
const KEY = "permanent/analytics/notifications/recipients.json";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Missing file = empty list; any other read error throws, so a failed read is never saved over the real list
async function loadStore() {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
    const j = JSON.parse(await r.Body.transformToString());
    return { exists: true, updatedAt: j.updatedAt || null, checked: j.checked || {}, recipients: j.recipients || {} };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { exists: false, updatedAt: null, checked: {}, recipients: {} };
    throw e;
  }
}

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

// user folder names only (one listing with a delimiter, no per-user reads)
async function listUserIds() {
  const ids = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ROOT_PREFIX, Delimiter: "/", ContinuationToken }));
    for (const p of r.CommonPrefixes || []) { const id = p.Prefix.slice(ROOT_PREFIX.length, -1); if (id) ids.push(id); }
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return ids;
}

const tokenOf = (val) => {
  if (!val) return null;
  const t = typeof val === "string" ? val : val.token ?? val.push_token ?? val.fcmToken ?? val.deviceToken ?? null;
  return t ? String(t).trim() || null : null;
};

const view = (store) => ({
  exists: store.exists,
  updatedAt: store.updatedAt,
  checkedCount: Object.keys(store.checked).length,
  recipients: Object.entries(store.recipients).map(([id, r]) => ({ id, name: r?.name || "" })),
});

export async function GET() {
  if (!(await isDhruvi())) return json({ error: "Only dhruvi can use notifications" }, 403);
  try {
    return json(view(await loadStore()));
  } catch (e) {
    return json({ error: e?.message || "Couldn't read the recipient list" }, 500);
  }
}

export async function POST(req) {
  if (!(await isDhruvi())) return json({ error: "Only dhruvi can use notifications" }, 403);
  try {
    const { mode = "new" } = await req.json().catch(() => ({}));
    const store = await loadStore();
    const ids = await listUserIds();
    const present = new Set(ids);

    // drop deleted accounts
    for (const id of Object.keys(store.checked)) if (!present.has(id)) delete store.checked[id];
    for (const id of Object.keys(store.recipients)) if (!present.has(id)) delete store.recipients[id];

    const toCheck = mode === "full" ? ids : ids.filter((id) => !store.checked[id]);
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    let added = 0, removed = 0;
    for (let i = 0; i < toCheck.length; i += 50) {
      await Promise.all(toCheck.slice(i, i + 50).map(async (id) => {
        const token = tokenOf(await getJSON(`${ROOT_PREFIX}${id}/push_token.json`));
        store.checked[id] = today;
        if (!token) {
          if (store.recipients[id]) { delete store.recipients[id]; removed++; }
          return;
        }
        if (!store.recipients[id]) added++;
        const info = (await getJSON(`${ROOT_PREFIX}${id}/user_info.json`)) || (await getJSON(`${ROOT_PREFIX}${id}/user_info`)) || {};
        store.recipients[id] = { name: (typeof info === "object" && info?.name) ? String(info.name) : "" };
      }));
    }

    store.updatedAt = new Date().toISOString();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: KEY, ContentType: "application/json",
      Body: JSON.stringify({ updatedAt: store.updatedAt, checked: store.checked, recipients: store.recipients }),
    }));
    return json({ ...view({ ...store, exists: true }), checkedNow: toCheck.length, added, removed });
  } catch (e) {
    return json({ error: e?.message || "Couldn't update the recipient list" }, 500);
  }
}
