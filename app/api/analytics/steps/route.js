export const runtime = "nodejs";

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.X_AWS_BUCKET_NAME;
const ROOT_PREFIX = "permanent/shopify/";

/* -------------------- S3 helpers -------------------- */

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
  let ContinuationToken = undefined;
  const keys = [];
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken })
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
  return Array.from(ids);
}

/* -------------------- Normalizer -------------------- */

// supports: ["x","y"] or [{step,at}] or {steps:[...]} etc
function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((row) => {
      if (typeof row !== "string") return null;

      // Split on first colon no matter spacing: "a:b", "a : b", etc.
      const idx = row.indexOf(":");
      if (idx === -1) return null;

      const step = row.substring(0, idx).trim();
      const timeStr = row.substring(idx + 1).trim();

      // timeStr example: "04/02/2026, 13:44:34"
      const [datePart, timePart] = timeStr.split(", ");
      if (!datePart || !timePart) return { step, at: null };

      const [dd, mm, yyyy] = datePart.split("/").map(Number);
      const [hh, min, ss] = timePart.split(":").map(Number);

      const at = new Date(yyyy, mm - 1, dd, hh, min, ss).getTime();

      return { step, at };
    })
    .filter(Boolean);
}



function toMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? null : n;
}

/* -------------------- Analysis -------------------- */

