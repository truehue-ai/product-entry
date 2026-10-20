export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { isDhruvi } from "../../../lib/auth";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentials, awsRegion } from "../aws";
import { graphGet, safeErrorMessage, API_VERSION } from "../metaClient";

// Instagram follower demographics — permanent/analytics/meta_ads/instagram.json (read by /meta-ads/persona)
//   connected: { connected: true, fetchedAt, account: { id, username, followers }, demographics: { age, gender, city, country, ageGender }, online: { "0".."23": n } | null }
//   not:       { connected: false, fetchedAt, reason }
// Uses only aggregate metrics the Instagram Graph API offers (follower_demographics, online_followers) — no per-user data.
// The IG account comes from META_IG_USER_ID, else the first Page the token can see with a linked Instagram account.
// GET -> cached file. POST -> refresh (30 min cooldown, skipped while not connected so you can retry after fixing access).

const s3 = new S3Client({ region: awsRegion, credentials: awsCredentials });
const BUCKET = process.env.X_AWS_BUCKET_NAME;
const KEY = "permanent/analytics/meta_ads/instagram.json";
const REFRESH_COOLDOWN_MIN = 30;

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

async function findIgAccount() {
  if (process.env.META_IG_USER_ID) {
    const a = await graphGet(process.env.META_IG_USER_ID, { fields: "id,username,followers_count" });
    return a;
  }
  const pages = await graphGet("me/accounts", { fields: "name,instagram_business_account{id,username,followers_count}", limit: "100" });
  const page = (pages.data || []).find((p) => p.instagram_business_account?.id);
  return page ? page.instagram_business_account : null;
}

// follower_demographics -> [ { dims: [...], value } ]
async function demographics(igId, breakdown) {
  const r = await graphGet(`${igId}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown });
  const results = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
  return results.map((x) => ({ dims: x.dimension_values || [], value: Number(x.value) || 0 }));
}

async function onlineFollowers(igId) {
  const r = await graphGet(`${igId}/insights`, { metric: "online_followers", period: "lifetime" });
  const values = r.data?.[0]?.values || [];
  const last = [...values].reverse().find((v) => v.value && Object.keys(v.value).length);
  return last ? last.value : null;
}

async function fetchInstagram() {
  let ig;
  try {
    ig = await findIgAccount();
  } catch (e) {
    return { connected: false, reason: safeErrorMessage(e, "Could not read the Pages / Instagram account for this token") };
  }
  if (!ig?.id) return { connected: false, reason: "No Instagram business account is linked to a Facebook Page this token can see." };

  const demo = {};
  try {
    for (const b of ["age", "gender", "city", "country"]) demo[b] = await demographics(ig.id, b);
  } catch (e) {
    return { connected: false, reason: safeErrorMessage(e, "Could not read follower demographics") };
  }
  // optional extras — never fail the whole refresh over these
  try { demo.ageGender = await demographics(ig.id, "age,gender"); } catch { demo.ageGender = null; }
  let online = null;
  try { online = await onlineFollowers(ig.id); } catch { online = null; }

  return {
    connected: true,
    account: { id: ig.id, username: ig.username || "", followers: Number(ig.followers_count) || null },
    demographics: demo,
    online,
  };
}


export async function GET() {
  try {
    if (!(await isDhruvi())) return json({ error: "Only dhruvi can view this" }, 403);
    const snap = await getJSON(KEY);
    return json(snap ? { exists: true, cooldownMin: REFRESH_COOLDOWN_MIN, ...snap } : { exists: false, cooldownMin: REFRESH_COOLDOWN_MIN });
  } catch (e) {
    return json({ error: safeErrorMessage(e, "Failed to load Instagram data") }, 500);
  }
}

export async function POST() {
  try {
    if (!(await isDhruvi())) return json({ error: "Only dhruvi can refresh this" }, 403);
    if (!process.env.META_TOKEN_PARAM) return json({ error: "Missing env: META_TOKEN_PARAM" }, 500);
    const prev = await getJSON(KEY);
    const ageMin = prev?.fetchedAt ? (Date.now() - Date.parse(prev.fetchedAt)) / 60000 : Infinity;
    if (prev?.connected && ageMin < REFRESH_COOLDOWN_MIN) {
      return json({ error: `Instagram refreshed ${Math.floor(ageMin)} min ago — try again in ${Math.ceil(REFRESH_COOLDOWN_MIN - ageMin)} min.`, cooldown: true }, 429);
    }
    const snap = { ...(await fetchInstagram()), fetchedAt: new Date().toISOString(), apiVersion: API_VERSION };
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: KEY, Body: JSON.stringify(snap), ContentType: "application/json" }));
    return json({ success: true, connected: snap.connected });
  } catch (e) {
    console.error("[meta-ads/instagram] refresh failed:", safeErrorMessage(e, e?.name || "error"));
    return json({ error: safeErrorMessage(e, "Instagram refresh failed") }, 500);
  }
}
