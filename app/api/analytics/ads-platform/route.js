export const runtime = "nodejs";
export const maxDuration = 300;

import { getSessionUser, canViewAdsPlatform } from "../../../lib/auth";
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { rejectUnlessActionPassword } from "../../shade-capture/actionAuth";
import { MEANINGFUL_STEPS, SEARCH_SOURCES, SESSION_STEP } from "../../../lib/adsPlatformGoals";
import { computeAdsPlatformMetrics } from "../../../lib/adsPlatformMetrics";

// Ads Platform Metrics (view: dhruvi and jagat; rebuild: dhruvi only) — snapshot at permanent/analytics/ads_platform_metrics.json (shape in
// app/lib/adsPlatformMetrics.js). The backend (app.py, "ADS PLATFORM METRICS") keeps it up to date live: events
// are buffered in Redis ("{ads_platform}:buffer") and merged in every ~2 min. Nothing else in S3 is changed.
// GET  -> the metrics, computed from the snapshot (as of today, India time)
// POST { password } -> one-time seed / manual fallback — rebuild the snapshot from scratch: reads every number user's steps_taken.json, user_info.json and
//   premium/timestamp.json (paid member = createdAt on/after the start date + {"type":"lifetime"}), and sums
//   Product Analytics searches and retailer click-outs per day from permanent/analytics/product-search/*.json
//   (the files behind the Product Analytics page). Takes a few minutes.

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
  requestHandler: new NodeHttpHandler({ maxSockets: 200 }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const ROOT_PREFIX = "permanent/shopify/";
const SNAPSHOT_KEY = "permanent/analytics/ads_platform_metrics.json";
const PRODUCT_SEARCH_PREFIX = "permanent/analytics/product-search/"; // one file per brand
const EXCLUDED_IDS = new Set(["7383231612", "7862917606"]); // test accounts (same as the other metrics)
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

// ── steps parsing (same formats as the usage metrics) ──
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
const istDay = (ms) => {
  if (ms == null || isNaN(ms)) return null;
  const d = new Date(ms + 5.5 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

// null = no pass and never engaged (not needed for any metric)
async function summariseUser(id) {
  const base = `${ROOT_PREFIX}${id}/`;
  const [rawSteps, info1, ts] = await Promise.all([
    getJSON(`${base}steps_taken.json`), getJSON(`${base}user_info.json`), getJSON(`${base}premium/timestamp.json`),
  ]);
  const pass = ts?.type != null && String(ts.type).trim() ? String(ts.type).trim().toLowerCase() : null;

  const engaged = new Set();
  const active = new Set();
  const sessions = {}; // day -> "session-start" steps (only once the app sends them)
  let lastTs = null;
  for (const s of normalizeSteps(rawSteps)) {
    const day = istDay(s.at ?? lastTs); // untimed steps belong to the last timed one; none before it = no date
    if (s.at) lastTs = s.at;
    if (!day) continue;
    active.add(day);
    if (MEANINGFUL_STEPS[s.step]) engaged.add(day);
    if (s.step === SESSION_STEP) sessions[day] = (sessions[day] || 0) + 1;
  }
  if (!pass && !active.size) return null;

  const info = info1 || (await getJSON(`${base}user_info`)) || {};
  const created = info.createdAt != null ? (typeof info.createdAt === "number" ? info.createdAt : Date.parse(String(info.createdAt))) : null;
  return {
    id, c: istDay(created), pass,
    skin: info.skin_tone ?? info.skinTone ?? "", under: info.undertone ?? "",
    e: [...engaged].sort(),
    a: [...active].sort(), // any-step days, for the "opened the app" M1 reference
    ...(Object.keys(sessions).length ? { ns: sessions } : {}),
  };
}

// Product Analytics per day, summed over every brand, product and time-of-day section:
//   byDay = searches (SEARCH_SOURCES), clickOutsByDay = retailer redirects ("views", every source),
//   clickers = { userId: Set(days they clicked out) } from view_users (number users only)
async function productSearchByDay() {
  try {
    const keys = [];
    let ContinuationToken;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PRODUCT_SEARCH_PREFIX, ContinuationToken }));
      (r.Contents || []).forEach((o) => { if (o.Key?.endsWith(".json")) keys.push(o.Key); });
      ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (ContinuationToken);

    const byDay = {};
    const clickOutsByDay = {};
    const clickers = {};
    const failedBrands = [];
    for (let i = 0; i < keys.length; i += 10) {
      await Promise.all(keys.slice(i, i + 10).map(async (Key) => {
        const data = await getJSON(Key);
        if (!data) { failedBrands.push(Key.slice(PRODUCT_SEARCH_PREFIX.length, -5)); return; }
        for (const product of Object.values(data.products || {})) {
          for (const [day, sections] of Object.entries(product?.days || {})) {
            for (const section of Object.values(sections || {})) {
              for (const [src, bucket] of Object.entries(section || {})) {
                const searches = SEARCH_SOURCES.includes(src) ? Number(bucket?.searches) || 0 : 0;
                const views = Number(bucket?.views) || 0;
                if (searches) byDay[day] = (byDay[day] || 0) + searches;
                if (views) clickOutsByDay[day] = (clickOutsByDay[day] || 0) + views;
                for (const v of bucket?.view_users || []) {
                  const id = String(v ?? "").trim();
                  if (isNumericId(id) && !EXCLUDED_IDS.has(id)) (clickers[id] ||= new Set()).add(day);
                }
              }
            }
          }
        }
      }));
    }
    return { byDay, clickOutsByDay, clickers, brands: keys.length, failedBrands };
  } catch (e) {
    return { error: e?.message || "Couldn't read Product Analytics" };
  }
}

