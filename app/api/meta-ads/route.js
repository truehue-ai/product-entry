export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { canViewMetaAds } from "../../lib/auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentials, awsRegion } from "./aws";
import { graphGet, graphGetAll, insightsAuto, assertConfigured, safeErrorMessage, AD_ACCOUNT_ID, API_VERSION } from "./metaClient";
import { addDays, istToday, dataWindow, computeRange, PRESET_KEYS } from "../../meta-ads/ranges";

// Meta Ads snapshot — ONE S3 file: permanent/analytics/meta_ads/snapshot.json (read by /meta-ads and /meta-ads/persona).
// One refresh fetches a fixed window (last 90 days, and always all of last quarter — see dataWindow); every range tab and
// custom date is then cut from it in the browser, so switching ranges never calls Meta. Only Meta data.
//   { schema: 6, fetchedAt, apiVersion, account, since, until, compareSince,
//     ads:     { ad_id: { name, adset, adset_id, campaign_id, campaign } },
//     daily:   [ { date, ad_id, spend, impressions, clicks, linkClicks, lpv, purchases, revenue, pxPurchases, pxRevenue } ]   // compareSince → until
//              // pxPurchases / pxRevenue: offsite_conversion.fb_pixel_purchase only (used by Today's actions)
//     structure: { campaigns: { id: {…} }, adsets: { id: {…} }, lastBudgetChange: { id: date }, budgetChangeSource, activityError }
//              // current status / daily budget / created date, for Today's actions. Budgets in ₹ (Meta sends paise).
//     totals:  { "7d" | "14d" | "30d" | "90d" | "tq" | "lq": { since, until, ad: { id: { reach, frequency } }, campaign: { id: {…} } } }
//              // reach / frequency can't be added up by day, so Meta's own totals are fetched for each preset
//     breakdowns: { age | gender | ageGender | region | placement | device: [ { date, key, age?, gender?, …metrics } ] }  // since → until
//     hourly:  [ { date, hour, …metrics } ] }                                                                         // since → until
// Metrics Meta doesn't report are null, never 0.
// GET  -> the snapshot (the page never calls Meta)
// POST -> refresh from Meta, at most once every 30 min (dhruvi + Meta-Ads-only users)
// Read-only towards Meta: nothing here changes budgets or statuses.
//
// Budget history (fallback for "last budget change" when the activity log can't be read):
//   permanent/analytics/meta_ads/budget_history.json  { objects: { id: [ { date, budget } ] } }
//   each refresh appends an entry when an ad set's / campaign's daily budget differs from the last one seen.

const s3 = new S3Client({ region: awsRegion, credentials: awsCredentials });
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const SNAPSHOT_KEY = "permanent/analytics/meta_ads/snapshot.json";
const BUDGET_HISTORY_KEY = "permanent/analytics/meta_ads/budget_history.json";
const SCHEMA = 6; // 6: daily delivery + conversions fetched separately (Meta zeroed spend when combined)
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
// Pixel purchases only (offsite_conversion.fb_pixel_purchase), next to the general purchase count
const PIXEL_PURCHASE = ["offsite_conversion.fb_pixel_purchase"];
function pixel(r) {
  if (!r) return { pxPurchases: null, pxRevenue: null };
  return {
    pxPurchases: Array.isArray(r.actions) ? pickAction(r.actions, PIXEL_PURCHASE) : null,
    pxRevenue: Array.isArray(r.action_values) ? pickAction(r.action_values, PIXEL_PURCHASE) : Array.isArray(r.actions) ? 0 : null,
  };
}
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

  // Per ad per day, compareSince → today (a quarter per request).
  // Meta quirk: on daily rows without a breakdown, asking for inline_link_clicks / actions / action_values in the same
  // request zeroes spend and impressions. So delivery and conversions are fetched separately and joined by (day, ad).
  const ads = {};
  const byKey = new Map();
  for (let s = win.compareSince; s <= today; s = addDays(s, CHUNK_DAYS)) {
    const e = addDays(s, CHUNK_DAYS - 1) < today ? addDays(s, CHUNK_DAYS - 1) : today;
    const p = { level: "ad", time_increment: "1", time_range: timeRange(s, e) };
    const delivery = await insights({ ...p, fields: "campaign_id,campaign_name,adset_id,adset_name,ad_name,ad_id,spend,impressions,clicks" });
    const conversions = await insights({ ...p, fields: "ad_id,inline_link_clicks,actions,action_values" });
    const conv = new Map(conversions.map((r) => [`${r.date_start}|${r.ad_id}`, r]));
    for (const r of delivery) {
      ads[r.ad_id] ||= { name: r.ad_name, adset: r.adset_name, adset_id: r.adset_id, campaign_id: r.campaign_id, campaign: r.campaign_name };
      const k = `${r.date_start}|${r.ad_id}`;
      const c = conv.get(k);
      byKey.set(k, { date: r.date_start, ad_id: r.ad_id, ...base({ ...(c || {}), spend: r.spend, impressions: r.impressions, clicks: r.clicks }), ...pixel(c) });
    }
    // conversions on a day with no delivery row (e.g. a late-attributed purchase)
    for (const [k, r] of conv) {
      if (byKey.has(k)) continue;
      byKey.set(k, { date: r.date_start, ad_id: r.ad_id, ...base({ ...r, spend: 0, impressions: 0, clicks: 0 }), ...pixel(r) });
    }
  }
  const daily = [...byKey.values()];

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

  // Campaigns / ad sets as they are now (status, budget, created) + when budgets last changed — for Today's actions.
  // A failure here doesn't fail the refresh; the section shows the error instead.
  let structure;
  try {
    structure = await fetchStructure(today);
  } catch (e) {
    structure = { error: safeErrorMessage(e, "Could not load campaigns and ad sets") };
  }

  return {
    schema: SCHEMA,
    fetchedAt: new Date().toISOString(),
    apiVersion: API_VERSION,
    account: { id: AD_ACCOUNT_ID, name: account.name || "", currency: account.currency || "INR", timezone: account.timezone_name || "" },
    since: win.since, until: today, compareSince: win.compareSince,
    ads, daily, totals, breakdowns, hourly, structure,
  };
}

