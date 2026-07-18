export const runtime = "nodejs";

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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
const PURCHASE_KEY = "purchase/buyer_data.json";
const PREMIUM_CUTOFF_MS = new Date("2026-06-15T00:00:00.000Z").getTime();

/* ── S3 helpers ── */

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function putJSON(Key, data) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  }));
}

async function listUserIds() {
  let ContinuationToken;
  const ids = new Set();
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ROOT_PREFIX, ContinuationToken })
    );
    for (const o of resp.Contents || []) {
      const m = o?.Key?.match(/^permanent\/shopify\/([^/]+)\//);
      if (m) ids.add(m[1]);
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return Array.from(ids);
}

function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    if (typeof row !== "string") return null;
    const idx = row.indexOf(":");
    // no colon = step with no timestamp (e.g. "bought-coins", "model-fine-tune")
    if (idx === -1) return { step: row.trim(), at: null };
    const step = row.substring(0, idx).trim();
    const timeStr = row.substring(idx + 1).trim();
    const [datePart, timePart] = timeStr.split(", ");
    if (!datePart || !timePart) return { step, at: null };
    const [dd, mm, yyyy] = datePart.split("/").map(Number);
    const [hh, min, ss] = timePart.split(":").map(Number);
    const at = new Date(yyyy, mm - 1, dd, hh, min, ss).getTime();
    return { step, at };
  }).filter(Boolean);
}

/* ── GET: read purchase_data.json from S3 ── */

export async function GET() {
  const data = await getJSON(PURCHASE_KEY);
  if (!data) {
    return new Response(
      JSON.stringify({ exists: false, message: "No purchase_data.json found. Run a scan first." }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response(
    JSON.stringify({ exists: true, ...data }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}

/* ── POST: scan all users, build buyer list, save to S3 ── */

export async function POST() {
  try {
    const ids = await listUserIds();

    const BATCH_SIZE = 25;
    const boughtCoins = [];    // { id, count, firstAt }
    const boughtPremium = [];  // { id, firstAt }

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (id) => {
        const raw = await getJSON(`${ROOT_PREFIX}${id}/steps_taken.json`);
        const steps = normalizeSteps(raw);

        let coinCount = 0;
        let firstCoinAt = null;
        let premiumAt = null;

        let lastLoginAt = null;
        for (const s of steps) {
          if (s.step === "login" && s.at) lastLoginAt = s.at;

          if (s.step === "bought-coins") {
            coinCount++;
            const ts = s.at ?? lastLoginAt;
            if (ts && (firstCoinAt === null || ts < firstCoinAt)) firstCoinAt = ts;
          }

          if (s.step === "bought-premium") {
            const stepMs = s.at ?? lastLoginAt ?? 0;
            if (stepMs >= PREMIUM_CUTOFF_MS) {
              if (premiumAt === null || stepMs < premiumAt) premiumAt = stepMs;
            }
          }
        }

        if (coinCount > 0) boughtCoins.push({ id, count: coinCount, firstAt: firstCoinAt });
        if (premiumAt !== null) boughtPremium.push({ id, firstAt: premiumAt });
      }));
    }

    // sort by firstAt descending (most recent first)
    boughtCoins.sort((a, b) => (b.firstAt ?? 0) - (a.firstAt ?? 0));
    boughtPremium.sort((a, b) => (b.firstAt ?? 0) - (a.firstAt ?? 0));

    const combinedSet = new Set([
      ...boughtCoins.map(u => u.id),
      ...boughtPremium.map(u => u.id),
    ]);

    const payload = {
      generatedAt: Date.now(),
      boughtCoins,
      boughtPremium,
      combined: Array.from(combinedSet),
    };

    await putJSON(PURCHASE_KEY, payload);

    return new Response(
      JSON.stringify({ ok: true, ...payload }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Scan failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}