export async function GET() {
  try {
    if (!(await canViewAdsPlatform())) return json({ error: "You don't have access to Ads Platform Metrics" }, 403);
    const snap = await getJSON(SNAPSHOT_KEY);
    if (!snap) return json({ exists: false });
    return json({ exists: true, generatedAt: snap.generatedAt, ...computeAdsPlatformMetrics(snap, istDay(Date.now())) });
  } catch (e) {
    return json({ error: e?.message || "Failed to load metrics" }, 500);
  }
}

export async function POST(req) {
  try {
    const { password } = await req.json().catch(() => ({}));
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
    if ((await getSessionUser()) !== "dhruvi") return json({ error: "Only dhruvi can rebuild these metrics" }, 403);

    const scanUsers = async () => {
      const ids = await listUserIds();
      const users = [];
      for (let i = 0; i < ids.length; i += 25) {
        const batch = await Promise.all(ids.slice(i, i + 25).map((id) => summariseUser(id).catch(() => null)));
        batch.forEach((u) => u && users.push(u));
      }
      return { ids, users };
    };
    const [{ ids, users }, { clickers, ...searches }] = await Promise.all([scanUsers(), productSearchByDay()]);
    // days each user clicked out to a retailer (only users already in the snapshot — anyone else was never active)
    if (clickers) {
      for (const u of users) if (clickers[u.id]) u.k = [...clickers[u.id]].sort();
      searches.hasClickers = true;
    }

    // Per-user searches (sr) and click-out sessions (nq) are only recorded by the live updates (the files
    // don't say who searched how often) — keep them from the current snapshot. Sessions (ns) come from the steps.
    const prev = await getJSON(SNAPSHOT_KEY);
    const prevById = new Map((prev?.users || []).map((u) => [String(u.id), u]));
    for (const u of users) {
      const p = prevById.get(u.id);
      if (p?.sr) u.sr = p.sr;
      if (p?.nq) u.nq = p.nq;
    }
    const perUserSince = { ...(prev?.perUserSince || {}) };
    const firstSession = users.flatMap((u) => Object.keys(u.ns || {})).sort()[0];
    if (firstSession && (!perUserSince.sessions || firstSession < perUserSince.sessions)) perUserSince.sessions = firstSession;

    const now = new Date();
    const snap = { generatedAt: now.toISOString(), seededAt: now.toISOString(), today: istDay(now.getTime()), userCount: ids.length, perUserSince, users, searches };
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: SNAPSHOT_KEY, Body: JSON.stringify(snap), ContentType: "application/json" }));
    return json({ success: true, generatedAt: snap.generatedAt, userCount: ids.length });
  } catch (e) {
    return json({ error: e?.message || "Rebuild failed" }, 500);
  }
}
