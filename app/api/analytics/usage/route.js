export const runtime = "nodejs";
export const maxDuration = 300;

import { cookies } from "next/headers";
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { rejectUnlessActionPassword } from "../../shade-capture/actionAuth";

// Usage metrics snapshot — permanent/analytics/usage_metrics.json
//   { generatedAt, users: [ { id, c: signupDay, p: subscriber, ps: premiumSinceDay, d: { "YYYY-MM-DD": { step: count } } } ] }
// Days are India time. Number users only (alphanumeric users' steps have no timestamps).
// The backend (app.py) keeps this file up to date: events are buffered in Redis ("{usage_metrics}:buffer")
// and merged in every ~120s; generatedAt = last update.
// GET  -> the snapshot (read by /analytics/usage, which computes every metric from it)
// POST { password } -> manual fallback only: full rescan of every user's steps_taken.json, user_info.json and
//   paid_data.json. Overwrites the file; steps logged while it runs may be double-counted in per-day step counts.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
  requestHandler: new NodeHttpHandler({ maxSockets: 200 }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const ROOT_PREFIX = "permanent/shopify/";
const SNAPSHOT_KEY = "permanent/analytics/usage_metrics.json";
const EXCLUDED_IDS = new Set(["7383231612", "7862917606"]); // test accounts (same as the daily graph)
const isNumericId = (id) => /^\d+$/.test(String(id));

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

async function listUserIds() {
  const ids = [];
  let ContinuationToken;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ROOT_PREFIX, Delimiter: "/", ContinuationToken }));
    (r.CommonPrefixes || []).forEach((p) => { const id = p.Prefix?.slice(ROOT_PREFIX.length, -1); if (id) ids.push(id); });
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return ids.filter((id) => isNumericId(id) && !EXCLUDED_IDS.has(id));
}

// ── steps parsing (same formats as the daily-graph backfill) ──
function parseTimestamp(t) {
  if (!t) return null;
  if (typeof t === "number") return t;
  t = String(t);
  if (!t.includes("/")) { const d = new Date(t); return isNaN(d.getTime()) ? null : d.getTime(); }
  try {
    const [datePart, timePart] = t.split(", ");
    const [dd, mm, yyyy] = datePart.split("/").map(Number);
    const [hh, min, ss] = (timePart || "0:0:0").split(":").map(Number);
    return Date.UTC(yyyy, mm - 1, dd, hh || 0, min || 0, ss || 0) - 5.5 * 3600 * 1000; // IST -> UTC
  } catch { return null; }
}
function parseStepLine(line) {
  if (!line) return null;
  if (typeof line === "object") return { step: String(line.step || line.name || "").trim(), at: parseTimestamp(line.at) };
  if (typeof line === "string") {
    if (!line.includes(":")) return { step: line.trim(), at: null };
    const i = line.indexOf(":");
    return { step: line.slice(0, i).trim(), at: parseTimestamp(line.slice(i + 1).trim()) };
  }
  return null;
}
function normalizeSteps(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(parseStepLine).filter((s) => s?.step);
  if (Array.isArray(raw.steps)) return raw.steps.map(parseStepLine).filter((s) => s?.step);
  if (typeof raw === "string") {
    let c = raw.trim();
    if (c.startsWith("[") && c.endsWith("]")) c = c.slice(1, -1);
    return c.split(/"\s*,\s*"/g).map((x) => x.replace(/^"/, "").replace(/"$/, "").trim()).filter(Boolean).map(parseStepLine).filter((s) => s?.step);
  }
  return [];
}
// "YYYY-MM-DD" in India time
const istDay = (ms) => {
  if (ms == null || isNaN(ms)) return null;
  const d = new Date(ms + 5.5 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

async function summariseUser(id) {
  const base = `${ROOT_PREFIX}${id}/`;
  const [rawSteps, info1, paid] = await Promise.all([
    getJSON(`${base}steps_taken.json`),
    getJSON(`${base}user_info.json`),
    getJSON(`${base}paid_data.json`),
  ]);
  const info = info1 || (await getJSON(`${base}user_info`)) || {};
  const created = info.createdAt != null ? istDay(typeof info.createdAt === "number" ? info.createdAt : Date.parse(String(info.createdAt))) : null;
  const subscriber = String(paid?.paid_data?.subscriber ?? "").toLowerCase() === "true";

  const d = {};
  let lastTs = null;
  let premiumSince = null;
  for (const s of normalizeSteps(rawSteps)) {
    const at = s.at ?? lastTs; // untimed steps belong to the last timed one (same as the graph)
    if (s.at) lastTs = s.at;
    const day = istDay(at) || created;
    if (!day) continue;
    const step = s.step.startsWith("funnel-quiz-") ? "funnel-quiz" : s.step;
    const dayMap = (d[day] ||= {});
    dayMap[step] = (dayMap[step] || 0) + 1;
    if (step === "bought-premium" && (!premiumSince || day < premiumSince)) premiumSince = day;
  }
  return { id, c: created, p: subscriber, ps: premiumSince, d };
}

export async function GET() {
  try {
    const snap = await getJSON(SNAPSHOT_KEY);
    if (!snap) return json({ exists: false, users: [] });
    return json({ exists: true, ...snap });
  } catch (e) {
    return json({ error: e?.message || "Failed to load usage metrics" }, 500);
  }
}

export async function POST(req) {
  try {
    const { password } = await req.json().catch(() => ({}));
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
    if ((await cookies()).get("th_auth")?.value !== "dhruvi") return json({ error: "Only dhruvi can rebuild metrics" }, 403);

    const ids = await listUserIds();
    const users = [];
    for (let i = 0; i < ids.length; i += 25) {
      const batch = await Promise.all(ids.slice(i, i + 25).map((id) => summariseUser(id).catch(() => null)));
      batch.forEach((u) => u && users.push(u));
    }
    const snap = { generatedAt: new Date().toISOString(), userCount: users.length, users };
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: SNAPSHOT_KEY, Body: JSON.stringify(snap), ContentType: "application/json" }));
    return json({ success: true, generatedAt: snap.generatedAt, userCount: users.length });
  } catch (e) {
    return json({ error: e?.message || "Rebuild failed" }, 500);
  }
}