// ── structure for Today's actions ──
const money = (v) => (v == null || v === "" || Number(v) <= 0 ? null : Number(v) / 100); // Meta sends budgets in paise
// "2026-11-10T12:00:00+0000" -> India date
const istDate = (ts) => {
  const t = Date.parse(String(ts || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(t) ? new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : null;
};
const ACTIVITY_DAYS = 30;

async function fetchStructure(today) {
  const campaigns = {}, adsets = {};
  for (const c of await graphGetAll(`${AD_ACCOUNT_ID}/campaigns`, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,created_time", limit: "200" })) {
    campaigns[c.id] = { name: c.name, status: c.status, effective_status: c.effective_status, daily_budget: money(c.daily_budget), lifetime_budget: money(c.lifetime_budget), created: istDate(c.created_time) };
  }
  for (const a of await graphGetAll(`${AD_ACCOUNT_ID}/adsets`, { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,created_time", limit: "200" })) {
    adsets[a.id] = { name: a.name, campaign_id: a.campaign_id, status: a.status, effective_status: a.effective_status, daily_budget: money(a.daily_budget), lifetime_budget: money(a.lifetime_budget), created: istDate(a.created_time) };
  }

  // Last budget change per ad set / campaign from the ad account activity log (budget update events)
  const lastBudgetChange = {};
  let activityError = null;
  try {
    const since = Math.floor(Date.parse(`${addDays(today, -ACTIVITY_DAYS)}T00:00:00+05:30`) / 1000);
    const events = await graphGetAll(`${AD_ACCOUNT_ID}/activities`, { fields: "event_type,event_time,object_id", since: String(since), limit: "500" });
    for (const e of events) {
      if (!/budget/i.test(e.event_type || "") || !e.object_id) continue;
      const d = istDate(e.event_time);
      if (d && (!lastBudgetChange[e.object_id] || d > lastBudgetChange[e.object_id])) lastBudgetChange[e.object_id] = d;
    }
  } catch (e) {
    activityError = safeErrorMessage(e, "Could not read the activity log");
  }
  return { fetchedAt: new Date().toISOString(), campaigns, adsets, lastBudgetChange, activityError, budgetChangeSource: activityError ? "history" : "activity log" };
}

// Budget history: records each daily budget the refreshes see, and adds the change dates it detects to the snapshot.
// A missing file starts empty; any other read error skips this step, so the history is never overwritten by a failed read.
async function updateBudgetHistory(snap) {
  const st = snap.structure;
  if (!st || st.error) return;
  let store;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: BUDGET_HISTORY_KEY }));
    store = JSON.parse(await r.Body.transformToString());
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) store = { objects: {} };
    else { console.error("[meta-ads] budget history read failed:", e?.name || "error"); return; }
  }
  store.objects ||= {};
  const today = snap.until;
  let changed = false;
  for (const [id, o] of [...Object.entries(st.adsets), ...Object.entries(st.campaigns)]) {
    if (o.daily_budget == null) continue;
    const list = (store.objects[id] ||= []);
    const last = list[list.length - 1];
    if (!last || last.budget !== o.daily_budget) { list.push({ date: today, budget: o.daily_budget }); changed = true; }
    // a change seen by the history (not the first sighting) counts as a budget change on that day
    const seen = list.length > 1 ? list[list.length - 1].date : null;
    if (seen && (!st.lastBudgetChange[id] || seen > st.lastBudgetChange[id])) st.lastBudgetChange[id] = seen;
  }
  st.budgetHistorySince = Object.values(store.objects).flat().reduce((m, x) => (!m || x.date < m ? x.date : m), null);
  if (changed) await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: BUDGET_HISTORY_KEY, Body: JSON.stringify(store), ContentType: "application/json" }));
}

export async function GET() {
  try {
    if (!(await canViewMetaAds())) return json({ error: "You don't have access to Meta Ads" }, 403);
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
    if (!(await canViewMetaAds())) return json({ error: "You don't have access to Meta Ads" }, 403);
    const prev = await getJSON(SNAPSHOT_KEY);
    const ageMin = prev?.fetchedAt ? (Date.now() - Date.parse(prev.fetchedAt)) / 60000 : Infinity;
    if (prev?.schema === SCHEMA && ageMin < REFRESH_COOLDOWN_MIN) {
      const retryInMin = Math.ceil(REFRESH_COOLDOWN_MIN - ageMin);
      return json({ error: `Refreshed ${Math.floor(ageMin)} min ago — try again in ${retryInMin} min.`, cooldown: true, retryInMin }, 429);
    }
    const snap = await fetchSnapshot();
    try {
      await updateBudgetHistory(snap);
    } catch (e) {
      console.error("[meta-ads] budget history failed:", e?.name || "error");
    }
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: SNAPSHOT_KEY, Body: JSON.stringify(snap), ContentType: "application/json" }));
    return json({ success: true, fetchedAt: snap.fetchedAt, rows: snap.daily.length });
  } catch (e) {
    console.error("[meta-ads] refresh failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: safeErrorMessage(e, "Refresh failed") }, 500);
  }
}
