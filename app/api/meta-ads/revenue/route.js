export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { canViewMetaAds, getSessionUser } from "../../../lib/auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentials, awsRegion } from "../aws";
import { safeErrorMessage } from "../metaClient";
import { istToday } from "../../../meta-ads/ranges";

// Actual revenue entered by hand, day by day: Razorpay (website) + App. These are the FULL amounts for the day, not
// just what Meta missed. The Meta Ads page compares them with Meta's attributed revenue to get the true ROAS.
// ONE S3 file, separate from the Meta snapshot (a Meta refresh never touches it):
//   permanent/analytics/meta_ads/actual_revenue.json
//   { days: { "YYYY-MM-DD": { razorpay, app, by, at } } }
// GET    -> { days }
// POST   { date, razorpay, app } -> saves (overwrites) that day
// DELETE ?date=YYYY-MM-DD        -> removes that day's entry

const s3 = new S3Client({ region: awsRegion, credentials: awsCredentials });
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const KEY = "permanent/analytics/meta_ads/actual_revenue.json";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// A missing file is an empty store; any other read error throws, so a failed read never gets saved over the real file.
async function load() {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
    const j = JSON.parse(await r.Body.transformToString());
    return { days: j?.days && typeof j.days === "object" ? j.days : {} };
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return { days: {} };
    throw e;
  }
}
const save = (store) =>
  s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: KEY, Body: JSON.stringify(store), ContentType: "application/json" }));

const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
// "" / null -> 0; anything else must be a non-negative number
const amount = (v) => {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

export async function GET() {
  try {
    if (!(await canViewMetaAds())) return json({ error: "You don't have access to Meta Ads" }, 403);
    return json(await load());
  } catch (e) {
    console.error("[meta-ads/revenue] load failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: "Could not load saved revenue" }, 500);
  }
}

export async function POST(req) {
  try {
    if (!(await canViewMetaAds())) return json({ error: "You don't have access to Meta Ads" }, 403);
    const body = await req.json().catch(() => ({}));
    const { date } = body;
    if (!isDay(date)) return json({ error: "Pick a valid date" }, 400);
    if (date > istToday()) return json({ error: "That date is in the future" }, 400);
    const razorpay = amount(body.razorpay), app = amount(body.app);
    if (razorpay == null || app == null) return json({ error: "Amounts must be numbers of 0 or more" }, 400);
    const store = await load();
    store.days[date] = { razorpay, app, by: (await getSessionUser()) || "", at: new Date().toISOString() };
    await save(store);
    return json({ success: true, days: store.days });
  } catch (e) {
    console.error("[meta-ads/revenue] save failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: "Could not save revenue" }, 500);
  }
}

export async function DELETE(req) {
  try {
    if (!(await canViewMetaAds())) return json({ error: "You don't have access to Meta Ads" }, 403);
    const date = new URL(req.url).searchParams.get("date");
    if (!isDay(date)) return json({ error: "Pick a valid date" }, 400);
    const store = await load();
    if (store.days[date]) {
      delete store.days[date];
      await save(store);
    }
    return json({ success: true, days: store.days });
  } catch (e) {
    console.error("[meta-ads/revenue] delete failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: "Could not delete revenue" }, 500);
  }
}
