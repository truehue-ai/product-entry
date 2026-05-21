export const runtime = "nodejs";

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({ maxSockets: 200 }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const ROOT_PREFIX = "permanent/shopify/";
const BACKEND_URL = "https://api.th-fargate.in"; // e.g. https://api.truehue.in

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function listUserIds() {
  let ContinuationToken;
  const ids = new Set();
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ROOT_PREFIX, ContinuationToken })
    );
    (resp.Contents || []).forEach((o) => {
      const m = o?.Key?.match(/^permanent\/shopify\/([^/]+)\//);
      if (m) ids.add(m[1]);
    });
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return Array.from(ids);
}

export async function POST() {
  try {
    const ids = await listUserIds();
    //const ids = ["7383231612"];

    // Read paid_data.json for all users in batches of 25
    const eligible = [];
    for (let i = 0; i < ids.length; i += 25) {
      const batch = ids.slice(i, i + 25);
      await Promise.all(
        batch.map(async (uid) => {
          const paidData = await getJSON(`${ROOT_PREFIX}${uid}/paid_data.json`);
          const pd = paidData?.paid_data ?? {};
          const coins = typeof pd.coins === "number" ? pd.coins : Number(pd.coins ?? 0);
          const isSubscriber = String(pd.subscriber ?? "").toLowerCase() === "true" || pd.subscriber === true;

          if (coins > 2 && !isSubscriber) {
            eligible.push(uid);
          }
        })
      );
    }

    // Grant premium to each eligible user
    const results = { granted: [], failed: [] };
    for (let i = 0; i < eligible.length; i += 10) {
      const batch = eligible.slice(i, i + 10);
      await Promise.all(
        batch.map(async (uid) => {
          try {
            const purchaseId = `bulk-grant-${uid}-${Date.now()}`;
            console.log(`Calling ${BACKEND_URL}/give_premium_access for ${uid}`);
            const resp = await fetch(`${BACKEND_URL}/give_premium_access`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ number: uid, purchaseId }),
            });
            if (resp.ok) {
              results.granted.push(uid);
            } else {
              const err = await resp.text();
            console.error(`grant-premium failed for ${uid}:`, resp.status, err);
            results.failed.push({ uid, error: `${resp.status}: ${err}` });
            }
          } catch (e) {
            results.failed.push({ uid, error: e.message });
          }
        })
      );
    }

    return new Response(
      JSON.stringify({ ok: true, eligible: eligible.length, ...results, failedDetails: results.failed }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}