function analyze(allUsersSteps) {
  // allUsersSteps: [{ id, steps: [{step,at}] }]
  const stepCounts = new Map();          // step -> occurrences
  const subscribers = {
    total: 0,
    userIds: new Set(),
    };
  const firstStepCounts = new Map();     // step -> users starting here
  const lastStepCounts = new Map();      // step -> users ending here (dropoffs)
  const transitionCounts = new Map();    // "A -> B" -> count
  const returningUsers = [];
  const loginDateCounts = []; // for distribution
  const globalUseCoins = {
  totalUsers: 0,
  totalEvents: 0,
  types: new Map(),
};

    let globalModelFineTune = {
    totalUsersReached: 0,
    totalEvents: 0,
    };

    let globalShadeGuideScroll = {
  totalUsers: 0,
  totalEvents: 0,
};

let globalShadeGuideClicked = {
  totalUsers: 0,
  totalEvents: 0,
  userIds: new Set(),   // NEW
};






  // Time stats: step -> [durationsMs] (time spent "on step" until next step)
  const stepDurations = new Map();

  let usersWithSteps = 0;
  let eventsTotal = 0;
  let timedUsers = 0;

  for (const u of allUsersSteps) {

    if (u.subscribed) {
        subscribers.total++;
        subscribers.userIds.add(u.id);
        }


    const steps = (u.steps || []).slice();
    if (!steps.length) continue;

     // --- Shade Guide Action Tracking ---
    let hasScroll = false;
    let hasClicked = false;
    let scrollCount = 0;
    let clickCount = 0;

    for (const s of steps) {
        const stepName = s.step;

        if (stepName === "shade-guide-action-scroll") {
            scrollCount++;
            hasScroll = true;
        }

        if (stepName === "shade-guide-action-clicked") {
            clickCount++;
            hasClicked = true;
        }
        }


    // Aggregate for global stats
    if (hasScroll) {
    globalShadeGuideScroll.totalUsers++;
    globalShadeGuideScroll.totalEvents += scrollCount;
    }

    if (hasClicked) {
        globalShadeGuideClicked.totalUsers++;
        globalShadeGuideClicked.totalEvents += clickCount;
        globalShadeGuideClicked.userIds.add(u.id);  // NEW
    }




    // --- Model Fine-Tune Tracking ---
    if (!globalModelFineTune) {
    globalModelFineTune = {
        totalUsersReached: 0,
        totalEvents: 0,
    };
    }

    // Check if user reached this step
    let hasFineTuned = false;

    for (const s of steps) {
    if (s.step === "model-fine-tune") {
        hasFineTuned = true;
        globalModelFineTune.totalEvents++;
    }
    }

    if (hasFineTuned) {
    globalModelFineTune.totalUsersReached++;
    }


    // --- Use-Coins Tracking ---
    let userUseCoinsCount = 0;
    const userUseCoinsTypes = new Map();

    for (const s of steps) {
    if (s.step.startsWith("use-coins-")) {
        userUseCoinsCount++;

        const type = s.step.substring("use-coins-".length) || "unknown";
        userUseCoinsTypes.set(type, (userUseCoinsTypes.get(type) || 0) + 1);
    }
    }

    // Aggregate globally
    if (!globalUseCoins.totalUsers) globalUseCoins.totalUsers = 0;
    if (!globalUseCoins.totalEvents) globalUseCoins.totalEvents = 0;
    if (!globalUseCoins.types) globalUseCoins.types = new Map();

    if (userUseCoinsCount > 0) {
    globalUseCoins.totalUsers++;      // user who used coins at least once
    globalUseCoins.totalEvents += userUseCoinsCount;

    for (const [type, count] of userUseCoinsTypes.entries()) {
        globalUseCoins.types.set(type, (globalUseCoins.types.get(type) || 0) + count);
    }
    }


    const loginDates = new Set();

    for (const s of u.steps) {
    if (s.step === "login" && s.at) {
        const d = new Date(s.at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        loginDates.add(key);
    }
    }

    if (loginDates.size > 0) {
    loginDateCounts.push(loginDates.size);
    }

    if (loginDates.size >= 2) {
    returningUsers.push({
        id: u.id,
        days: loginDates.size,
    });
    }


    usersWithSteps += 1;
    eventsTotal += steps.length;

    // counts
    for (const s of steps) {
      stepCounts.set(s.step, (stepCounts.get(s.step) || 0) + 1);
    }

    // funnel-ish
    firstStepCounts.set(steps[0].step, (firstStepCounts.get(steps[0].step) || 0) + 1);
    lastStepCounts.set(
      steps[steps.length - 1].step,
      (lastStepCounts.get(steps[steps.length - 1].step) || 0) + 1
    );

    // transitions + durations (if timestamps exist and are increasing)
    // We sort by timestamp if timestamps exist, else keep original order.
    const withMs = steps.map((s) => ({ ...s, _ms: toMs(s.at) }));
    const hasAnyTime = withMs.some((s) => s._ms != null);

    let ordered = withMs;
    if (hasAnyTime) {
      // sort, but keep nulls at the end preserving order among nulls
      ordered = [...withMs].sort((a, b) => {
        if (a._ms == null && b._ms == null) return 0;
        if (a._ms == null) return 1;
        if (b._ms == null) return -1;
        return a._ms - b._ms;
      });
      timedUsers += 1;
    }

    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];

      // transition
      const key = `${a.step} → ${b.step}`;
      transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1);

      // duration for step a until next step
      if (a._ms != null && b._ms != null && b._ms >= a._ms) {
        const d = b._ms - a._ms;
        if (!stepDurations.has(a.step)) stepDurations.set(a.step, []);
        stepDurations.get(a.step).push(d);
      }
    }
  }

  const totalUsersWithLogin = loginDateCounts.length;
  const returningCount = returningUsers.length;

    const returningRate =
    totalUsersWithLogin > 0
        ? Math.round((returningCount / totalUsersWithLogin) * 100)
        : 0;


  function topN(map, n, valueKey = "count", labelKey = "step") {
    return Array.from(map.entries())
      .map(([k, v]) => ({ [labelKey]: k, [valueKey]: v }))
      .sort((a, b) => b[valueKey] - a[valueKey])
      .slice(0, n);
  }

  function median(arr) {
    if (!arr || !arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
  }

  function msToNice(ms) {
    if (ms == null) return "-";
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.round(min / 60);
    return `${hr}h`;
  }

  const timeByStep = Array.from(stepDurations.entries())
    .map(([step, durs]) => {
      const med = median(durs);
      const avg = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
      return {
        step,
        samples: durs.length,
        medianMs: med,
        median: msToNice(med),
        avgMs: avg,
        avg: msToNice(avg),
      };
    })
    .sort((a, b) => (b.medianMs || 0) - (a.medianMs || 0))
    .slice(0, 15);

  return {
    usersWithSteps,
    eventsTotal,
    timedUsers,
    topSteps: topN(stepCounts, 15, "count", "step"),
    topDropoffs: topN(lastStepCounts, 15, "count", "step"),
    topEntrySteps: topN(firstStepCounts, 10, "count", "step"),
    topTransitions: topN(transitionCounts, 15, "count", "transition"),
    mostTimeSpent: timeByStep, // by median duration on step
    retention: {
        totalUsersWithLogin,
        returningUsers: returningCount,
        returningRate, // %
        breakdown: returningUsers.slice(0, 20), // optional: top repeat users
    },
    useCoins: {
        totalUsers: globalUseCoins.totalUsers,
        totalEvents: globalUseCoins.totalEvents,
        topTypes: Array.from(globalUseCoins.types.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
    modelFineTune: {
        totalUsersReached: globalModelFineTune.totalUsersReached,
        totalEvents: globalModelFineTune.totalEvents,
        },
    shadeGuideActions: {
    scroll: {
      totalUsers: globalShadeGuideScroll.totalUsers,
      totalEvents: globalShadeGuideScroll.totalEvents,
    },
    clicked: {
        totalUsers: globalShadeGuideClicked.totalUsers,
        totalEvents: globalShadeGuideClicked.totalEvents,
        userIds: Array.from(globalShadeGuideClicked.userIds), // NEW
        },
  },
      subscribers: {
        total: subscribers.total,
        userIds: Array.from(subscribers.userIds),
        },

  };
}

/* -------------------- Handler -------------------- */

export async function GET() {
  try {
    const ids = await listUserIds();

    // pull steps for each user id (id == number in your storage layout)
    const usersSteps = await Promise.all(
        ids.map(async (id) => {
            const raw = await getJSON(`${ROOT_PREFIX}${id}/steps_taken.json`);
            const subs = await getJSON(`${ROOT_PREFIX}${id}/subscribed.json`);

            const steps = normalizeSteps(raw);
            const subscribed = subs?.subscribed === true;

            return { id, steps, subscribed };
        })
        );


    const nonEmpty = usersSteps.filter((u) => (u.steps || []).length > 0);
    const insights = analyze(nonEmpty);

    return new Response(
      JSON.stringify({
        generatedAt: Date.now(),
        usersIncluded: nonEmpty.length,
        insights,
      }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || "Steps analysis failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
