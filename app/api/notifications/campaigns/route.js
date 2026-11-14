export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { isDhruvi } from "../../../lib/auth";

// Notification campaigns + open tracking (dhruvi only, read-only).
// Each push sent with a campaign carries data.campaign_id. When a user taps it, the app calls the backend's
// /mark_step with step "notif_open:<campaign_id>", which lands in permanent/shopify/<number>/steps_taken.json.
// GET               -> { campaigns: [{ id, title, body, createdAt, lastSentAt, sent, failed }] }  (newest first)
// GET ?id=<id>      -> { id, sent, opened, rate, openedIds }  (reads steps_taken.json of everyone it was sent to)

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
  requestHandler: new NodeHttpHandler({ maxSockets: 200 }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const PREFIX = "permanent/analytics/notifications/campaigns/";
const CAMPAIGN_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    return JSON.parse(await r.Body.transformToString());
  } catch {
    return null;
  }
}

export async function GET(req) {
  if (!(await isDhruvi())) return json({ error: "Only dhruvi can use notifications" }, 403);
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (!id) {
      const keys = [];
      let ContinuationToken;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken }));
        for (const o of r.Contents || []) if (o.Key.endsWith(".json")) keys.push(o.Key);
        ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (ContinuationToken);
      const recs = (await Promise.all(keys.map(getJSON))).filter(Boolean);
      const campaigns = recs
        .map((c) => ({ id: c.id, title: c.title, body: c.body, createdAt: c.createdAt, lastSentAt: c.lastSentAt, sent: (c.sent || []).length, failed: c.failed || 0 }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json({ campaigns });
    }

    if (!CAMPAIGN_ID.test(id)) return json({ error: "Invalid campaign id" }, 400);
    const rec = await getJSON(`${PREFIX}${id}.json`);
    if (!rec) return json({ error: "Campaign not found" }, 404);
    const step = `notif_open:${id}`;
    const sent = rec.sent || [];
    const openedIds = [];
    for (let i = 0; i < sent.length; i += 50) {
      await Promise.all(sent.slice(i, i + 50).map(async (n) => {
        const steps = await getJSON(`permanent/shopify/${n}/steps_taken.json`);
        if (Array.isArray(steps) && steps.some((s) => String(s).trim() === step)) openedIds.push(n);
      }));
    }
    return json({ id, sent: sent.length, opened: openedIds.length, rate: sent.length ? openedIds.length / sent.length : 0, openedIds });
  } catch (e) {
    return json({ error: e?.message || "Couldn't read campaigns" }, 500);
  }
}
