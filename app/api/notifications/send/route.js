export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { isDhruvi } from "../../../lib/auth";

// Batch push notifications (dhruvi only).
// POST { messages: [{ number, title, body }], data?, campaign? }   (up to 1000 per call; the page sends in chunks)
// campaign = { id, title, body, tab?, article_id? } -> data.campaign_id is added to every push (so the app can
// report the open with /mark_step step "notif_open:<id>"), and who it was sent to is logged in
//   permanent/analytics/notifications/campaigns/<id>.json  { id, title, body, data, createdAt, lastSentAt, sent: [ids], failed }
// Each user's Expo token is read fresh from permanent/shopify/<number>/push_token.json (same file the backend uses),
// then sent to Expo 100 per request — Expo's limit — instead of one request per user.
// EXPO_ACCESS_TOKEN is sent if set (only needed when "enhanced push security" is on in Expo).
// -> { results: [{ id, status: "sent" | "failed", detail }] }

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
  requestHandler: new NodeHttpHandler({ maxSockets: 200 }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const EXPO_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH = 100;
const MAX_PER_CALL = 1000;
const isExpoToken = (t) => /^Expo(nent)?PushToken\[.+\]$/.test(t);
const CAMPAIGN_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const campaignKey = (id) => `permanent/analytics/notifications/campaigns/${id}.json`;

// add this chunk's sent ids to the campaign log (the page sends chunks one after another, so no overlap)
async function logCampaign(campaign, data, results) {
  const Key = campaignKey(campaign.id);
  let rec = null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    rec = JSON.parse(await r.Body.transformToString());
  } catch (e) {
    if (!(e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404)) throw e; // never overwrite a log we couldn't read
  }
  const now = new Date().toISOString();
  rec = rec || { id: campaign.id, createdAt: now, sent: [], failed: 0 };
  rec.title = String(campaign.title || rec.title || "").slice(0, 120);
  rec.body = String(campaign.body || rec.body || "").slice(0, 400);
  rec.data = data;
  rec.lastSentAt = now;
  const sent = new Set(rec.sent || []);
  let failed = 0;
  for (const [id, r] of results) { if (r.status === "sent") sent.add(id); else failed++; }
  rec.sent = [...sent];
  rec.failed = (rec.failed || 0) + failed;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, ContentType: "application/json", Body: JSON.stringify(rec) }));
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function readToken(number) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `permanent/shopify/${number}/push_token.json` }));
    const text = await r.Body.transformToString();
    let val; try { val = JSON.parse(text); } catch { val = text; }
    const t = typeof val === "string" ? val : val?.token ?? val?.push_token ?? null;
    return t ? String(t).trim() : null;
  } catch {
    return null;
  }
}

export async function POST(req) {
  if (!(await isDhruvi())) return json({ error: "Only dhruvi can send notifications" }, 403);
  const payload = await req.json().catch(() => null);
  const messages = Array.isArray(payload?.messages) ? payload.messages : null;
  if (!messages?.length) return json({ error: "No messages" }, 400);
  if (messages.length > MAX_PER_CALL) return json({ error: `Send at most ${MAX_PER_CALL} per request` }, 400);
  const campaign = payload.campaign && typeof payload.campaign === "object" ? payload.campaign : null;
  if (campaign && !CAMPAIGN_ID.test(String(campaign.id || ""))) return json({ error: "Invalid campaign id (lowercase letters, numbers, dashes)" }, 400);
  const data = { ...(payload.data && typeof payload.data === "object" ? payload.data : {}) };
  if (campaign) {
    data.campaign_id = campaign.id;
    if (campaign.article_id) data.article_id = String(campaign.article_id);
  }

  const results = new Map(); // id -> { status, detail }
  const ready = [];          // [{ id, message }]

  // 1) validate + read tokens (50 at a time)
  for (let i = 0; i < messages.length; i += 50) {
    await Promise.all(messages.slice(i, i + 50).map(async (m) => {
      const id = String(m?.number || "").trim();
      const title = String(m?.title || "").trim().slice(0, 120);
      const body = String(m?.body || "").trim().slice(0, 400);
      if (!/^\d{6,15}$/.test(id)) { results.set(id || "?", { status: "failed", detail: "Invalid number" }); return; }
      if (!title || !body) { results.set(id, { status: "failed", detail: "Missing title or message" }); return; }
      const token = await readToken(id);
      if (!token) { results.set(id, { status: "failed", detail: "No push token" }); return; }
      if (!isExpoToken(token)) { results.set(id, { status: "failed", detail: "Not an Expo push token" }); return; }
      ready.push({ id, message: { to: token, title, body, data, sound: "default" } });
    }));
  }

  // 2) send to Expo, 100 per request
  const headers = { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  for (let i = 0; i < ready.length; i += EXPO_BATCH) {
    const batch = ready.slice(i, i + EXPO_BATCH);
    try {
      const r = await fetch(EXPO_URL, { method: "POST", headers, body: JSON.stringify(batch.map((b) => b.message)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.data)) {
        const why = j?.errors?.[0]?.message || `Expo returned ${r.status}`;
        batch.forEach((b) => results.set(b.id, { status: "failed", detail: why }));
        continue;
      }
      // one ticket per message, same order
      batch.forEach((b, k) => {
        const t = j.data[k] || {};
        results.set(b.id, t.status === "ok"
          ? { status: "sent", detail: "" }
          : { status: "failed", detail: t.details?.error || t.message || "Expo error" });
      });
    } catch (e) {
      batch.forEach((b) => results.set(b.id, { status: "failed", detail: e?.message || "Network error" }));
    }
  }

  let logError = null;
  if (campaign) {
    try { await logCampaign(campaign, data, results); } catch (e) { logError = e?.message || "Couldn't save the campaign log"; }
  }
  return json({ results: [...results].map(([id, r]) => ({ id, ...r })), logError });
}
