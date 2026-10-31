// Ads Platform Metrics calculations — plain functions over permanent/analytics/ads_platform_metrics.json, seeded
// once by the dashboard's Rebuild (/api/analytics/ads-platform) and then kept up to date live by the backend
// (app.py). No UI here, so other pages (e.g. click-outs) can reuse them.
//
// Snapshot: { generatedAt, seededAt?, today, userCount, perUserSince, users: [ { id, c, pass, skin, under, e, a, k, sr, ns, nq } ], searches }
//   seededAt  set by a full Rebuild; missing = the backend started the file itself, so there's no history before it
//   c     account creation day from user_info.json createdAt ("YYYY-MM-DD", India time) or null
//   pass  premium/timestamp.json "type" (lowercase) or null
//   e     sorted days with at least one meaningful step (MEANINGFUL_STEPS)
//   a     sorted days with any step at all
//   k     sorted days they clicked out to a retailer (Product Analytics view_users), if any
//   sr    { day: searches } that user made — recorded live only, from perUserSince.searches
//   ns    { day: sessions } ("session-start" steps); nq { day: [session ids with a click-out] } — only once the
//         app sends them (perUserSince.sessions)
//   searches { byDay: { day: searches }, clickOutsByDay: { day: retailer redirects }, brands, failedBrands, since? }
//            or { error } — ALL users (the Product Analytics totals); since = live counting only started that day
// EVERY metric is about paid members (lifetime pass, account created from PAID_MEMBER_START_DATE) — only the
// rows marked "all users" use everyone. // Only number (phone) users are in it — web-funnel guest accounts have no step timestamps and are left out.
// Nothing is estimated: a metric with no real data comes back as value null with a note.

import {
  PAID_MEMBER_START_DATE, PAID_PASS_TYPE, METRICS, STAGES, CASE_STUDIES_COMPLETED,
} from "./adsPlatformGoals";

// ── days / months ("YYYY-MM-DD" / "YYYY-MM", India time) ──
export const istDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (s, n) => new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
export const addMonths = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const monthEnd = (m) => addDays(`${addMonths(m, 1)}-01`, -1);
export const fmtMonth = (m) => new Date(toUTC(`${m}-01`)).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", year: "numeric" });
export const fmtDate = (s) => new Date(toUTC(s)).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

const NOT_TRACKED = {
  sessions: "Waiting for the app to send a \"session-start\" step (and session_id on click-outs).",
};

// "member" | "other" (another pass type) | "noDate" (no createdAt) | "beforeStart" | null (no pass)
export function paidStatus(u, start = PAID_MEMBER_START_DATE) {
  if (!u.pass) return null;
  if (!u.c) return "noDate";
  if (u.c < start) return "beforeStart";
  return u.pass === PAID_PASS_TYPE ? "member" : "other";
}

const engagedBetween = (u, from, to) => (u.e || []).some((d) => d >= from && d <= to);
const openedBetween = (u, from, to) => (u.a || []).some((d) => d >= from && d <= to);

export function formatMetric(value, format) {
  if (value == null) return "—";
  if (format === "pct") return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
  if (format === "ratio") return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

// Skin tone / undertone labels as stored in user_info, tidied for the audience split
const TONE_ORDER = ["F", "FM", "MD", "D1", "D2", "VD"];
const skinLabel = (v) => { const s = String(v ?? "").trim(); return s ? s.toUpperCase() : "Not set"; };
const undertoneLabel = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "Not set";
  if (s === "w" || s.startsWith("warm")) return "Warm";
  if (s === "c" || s.startsWith("cool")) return "Cool";
  if (s === "n" || s.startsWith("neutral")) return "Neutral";
  return String(v).trim();
};
function split(users, labelOf, order = []) {
  const counts = {};
  for (const u of users) { const l = labelOf(u); counts[l] = (counts[l] || 0) + 1; }
  const rank = (l) => (l === "Not set" ? 1e9 : order.includes(l) ? order.indexOf(l) : order.length);
  return Object.entries(counts).map(([label, count]) => ({ label, count }))
    .sort((a, b) => rank(a.label) - rank(b.label) || b.count - a.count);
}

