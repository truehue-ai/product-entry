export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { isDhruvi } from "../../lib/auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentials, awsRegion } from "./aws";
import { graphGet, insightsAuto, assertConfigured, safeErrorMessage, AD_ACCOUNT_ID, API_VERSION } from "./metaClient";
import { addDays, istToday, dataWindow, computeRange, PRESET_KEYS } from "../../meta-ads/ranges";

// Meta Ads snapshot — ONE S3 file: permanent/analytics/meta_ads/snapshot.json (read by /meta-ads and /meta-ads/persona).
// One refresh fetches a fixed window (last 90 days, and always all of last quarter — see dataWindow); every range tab and
// custom date is then cut from it in the browser, so switching ranges never calls Meta. Only Meta data.
//   { schema: 5, fetchedAt, apiVersion, account, since, until, compareSince,
//     ads:     { ad_id: { name, adset, campaign_id, campaign } },
//     daily:   [ { date, ad_id, spend, impressions, clicks, linkClicks, lpv, purchases, revenue } ]   // compareSince → until
//     totals:  { "7d" | "14d" | "30d" | "90d" | "tq" | "lq": { since, until, ad: { id: { reach, frequency } }, campaign: { id: {…} } } }
//              // reach / frequency can't be added up by day, so Meta's own totals are fetched for each preset
//     breakdowns: { age | gender | ageGender | region | placement | device: [ { date, key, age?, gender?, …metrics } ] }  // since → until
//     hourly:  [ { date, hour, …metrics } ] }                                                                         // since → until
// Metrics Meta doesn't report are null, never 0.
// GET  -> the snapshot (the page never calls Meta)
// POST -> refresh from Meta, at most once every 30 min (dhruvi only)

const s3 = new S3Client({ region: awsRegion, credentials: awsCredentials });
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const SNAPSHOT_KEY = "permanent/analytics/meta_ads/snapshot.json";
const SCHEMA = 5;
const REFRESH_COOLDOWN_MIN = 30;
const CHUNK_DAYS = 92; // ad-level daily rows are fetched a quarter at a time

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

const timeRange = (since, until) => JSON.stringify({ since, until });

// ── insights parsing ──
// Meta lists the same purchases under several action types; use "purchase", else the pixel one, else omni.
const PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
const LPV_TYPES = ["landing_page_view", "omni_landing_page_view"];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function pickAction(list, types) {
  if (!Array.isArray(list)) return 0;
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}
// A metric Meta leaves out of the response is null ("not reported"), never 0 — e.g. the region breakdown has no
// conversion metrics at all. Only a reported field with no matching action counts as a real zero.
const optNum = (v) => (v === undefined || v === null ? null : num(v));
function base(r) {
  const hasActions = Array.isArray(r.actions);
  const purchases = hasActions ? pickAction(r.actions, PURCHASE_TYPES) : null;
  const revenue = Array.isArray(r.action_values) ? pickAction(r.action_values, PURCHASE_TYPES) : purchases === 0 ? 0 : null;
  return {
    spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), linkClicks: optNum(r.inline_link_clicks),
    lpv: hasActions ? pickAction(r.actions, LPV_TYPES) : null,
    purchases,
    revenue, // Meta-reported purchase value
  };
}

const METRICS = "spend,impressions,clicks,inline_link_clicks,actions,action_values";
const BREAKDOWNS = {
  age: { breakdowns: "age", map: (r) => ({ key: r.age }) },
  gender: { breakdowns: "gender", map: (r) => ({ key: r.gender }) },
  ageGender: { breakdowns: "age,gender", map: (r) => ({ key: `${r.gender} ${r.age}`, age: r.age, gender: r.gender }) },
  region: { breakdowns: "region", map: (r) => ({ key: r.region }) },
  placement: { breakdowns: "publisher_platform,platform_position", map: (r) => ({ key: `${r.publisher_platform} · ${String(r.platform_position || "").replace(/_/g, " ")}` }) },
  device: { breakdowns: "impression_device", map: (r) => ({ key: String(r.impression_device || "").replace(/_/g, " ") }) },
};
const HOUR_BREAKDOWN = "hourly_stats_aggregated_by_advertiser_time_zone"; // "13:00:00 - 13:59:59"
const common = { use_unified_attribution_setting: "true", limit: "1000" };
const insights = (params) => insightsAuto(`${AD_ACCOUNT_ID}/insights`, { ...common, ...params });

