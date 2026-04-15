export const runtime = "nodejs";

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.X_AWS_BUCKET_NAME || "truehue-backend-data";
const ROOT_PREFIX = "permanent/shopify/";
const GRAPH_KEY = "permanent/analytics/daily_graph.json";
const EXCLUDED_IDS = new Set(["7383231612", "7862917606"]);

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
  return [...ids].filter((id) => !EXCLUDED_IDS.has(id));
}

function normalizeSteps(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(parseStepLine).filter(Boolean);
  if (raw.steps && Array.isArray(raw.steps)) return raw.steps.map(parseStepLine).filter(Boolean);
  if (typeof raw === "string") {
    let cleaned = raw.trim();
    if (cleaned.startsWith("[") && cleaned.endsWith("]")) cleaned = cleaned.slice(1, -1);
    return cleaned.split(/"\s*,\s*"/g)
      .map((x) => x.replace(/^"/, "").replace(/"$/, "").trim())
      .filter(Boolean)
      .map(parseStepLine).filter(Boolean);
  }
  return [];
}

function parseStepLine(line) {
  if (!line) return null;
  if (typeof line === "object") return { step: String(line.step || line.name || "").trim(), at: line.at ? parseTimestamp(line.at) : null };
  if (typeof line === "string") {
    if (!line.includes(":")) return { step: line.trim(), at: null };
    const idx = line.indexOf(":");
    return { step: line.substring(0, idx).trim(), at: parseTimestamp(line.substring(idx + 1).trim()) };
  }
  return null;
}

function parseTimestamp(t) {
  if (!t) return null;
  if (!t.includes("/")) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  try {
    const [datePart, timePart] = t.split(", ");
    const [dd, mm, yyyy] = datePart.split("/").map(Number);
    const [hh, min, ss] = timePart.split(":").map(Number);
    // treat as IST (UTC+5:30), subtract 5.5hrs to get UTC ms
    return Date.UTC(yyyy, mm - 1, dd, hh, min, ss) - (5.5 * 60 * 60 * 1000);
  } catch { return null; }
}

function fillMissingTimestamps(steps) {
  let lastTs = null;
  return steps.map((s) => {
    if (!s.at) return lastTs ? { ...s, at: lastTs } : s;
    lastTs = s.at;
    return s;
  });
}

function dateKey(ms) {
  if (!ms) return null;
  const d = new Date(ms + 5.5 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function dailyGraphMetrics(users) {
  const daily = {};

  function ensure(day) {
    if (!daily[day]) {
      daily[day] = {
        logins: 0, returningUsers: 0, fineTune: 0, shadeFinder: 0,
        productFinder: 0, shadeGuide: 0, shadeGuideQ3: 0,
        boughtCoins: 0, boughtPremium: 0, boughtShadeGuide: 0,
        paymentPopupOpen: 0, useCoinsLastRemaining: 0, usingCustomerCoins: 0,
      };
    }
  }

  for (const u of users) {
    const steps = u.steps || [];
    if (!steps.length) continue;

    const info = u.info || {};
    const counted = new Set();
    const activeDays = new Set(steps.map((s) => dateKey(s.at)).filter(Boolean));

    for (const s of steps) {
      const day = dateKey(s.at);
      if (!day) continue;
      ensure(day);

      switch (s.step) {
        case "login": {
          if (!counted.has(day)) {
            daily[day].logins++;
            const createdAt = info.createdAt ? dateKey(new Date(info.createdAt).getTime()) : null;
            if (createdAt && createdAt < day) {
              daily[day].returningUsers++;
            }
            counted.add(day);
          }
          break;
        }
        case "model-fine-tune":          daily[day].fineTune++;               break;
        case "shade-finder":             daily[day].shadeFinder++;            break;
        case "product-finder":           daily[day].productFinder++;          break;
        case "shade-guide":              daily[day].shadeGuide++;             break;
        case "shade-guide-q3":           daily[day].shadeGuideQ3++;           break;
        case "bought-coins":             daily[day].boughtCoins++;            break;
        case "bought-premium":           daily[day].boughtPremium++;          break;
        case "bought-shade-guide":       daily[day].boughtShadeGuide++;       break;
        case "payment-popup-open":        daily[day].paymentPopupOpen++;        break;
        case "use-coins-last-remaining":
        case "use-coins-last-5":
        case "use-coins-shade-name-reveal":
        case "use-coins-similar-shade-name-reveal":
            daily[day].useCoinsLastRemaining++;
            break;
        case "using-customer-coins":               daily[day].usingCustomerCoins++;             break;
      }
    }

    for (const day of activeDays) {
      if (!counted.has(day)) {
        ensure(day);
        daily[day].logins++;
        const createdAt = info.createdAt ? dateKey(new Date(info.createdAt).getTime()) : null;
        if (createdAt && createdAt < day) daily[day].returningUsers++;
        counted.add(day);
      }
    }
  }

  return daily;
}

export async function POST() {
  try {
    const ids = await listUserIds();

    async function fetchUser(id) {
      const base = `${ROOT_PREFIX}${id}/`;
      const rawSteps = await getJSON(`${base}steps_taken.json`);
      const steps = fillMissingTimestamps(normalizeSteps(rawSteps));
      const info = (await getJSON(`${base}user_info.json`)) ||
                   (await getJSON(`${base}user_info`)) || {};
      return { id, steps, info: { createdAt: info.createdAt ?? null, lastLogin: info.lastLogin ?? null } };
    }

    const CONCURRENCY = 20;
    const users = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(fetchUser));
      users.push(...results);
    }

    const graph = dailyGraphMetrics(users.filter((u) => u.steps.length > 0));

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: GRAPH_KEY,
      Body: JSON.stringify(graph),
      ContentType: "application/json",
    }));

    return new Response(JSON.stringify({ ok: true, days: Object.keys(graph).length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}