// asOf = the day the "last 30 days" end on (normally today, India time)
export function computeAdsPlatformMetrics(snap, asOf = istDay()) {
  const users = snap?.users || [];
  const from30 = addDays(asOf, -29);
  const startMonth = PAID_MEMBER_START_DATE.slice(0, 7);
  const asOfMonth = asOf.slice(0, 7);
  const in30 = (d) => d >= from30 && d <= asOf;
  const sum30 = (byDay) => Object.entries(byDay || {}).reduce((a, [d, n]) => (in30(d) ? a + n : a), 0);
  const waitNote = (since, what) => since
    ? `Counting ${what} since ${fmtDate(since)} — shown from ${fmtDate(addDays(since, 29))} (needs a full 30 days).`
    : null;

  // ── paid members (everything below is about them) ──
  const paid = { members: [], other: {}, noDate: 0, beforeStart: 0 };
  for (const u of users) {
    const s = paidStatus(u);
    if (s === "member") paid.members.push(u);
    else if (s === "other") paid.other[u.pass] = (paid.other[u.pass] || 0) + 1;
    else if (s === "noDate") paid.noDate++;
    else if (s === "beforeStart") paid.beforeStart++;
  }
  const members = paid.members;

  // ── engagement, last 30 days ──
  const engaged = members.filter((u) => engagedBetween(u, from30, asOf));
  const mau = engaged.length;
  let dayTotal = 0;
  for (const u of members) for (const d of u.e || []) if (in30(d)) dayTotal++;
  const avgDau = dayTotal / 30;
  const opened30 = members.filter((u) => openedBetween(u, from30, asOf)).length;

  // ── searches & click-outs ──
  const since = snap?.perUserSince || {};
  const sr = snap?.searches;
  let allNote = "";
  if (!sr || sr.error) allNote = `Couldn't load Product Analytics${sr?.error ? `: ${sr.error}` : ""}. Rebuild to try again.`;
  else if (sr.failedBrands?.length) allNote = `${sr.failedBrands.length} of ${sr.brands} brands failed to load, so the total would be incomplete. Rebuild to try again.`;
  else if (sr.since && sr.since > from30) allNote = `Only counted live since ${fmtDate(sr.since)} — Rebuild once to load the history.`;
  const allSearches = allNote ? null : sum30(sr.byDay);
  const allClickOuts = !allNote && sr.clickOutsByDay ? sum30(sr.clickOutsByDay) : null;
  const allClickNote = allNote || (sr && !sr.clickOutsByDay ? "Rebuild once to load click-outs." : "");

  // members' own searches: only recorded live (the Product Analytics files don't say who searched how often)
  let memberSearches = null;
  let searchNote = "Starts counting once the updated backend is live (it records who searched).";
  if (since.searches) {
    if (since.searches > from30) searchNote = waitNote(since.searches, "members' searches");
    else { memberSearches = members.reduce((a, u) => a + sum30(u.sr), 0); searchNote = ""; }
  }
  const clickedUsers = engaged.filter((u) => (u.k || []).some(in30)).length;
  const clickRate = allClickNote || !sr?.hasClickers
    ? { value: null, note: allClickNote || "Rebuild once to load who clicked out." }
    : { value: mau ? clickedUsers / mau : null, note: mau ? `${clickedUsers.toLocaleString()} of ${mau.toLocaleString()} engaged members` : "No engaged members." };

  // ── sessions (only once the app sends them; never shown for a partial 30 days) ──
  let sessionsPerMau = { value: null, notTracked: true, note: NOT_TRACKED.sessions };
  let sessionClickRate = { value: null, notTracked: true, note: NOT_TRACKED.sessions };
  if (since.sessions) {
    if (since.sessions > from30) {
      const note = waitNote(since.sessions, "sessions");
      sessionsPerMau = { value: null, note };
      sessionClickRate = { value: null, note };
    } else {
      const total = members.reduce((a, u) => a + sum30(u.ns), 0);
      const clicked = members.reduce((a, u) => a + Object.entries(u.nq || {}).reduce((b, [d, ids]) => (in30(d) ? b + ids.length : b), 0), 0);
      sessionsPerMau = { value: mau ? total / mau : null, note: `${total.toLocaleString()} sessions by paid members` };
      sessionClickRate = { value: total ? clicked / total : null, note: `${clicked.toLocaleString()} of ${total.toLocaleString()} sessions` };
    }
  }

  // ── retention cohorts (account creation month) ──
  const cohorts = [];
  for (let m = startMonth; m <= asOfMonth; m = addMonths(m, 1)) {
    const list = members.filter((u) => u.c.slice(0, 7) === m);
    const row = { month: m, size: list.length };
    for (const k of [1, 2, 3]) {
      const target = addMonths(m, k);
      const over = monthEnd(target) < asOf; // the whole month has happened
      row[`m${k}`] = over && list.length
        ? list.filter((u) => engagedBetween(u, `${target}-01`, monthEnd(target))).length / list.length
        : null;
      if (k === 1) {
        row.m1Opened = over && list.length
          ? list.filter((u) => openedBetween(u, `${target}-01`, monthEnd(target))).length / list.length
          : null;
      }
    }
    cohorts.push(row);
  }
  const latest = (k) => [...cohorts].reverse().find((c) => c[k] != null);
  const m1c = latest("m1"), m3c = latest("m3");

  const values = {
    paidMembers: { value: members.length },
    engagedMau: { value: mau, note: members.length ? `of ${members.length.toLocaleString()} paid members (${opened30.toLocaleString()} opened the app)` : "" },
    engagedDau: { value: avgDau },
    stickiness: { value: mau ? avgDau / mau : null, note: mau ? "" : "No engaged members in the last 30 days." },
    sessionsPerMau,
    clickOutRateSessions: sessionClickRate,
    m1: m1c ? { value: m1c.m1, note: `${fmtMonth(m1c.month)} cohort (${m1c.size})` }
      : { value: null, note: "No cohort has a finished month X+1 yet." },
    m1Opened: !m1c ? { value: null, note: "No cohort has a finished month X+1 yet." }
      : !members.some((u) => Array.isArray(u.a)) ? { value: null, note: "Rebuild to see this (the current snapshot doesn't have app opens)." }
      : { value: m1c.m1Opened, note: `${fmtMonth(m1c.month)} cohort (${m1c.size})` },
    m3: m3c ? { value: m3c.m3, note: `${fmtMonth(m3c.month)} cohort (${m3c.size})` }
      : { value: null, note: "No cohort has a finished month X+3 yet." },
    monthlySearches: { value: memberSearches, note: searchNote },
    searchesPerUser: { value: memberSearches != null && mau ? memberSearches / mau : null, note: memberSearches == null ? searchNote : mau ? "" : "No engaged members." },
    allSearches: { value: allSearches, note: allNote },
    monthlyClickOuts: { value: allClickOuts, note: allClickNote },
    clickOutRate: clickRate,
    caseStudies: { value: CASE_STUDIES_COMPLETED, note: "Entered by hand" },
  };

  // ── goals ──
  const rows = METRICS.map((m) => {
    const v = values[m.key] || { value: null };
    const met = {};
    for (const s of STAGES) {
      const goal = m.goals?.[s.key];
      met[s.key] = goal == null ? null : v.value != null && v.value >= goal;
    }
    return { ...m, ...v, met };
  });
  const stages = STAGES.map((s) => {
    const withGoal = rows.filter((r) => r.met[s.key] != null);
    const met = withGoal.filter((r) => r.met[s.key]).length;
    return { ...s, met, total: withGoal.length, done: withGoal.length > 0 && met === withGoal.length };
  });
  const currentStage = [...stages].reverse().find((s) => s.done)?.label || "Pre-pilot";

  // ── audience (engaged paid members) ──
  const audience = {
    skinTone: split(engaged, (u) => skinLabel(u.skin), TONE_ORDER),
    undertone: split(engaged, (u) => undertoneLabel(u.under), ["Warm", "Cool", "Neutral"]),
  };
  const audienceNotTracked = [
    { label: "City", note: "Not stored for users — needs city captured at signup (or from AppsFlyer)." },
    { label: "Age band", note: "Not stored for users — needs an age or date-of-birth field." },
  ];

  // ── monthly trend from the start month ──
  const trend = [];
  for (let m = startMonth; m <= asOfMonth; m = addMonths(m, 1)) {
    const end = monthEnd(m) < asOf ? monthEnd(m) : asOf;
    trend.push({
      month: m,
      partial: m === asOfMonth,
      engagedMau: members.filter((u) => engagedBetween(u, `${m}-01`, end)).length,
      paidMembers: members.filter((u) => u.c <= end).length,
    });
  }

  return {
    asOf, from30, startDate: PAID_MEMBER_START_DATE, scannedUsers: snap?.userCount ?? users.length,
    needsRebuild: !snap?.seededAt,
    rows, stages, currentStage, cohorts, comeBack: comeBack(members, asOf), audience, audienceNotTracked, trend,
    paid: { members: members.length, engaged: mau, other: paid.other, noDate: paid.noDate, beforeStart: paid.beforeStart },
  };
}

