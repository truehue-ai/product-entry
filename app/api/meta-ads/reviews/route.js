export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { canViewMetaAds, getSessionUser } from "../../../lib/auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentials, awsRegion } from "../aws";
import { safeErrorMessage } from "../metaClient";
import { istToday } from "../../../meta-ads/ranges";

// Reviews of "Today's actions": riddhi (and dhruvi) approve or reject each suggested change, can write their own
// suggestion instead, and can add extra to-dos. Done ticks are saved here too, so everyone sees the same list.
// ONE S3 file, separate from the Meta snapshot:
//   permanent/analytics/meta_ads/action_reviews.json
//   { days: { "YYYY-MM-DD": { "<item key>": { status, suggestion, original, name, done, by, at, doneBy, doneAt } } } }
//   status: "approved" | "rejected" | "added" (an extra to-do written by the reviewer; key starts with "s|")
// GET                                   -> { days }  (last 30 days)
// POST { date, key, status, suggestion?, original?, name? }  -> approve / reject (+ suggestion) / add  (riddhi, dhruvi)
// POST { date, key, done: true|false }  -> tick / untick                                           (riddhi, dhruvi)
// POST { date, key, clear: true }       -> back to "waiting for review" (removes an added to-do)  (riddhi, dhruvi)
// jagat can view only.

const s3 = new S3Client({ region: awsRegion, credentials: awsCredentials });
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const KEY = "permanent/analytics/meta_ads/action_reviews.json";
const REVIEWERS = new Set(["riddhi", "dhruvi"]);
const KEEP_DAYS = 30;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function load() {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
    const j = JSON.parse(await r.Body.transformToString());
    return { days: j?.days && typeof j.days === "object" ? j.days : {} };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { days: {} };
    throw e; // never save over a file we couldn't read
  }
}
const save = (store) =>
  s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: KEY, Body: JSON.stringify(store), ContentType: "application/json" }));

const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isKey = (k) => typeof k === "string" && k.length > 0 && k.length <= 200;
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const recent = (days) => {
  const keys = Object.keys(days).sort().slice(-KEEP_DAYS);
  return Object.fromEntries(keys.map((d) => [d, days[d]]));
};

export async function GET() {
  try {
    if (!(await canViewMetaAds())) return json({ error: "You don't have access to Meta Ads" }, 403);
    return json({ days: recent((await load()).days) });
  } catch (e) {
    console.error("[meta-ads/reviews] load failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: "Could not load reviews" }, 500);
  }
}

export async function POST(req) {
  try {
    const user = await getSessionUser();
    if (!REVIEWERS.has(user)) return json({ error: "Only riddhi and dhruvi can review actions" }, 403);
    const b = await req.json().catch(() => ({}));
    if (!isDay(b.date) || b.date > istToday()) return json({ error: "Invalid date" }, 400);
    if (!isKey(b.key)) return json({ error: "Invalid item" }, 400);

    const store = await load();
    const day = (store.days[b.date] ||= {});
    const now = new Date().toISOString();

    if (b.clear) {
      delete day[b.key];
    } else if (typeof b.done === "boolean") {
      const item = (day[b.key] ||= {});
      item.done = b.done;
      item.doneBy = user;
      item.doneAt = now;
    } else {
      if (!["approved", "rejected", "added"].includes(b.status)) return json({ error: "Invalid status" }, 400);
      const suggestion = text(b.suggestion, 500);
      if (b.status === "added" && (!b.key.startsWith("s|") || !suggestion)) return json({ error: "Write the to-do first" }, 400);
      const prev = day[b.key] || {};
      day[b.key] = {
        ...prev,
        status: b.status,
        suggestion: b.status === "approved" ? "" : suggestion,
        original: text(b.original, 300) || prev.original || "",
        name: text(b.name, 200) || prev.name || "",
        by: user,
        at: now,
      };
    }
    if (!Object.keys(day).length) delete store.days[b.date];
    store.days = recent(store.days);
    await save(store);
    return json({ success: true, days: store.days });
  } catch (e) {
    console.error("[meta-ads/reviews] save failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: "Could not save review" }, 500);
  }
}