async function fetchSnapshot() {
  assertConfigured();
  const today = istToday();
  const win = dataWindow(today);
  const account = await graphGet(AD_ACCOUNT_ID, { fields: "name,currency,timezone_name" });

  // Per ad per day, compareSince → today (a quarter per request)
  const ads = {};
  const daily = [];
  for (let s = win.compareSince; s <= today; s = addDays(s, CHUNK_DAYS)) {
    const e = addDays(s, CHUNK_DAYS - 1) < today ? addDays(s, CHUNK_DAYS - 1) : today;
    const rows = await insights({ level: "ad", time_increment: "1", time_range: timeRange(s, e), fields: `campaign_id,campaign_name,adset_name,ad_name,ad_id,${METRICS}` });
    for (const r of rows) {
      ads[r.ad_id] ||= { name: r.ad_name, adset: r.adset_name, campaign_id: r.campaign_id, campaign: r.campaign_name };
      daily.push({ date: r.date_start, ad_id: r.ad_id, ...base(r) });
    }
  }

  // Reach / frequency per preset (not summable by day) — one ad-level and one campaign-level call each
  const totals = {};
  for (const key of PRESET_KEYS) {
    const r = computeRange(key, "", "", today, win);
    const tr = timeRange(r.since, r.until);
    const pick = (rows, idKey) => Object.fromEntries(rows.map((x) => [x[idKey], { reach: num(x.reach), frequency: num(x.frequency) }]));
    totals[key] = {
      since: r.since, until: r.until,
      ad: pick(await insights({ level: "ad", time_range: tr, fields: "ad_id,reach,frequency" }), "ad_id"),
      campaign: pick(await insights({ level: "campaign", time_range: tr, fields: "campaign_id,reach,frequency" }), "campaign_id"),
    };
  }

  // Breakdowns per day over the window — separate calls, Meta won't combine them all
  const breakdowns = {};
  for (const [name, b] of Object.entries(BREAKDOWNS)) {
    const rows = await insights({ level: "account", time_increment: "1", time_range: timeRange(win.since, today), fields: METRICS, breakdowns: b.breakdowns });
    breakdowns[name] = rows.map((r) => { const m = b.map(r); return { date: r.date_start, ...m, key: m.key || "unknown", ...base(r) }; });
  }

  // Time of day per day (hour of the ad impression, ad account time zone)
  const hourly = (await insights({ level: "account", time_increment: "1", time_range: timeRange(win.since, today), fields: METRICS, breakdowns: HOUR_BREAKDOWN }))
    .map((r) => ({ date: r.date_start, hour: parseInt(String(r[HOUR_BREAKDOWN] || "").slice(0, 2), 10), ...base(r) }))
    .filter((r) => r.hour >= 0 && r.hour <= 23);

  return {
    schema: SCHEMA,
    fetchedAt: new Date().toISOString(),
    apiVersion: API_VERSION,
    account: { id: AD_ACCOUNT_ID, name: account.name || "", currency: account.currency || "INR", timezone: account.timezone_name || "" },
    since: win.since, until: today, compareSince: win.compareSince,
    ads, daily, totals, breakdowns, hourly,
  };
}

export async function GET() {
  try {
    if (!(await isDhruvi())) return json({ error: "Only dhruvi can view Meta Ads" }, 403);
    const snap = await getJSON(SNAPSHOT_KEY);
    if (!snap || snap.schema !== SCHEMA) return json({ exists: false, cooldownMin: REFRESH_COOLDOWN_MIN });
    return json({ exists: true, cooldownMin: REFRESH_COOLDOWN_MIN, ...snap });
  } catch (e) {
    console.error("[meta-ads] load failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: safeErrorMessage(e, "Failed to load Meta Ads data") }, 500);
  }
}

export async function POST() {
  try {
    if (!(await isDhruvi())) return json({ error: "Only dhruvi can refresh Meta Ads" }, 403);
    const prev = await getJSON(SNAPSHOT_KEY);
    const ageMin = prev?.fetchedAt ? (Date.now() - Date.parse(prev.fetchedAt)) / 60000 : Infinity;
    if (prev?.schema === SCHEMA && ageMin < REFRESH_COOLDOWN_MIN) {
      const retryInMin = Math.ceil(REFRESH_COOLDOWN_MIN - ageMin);
      return json({ error: `Refreshed ${Math.floor(ageMin)} min ago — try again in ${retryInMin} min.`, cooldown: true, retryInMin }, 429);
    }
    const snap = await fetchSnapshot();
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: SNAPSHOT_KEY, Body: JSON.stringify(snap), ContentType: "application/json" }));
    return json({ success: true, fetchedAt: snap.fetchedAt, rows: snap.daily.length });
  } catch (e) {
    console.error("[meta-ads] refresh failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: safeErrorMessage(e, "Refresh failed") }, 500);
  }
}