// "Do they come back?" — the same calculation as User Metrics' "Do new users come back?", for paid members:
// weekly signup cohorts (Mon–Sun, last 10 weeks); back within N days = opened the app (any step) on any day
// after signup up to N days later; only accounts at least N days old count for that window.
export const COME_BACK_WINDOWS = [[1, "Next day"], [3, "3 days"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"]];
export function comeBack(members, asOf = istDay()) {
  const diff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
  const weekStart = (d) => addDays(d, -((new Date(toUTC(d)).getUTCDay() + 6) % 7));
  const groups = new Map();
  for (const u of members) {
    if (!u.c) continue;
    const w = weekStart(u.c);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(u);
  }
  const weeks = [...groups.keys()].sort().reverse().slice(0, 10).map((w) => {
    const list = groups.get(w);
    const cells = COME_BACK_WINDOWS.map(([n]) => {
      const eligible = list.filter((u) => diff(u.c, asOf) >= n);
      if (!eligible.length) return null;
      const back = eligible.filter((u) => (u.a || []).some((d) => d > u.c && d <= addDays(u.c, n))).length;
      return { n, back, of: eligible.length, pct: back / eligible.length };
    });
    return { week: w, weekEnd: addDays(w, 6), size: list.length, cells };
  });
  const overall = COME_BACK_WINDOWS.map(([n], i) => {
    let back = 0, of = 0;
    weeks.forEach((w) => { const c = w.cells[i]; if (c) { back += c.back; of += c.of; } });
    return { n, back, of, pct: of ? back / of : null };
  });
  return { weeks, overall };
}
