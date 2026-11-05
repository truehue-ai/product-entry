// Ads Platform Metrics — every goal and setting lives here, so goals can change (or stages be added)
// without touching the page. Used by app/lib/adsPlatformMetrics.js, the API and /ads-platform-metrics.

// Paid member = account created (user_info.json createdAt, India time) on or after this day AND
// premium/timestamp.json is {"type": "lifetime"}. Accounts created before it are left out.
export const PAID_MEMBER_START_DATE = "2026-07-01";

// Pass type in premium/timestamp.json that makes someone a paid member
export const PAID_PASS_TYPE = "lifetime";

// Steps that make a day "engaged" (opening the app alone doesn't count). Compare shades isn't logged yet.
export const MEANINGFUL_STEPS = {
  "shade-finder": "Shade search",
  "product-finder": "Product view",
  "model-fine-tune": "Try-on",
  "try-once-for-free-shade": "Try-on",
  "try-once-for-free-product": "Try-on",
};

// Step the app sends when a session starts (app opened, or back after 30+ min). Not sent yet — until it is,
// sessions show "Not tracked yet". Keep in sync with ADS_SESSION_STEP in the backend (app.py).
export const SESSION_STEP = "session-start";

// Product Analytics sources counted as searches (user_search = what people typed; discovery = browsing)
export const SEARCH_SOURCES = ["user_search"];

// Entered by hand
export const CASE_STUDIES_COMPLETED = 0;

// In order, lowest first. To add a stage: add it here and give every metric below a goal for its key.
export const STAGES = [
  { key: "pilot", label: "Pilot", description: "Ready to pitch indie / new D2C beauty brands for small paid pilots" },
  { key: "stage2", label: "Stage 2", description: "Ready for repeatable paid deals with mid-size D2C brands" },
  { key: "platform", label: "Platform", description: "Ready for large Indian / global brands" },
];

export const METRIC_GROUPS = ["Reach", "Engagement", "Retention", "Purchase intent", "Proof"];

// format: count | pct (stored as 0–1) | ratio. goals: null = shown without a goal (not counted towards a stage).
// weight: how much the metric counts in each stage's score (out of 100). Score per metric = weight × min(1, current ÷ goal);
// a metric with no data yet scores 0. Weights are scaled to add up to 100, so they don't have to.
export const METRICS = [
  {
    key: "paidMembers", label: "Paid members", group: "Reach", format: "count",
    definition: `Users whose account was created on or after ${PAID_MEMBER_START_DATE} (India time) and who have a lifetime pass (premium/timestamp.json). Accounts created earlier are left out.`,
    goals: { pilot: 10000, stage2: 25000, platform: 75000 }, weight: 15,
  },
  {
    key: "engagedMau", label: "Engaged MAU", group: "Reach", format: "count",
    definition: "Paid members who opened the app and did at least one meaningful action (shade search, shade view, try-on, compare shades or product view) in the last 30 days. App opens alone don't count.",
    goals: { pilot: 4500, stage2: 12000, platform: 50000 }, weight: 15,
  },
  {
    key: "engagedDau", label: "Engaged DAU (30-day avg)", group: "Reach", format: "count",
    definition: "Engaged paid members per day, averaged over the last 30 days.",
    goals: { pilot: 675, stage2: 2400, platform: 10000 }, weight: 10,
  },
  {
    key: "stickiness", label: "Stickiness (DAU / MAU)", group: "Engagement", format: "pct",
    definition: "Engaged DAU (30-day average) ÷ engaged MAU.",
    goals: { pilot: 0.15, stage2: 0.2, platform: 0.2 }, weight: 10,
  },
  {
    key: "sessionsPerMau", label: "Sessions per MAU / month", group: "Engagement", format: "ratio",
    definition: "Sessions by paid members in the last 30 days ÷ engaged MAU. A session starts when the app is opened, or reopened after 30+ minutes away (the app's \"session-start\" step).",
    goals: { pilot: 4, stage2: 6, platform: 6 }, weight: 5,
  },
  {
    key: "m1", label: "Paid-member M1 retention", group: "Retention", format: "pct",
    definition: "Of paid members whose account was created in month X, the % who were engaged in month X+1. Uses the most recent cohort whose month X+1 is over.",
    goals: { pilot: 0.4, stage2: 0.45, platform: 0.45 }, weight: 10,
  },
  {
    key: "m1Opened", label: "M1 — opened the app at all (reference)", group: "Retention", format: "pct",
    definition: "Same cohort as M1 retention, but counts anyone who opened the app in month X+1 (any step), with or without a meaningful action. No goal — it shows how much of the M1 gap comes from the meaningful-action rule.",
    goals: null,
  },
  {
    key: "m3", label: "Paid-member M3 retention", group: "Retention", format: "pct",
    definition: "Of paid members whose account was created in month X, the % who were engaged in month X+3. Uses the most recent cohort whose month X+3 is over.",
    goals: { pilot: 0.25, stage2: 0.3, platform: 0.3 }, weight: 10,
  },
  {
    key: "monthlySearches", label: "Monthly product searches", group: "Purchase intent", format: "count",
    definition: "Shade / product searches made by paid members in the last 30 days. Recorded per member by the backend from when the update went live (the Product Analytics files only keep totals).",
    goals: { pilot: 20000, stage2: 75000, platform: 300000 }, weight: 10,
  },
  {
    key: "searchesPerUser", label: "Searches per engaged user", group: "Purchase intent", format: "ratio",
    definition: "Paid members' monthly searches ÷ engaged MAU.",
    goals: null,
  },
  {
    key: "allSearches", label: "Searches — all users (reference)", group: "Purchase intent", format: "count",
    definition: "Every user's shade / product searches in the last 30 days (Product Analytics totals, all brands) — not just paid members. No goal.",
    goals: null,
  },
  {
    key: "monthlyClickOuts", label: "Retailer click-outs — all users (reference)", group: "Purchase intent", format: "count",
    definition: "Every user's redirects to a retailer in the last 30 days (Product Analytics totals, all brands, searched or discovered) — not just paid members. No goal.",
    goals: null,
  },
  {
    key: "clickOutRate", label: "Click-out rate (users)", group: "Purchase intent", format: "pct",
    definition: "Engaged paid members who clicked out to a retailer at least once in the last 30 days ÷ engaged MAU. (User-based until sessions are logged — then it can become sessions with a click-out ÷ total sessions.)",
    goals: { pilot: 0.08, stage2: 0.1, platform: 0.1 }, weight: 10,
  },
  {
    key: "clickOutRateSessions", label: "Click-out rate (sessions, reference)", group: "Purchase intent", format: "pct",
    definition: "Paid members' sessions with at least one click-out to a retailer ÷ their sessions, last 30 days. No goal yet — once 30 days of sessions are in, move the click-out goals here if you want this to be the one that counts.",
    goals: null,
  },
  {
    key: "caseStudies", label: "Brand pilot case studies completed", group: "Proof", format: "count",
    definition: "Completed brand pilot case studies (entered by hand in app/lib/adsPlatformGoals.js).",
    goals: { pilot: 0, stage2: 2, platform: 5 }, weight: 5,
  },
];
