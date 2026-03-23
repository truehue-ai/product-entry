export const runtime = "nodejs";

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
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

/* --------------------------------------------------------------------- */
/*                               S3 HELPERS                               */
/* --------------------------------------------------------------------- */

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function listAllKeys(prefix) {
  let ContinuationToken;
  const keys = [];
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken,
      })
    );
    (resp.Contents || []).forEach((o) => o?.Key && keys.push(o.Key));
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function listUserIds() {
  const all = await listAllKeys(ROOT_PREFIX);
  const ids = new Set();
  for (const k of all) {
    const m = k.match(/^permanent\/shopify\/([^/]+)\//);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

/* --------------------------------------------------------------------- */
/*                            STEP NORMALIZATION                          */
/* --------------------------------------------------------------------- */

function normalizeSteps(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(parseStepLine).filter(Boolean);

  if (raw.steps && Array.isArray(raw.steps)) {
    return raw.steps.map(parseStepLine).filter(Boolean);
  }

  if (typeof raw === "string") {
    let cleaned = raw.trim();
    if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
      cleaned = cleaned.slice(1, -1);
    }

    const parts = cleaned
      .split(/"\s*,\s*"/g)
      .map((x) => x.replace(/^"/, "").replace(/"$/, "").trim())
      .filter(Boolean);

    return parts.map(parseStepLine).filter(Boolean);
  }

  return [];
}

function parseStepLine(line) {
  if (!line) return null;

  if (typeof line === "object") {
    return {
      step: String(line.step || line.name || "").trim(),
      at: line.at ? parseTimestamp(line.at) : null,
    };
  }

  if (typeof line === "string") {
    if (!line.includes(":")) {
      return { step: line.trim(), at: null };
    }

    const idx = line.indexOf(":");
    const step = line.substring(0, idx).trim();
    const t = line.substring(idx + 1).trim();

    return { step, at: parseTimestamp(t) };
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

    return new Date(yyyy, mm - 1, dd, hh, min, ss).getTime();
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- */
/*            FILL MISSING TIMESTAMPS (e.g., bought-shade-guide)         */
/* --------------------------------------------------------------------- */

function fillMissingTimestamps(steps) {
  let lastTs = null;

  return steps.map((s) => {
    if (!s.at) {
      if (lastTs) return { ...s, at: lastTs };
      return s;
    }
    lastTs = s.at;
    return s;
  });
}

function dateKey(ms) {
  if (!ms) return null;

  const d = new Date(ms);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


/* --------------------------------------------------------------------- */
/*                         DAILY GRAPH METRICS                            */
/* --------------------------------------------------------------------- */

function dailyGraphMetrics(users) {
  const daily = {};

  function ensure(day) {
    if (!daily[day]) {
      daily[day] = {
        logins: 0,
        returningUsers: 0,   // 👈 NEW
        fineTune: 0,
        shadeFinder: 0,
        productFinder: 0,
        shadeGuide: 0,
        useCoinsShadeFinder: 0,
        useCoinsProductFinder: 0,
        shadeGuideQ3: 0,
        boughtCoins: 0,
        boughtPremium: 0,
        boughtShadeGuide: 0,
        };

    }
  }

  for (const u of users) {
    const steps = u.steps || [];
    if (!steps.length) continue;

    const counted = new Set(); // ensures each user counted once/day

    // Pre-collect all active days for this user (any step with a date)
    const activeDays = new Set(
      steps.map((s) => dateKey(s.at)).filter(Boolean)
    );

    for (const s of steps) {
      const day = dateKey(s.at);
      if (!day) continue;

      ensure(day);

      switch (s.step) {
        case "login": {
            if (!counted.has(day)) {
            daily[day].logins++;


            const createdAt = u.info?.createdAt ? dateKey(u.info.createdAt) : null;

            console.log(createdAt)
            const lastLogin = u.info?.lastLogin ? dateKey(u.info.lastLogin) : null;

            // Returning user if created earlier AND logged-in today
            if (createdAt && lastLogin && createdAt < day && lastLogin === day) {
                daily[day].returningUsers++;
            }

            counted.add(day);
            }
            break;
        }

        case "model-fine-tune":
          daily[day].fineTune++;
          break;

        case "shade-finder":
          daily[day].shadeFinder++;
          break;

        case "product-finder":
          daily[day].productFinder++;
          break;

        case "shade-guide":
          daily[day].shadeGuide++;
          break;

        case "shade-guide-q3":
          daily[day].shadeGuideQ3++;
          break;

        case "use-coins-shade-finder":
          daily[day].useCoinsShadeFinder++;
          break;

        case "use-coins-product-finder":
          daily[day].useCoinsProductFinder++;
          break;

        /* ---------------- NEW PURCHASE MAPPING ---------------- */
        case "bought-coins":
          daily[day].boughtCoins++;
          break;

        case "bought-premium":
          daily[day].boughtPremium++;
          break;

        case "bought-shade-guide":
          daily[day].boughtShadeGuide++;
          break;
      }
    }
    // Fallback: for any active day where login step wasn't fired,
    // still count the user as having a session that day
    for (const day of activeDays) {
      if (!counted.has(day)) {
        ensure(day);
        daily[day].logins++;

        const createdAt = u.info?.createdAt ? dateKey(u.info.createdAt) : null;

        if (createdAt && createdAt < day) {
          daily[day].returningUsers++;
        }

        counted.add(day);
      }
    }
  }

  return daily;
}

/* --------------------------------------------------------------------- */
/*                                HANDLER                                */
/* --------------------------------------------------------------------- */

export async function GET() {
  try {
    const ids = await listUserIds();

    const excludedIds = ['7383231612', '7862917606'];

    const users = await Promise.all(
    ids.filter(id => !excludedIds.includes(id)).map(async (id) => {
        const base = `${ROOT_PREFIX}${id}/`;

        // Load steps
        const rawSteps = await getJSON(`${base}steps_taken.json`);
        const stepsRaw = normalizeSteps(rawSteps);
        const steps = fillMissingTimestamps(stepsRaw);

        // Load user info (createdAt, lastLogin)
        const info =
        (await getJSON(`${base}user_info.json`)) ||
        (await getJSON(`${base}user_info`)) ||
        {};

        return {
        id,
        steps,
        info: {
            createdAt: info.createdAt ?? null,
            lastLogin: info.lastLogin ?? null,
        },
        };
    })
    );


    const withSteps = users.filter((u) => u.steps.length > 0);
    const graph = dailyGraphMetrics(withSteps);

    return new Response(JSON.stringify({ graph }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}
