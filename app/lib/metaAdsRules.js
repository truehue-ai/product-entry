// "Today's actions" for the Meta Ads page: pure functions, no I/O. They take numbers and return advice.
// The page (app/meta-ads/TodayActions.jsx) builds the inputs from the cached Meta snapshot; tests are in
// metaAdsRules.test.mjs (run: node --test app/lib/metaAdsRules.test.mjs).
// Advice only: nothing here (or anywhere in the dashboard) changes budgets or statuses through the Meta API.

// ── November targets ──
export const NOV_REVENUE_TARGET = 80000;     // ₹, whole month
export const ROAS_TARGET = 1.48;             // on spend from PLAN_START onwards
export const MONTH_START = "2026-11-01";
export const PLAN_START = "2026-11-09";
export const MONTH_END = "2026-11-30";
export const NOV_SPEND_CAP = 65000;          // ₹, hard ceiling for the month
export const FALLBACK_REV_PER_PURCH = 259;   // ₹, only if there is no purchase value data

// The plan as made on 9 Nov — shown for reference only
export const PLAN_REFERENCE = { revenue: 69600, spendMax: 47000, cpaMax: 175, purchases: 270, purchasesPerDay: 12, novSpend: 59800 };

// ── rule thresholds ──  (SCALE_MAX_CPA is the computed target CPA, passed in as ctx.targetCPA)
export const GRADUATE_MAX_CPA = 195;         // ₹, for moving a test into A+ Winning
export const KEEP_MAX_CPA = 259;             // ₹, breakeven
export const MIN_PURCHASES = 3;
export const KILL_SPEND = 400;               // ₹ spent with 0 purchases
export const RAISE_PCT = 0.20;
export const CUT_PCT = 0.30;
export const MIN_DAYS_BETWEEN_CHANGES = 3;
export const MIN_BUDGET = 100;               // ₹/day; a cut below this becomes a pause
export const TEST_BUDGET = 250;              // ₹/day per test ad set
export const MIN_AGE_DAYS = 3;               // younger ad sets are TOO NEW

// ── the 3 campaigns ──  Put campaign IDs here once known; names are the fallback (case-insensitive).
export const CAMPAIGN_IDS = {
  winning: [],      // "A+ Winning": not created yet
  test: [],         // FY27_A+_Creative_Tests
  remarketing: [],  // FY27_Meta_Remarketing
};
// separators can be spaces, _ or - ("FY27_A+_Creative_Tests")
const NAME_MATCH = [["test", /creative[\s_-]*tests?/i], ["winning", /winning/i], ["remarketing", /remarketing/i]];
export const ROLE_LABEL = { winning: "A+ Winning", test: "A+ Creative Test", remarketing: "Remarketing" };

// -> "winning" | "test" | "remarketing" | null
export function campaignRole(id, name = "") {
  for (const [role, ids] of Object.entries(CAMPAIGN_IDS)) if (ids.includes(String(id))) return role;
  for (const [role, re] of NAME_MATCH) if (re.test(name)) return role;
  return null;
}

// ── small helpers ──
export const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysFrom = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); // b − a
export const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sun … 6 = Sat
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const roundTo10 = (v) => Math.round(v / 10) * 10;
export const cpaOf = (m) => (m && m.purchases > 0 ? m.spend / m.purchases : null);
export const roasOf = (m) => (m && m.spend > 0 && m.revenue != null ? m.revenue / m.spend : null);
export const inr = (v) => (v == null || !isFinite(v) ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const purch = (n) => `${n} purchase${n === 1 ? "" : "s"}`;
const ZERO = { spend: 0, purchases: 0, revenue: 0 };

// The 3 most recent complete days, excluding today
export const lastThreeDays = (today) => ({ from: addDays(today, -3), to: addDays(today, -1) });

// When the budget may next be changed. With no recorded change, the creation date counts as the last change.
export function changeWindow(unit, today) {
  const base = unit.lastBudgetChange || unit.createdDate || null;
  if (!base) return { daysSince: null, allowed: true, nextAllowed: null, basis: null };
  const daysSince = daysFrom(base, today);
  return { daysSince, allowed: daysSince >= MIN_DAYS_BETWEEN_CHANGES, nextAllowed: addDays(base, MIN_DAYS_BETWEEN_CHANGES), basis: unit.lastBudgetChange ? "change" : "created" };
}

const out = (decision, instruction, reason, extra = {}) => ({ decision, instruction, reason, newBudget: null, nextAllowed: null, ...extra });

// ── A+ Winning and Remarketing (an ABO ad set, or a CBO campaign as one unit) ──
// unit: { kind: "adset" | "campaign", budget, createdDate, lastBudgetChange, last3: { spend, purchases, revenue } }
// ctx:  { today, targetCPA }
export function decideScalable(unit, ctx) {
  const m = unit.last3 || ZERO;
  const cpa = cpaOf(m);
  const scaleMax = ctx.targetCPA;
  const w = changeWindow(unit, ctx.today);
  const what = unit.kind === "campaign" ? "campaign" : "ad set";
  const age = unit.createdDate ? daysFrom(unit.createdDate, ctx.today) : null;
  const base = { nextAllowed: w.nextAllowed };

  // 1. PAUSE: money spent, nothing back
  if (m.spend >= KILL_SPEND && m.purchases === 0) {
    return out("PAUSE", `Pause this ${what}`, `${inr(m.spend)} spent in the last 3 days with 0 purchases (limit ${inr(KILL_SPEND)})`, base);
  }
  // 6. TOO NEW
  if (age != null && age < MIN_AGE_DAYS) {
    return out("TOO_NEW", "No change", `Only ${age} day${age === 1 ? "" : "s"} old: judged from ${fmtDate(addDays(unit.createdDate, MIN_AGE_DAYS))}`,
      { nextAllowed: addDays(unit.createdDate, MIN_AGE_DAYS) });
  }
  if (m.purchases === 0) {
    return out("KEEP", "No change, check again tomorrow", `0 purchases on ${inr(m.spend)}: pause at ${inr(KILL_SPEND)} with 0 purchases`, base);
  }

  const wantScale = cpa <= scaleMax && m.purchases >= MIN_PURCHASES;
  const wantCut = cpa > KEEP_MAX_CPA;
  if (wantScale || wantCut) {
    // 3. WAIT
    if (!w.allowed) {
      const since = w.basis === "created" ? `created ${w.daysSince} day${w.daysSince === 1 ? "" : "s"} ago` : `budget changed ${w.daysSince} day${w.daysSince === 1 ? "" : "s"} ago`;
      return out("WAIT", `No change: next change allowed on ${fmtDate(w.nextAllowed)}`,
        `Would ${wantScale ? "raise" : "cut"} (3-day CPA ${inr(cpa)}, ${purch(m.purchases)}), but ${since}`, { ...base, wouldBe: wantScale ? "SCALE" : "CUT" });
    }
    // 2. SCALE
    if (wantScale) {
      const reason = `3-day CPA ${inr(cpa)} ≤ target ${inr(scaleMax)} with ${purch(m.purchases)}`;
      if (unit.budget == null) return out("SCALE", `Raise the daily budget by ${RAISE_PCT * 100}%`, reason, base);
      const nb = roundTo10(unit.budget * (1 + RAISE_PCT));
      return out("SCALE", `Raise from ${inr(unit.budget)} to ${inr(nb)} (+${inr(nb - unit.budget)})`, reason, { ...base, newBudget: nb });
    }
    // 5. CUT (or PAUSE below the minimum budget)
    const reason = `3-day CPA ${inr(cpa)} > breakeven ${inr(KEEP_MAX_CPA)} (${purch(m.purchases)})`;
    if (unit.budget == null) return out("CUT", `Cut the daily budget by ${CUT_PCT * 100}%`, reason, base);
    const nb = roundTo10(unit.budget * (1 - CUT_PCT));
    if (nb < MIN_BUDGET) {
      return out("PAUSE", `Pause this ${what}`, `${reason}; a ${CUT_PCT * 100}% cut would leave ${inr(nb)}/day, below the ${inr(MIN_BUDGET)} minimum`, base);
    }
    return out("CUT", `Cut from ${inr(unit.budget)} to ${inr(nb)} (−${inr(unit.budget - nb)})`, reason, { ...base, newBudget: nb });
  }

  // 4. KEEP
  const reason = cpa <= scaleMax
    ? `3-day CPA ${inr(cpa)} is on target but only ${purch(m.purchases)} (need ${MIN_PURCHASES})`
    : `3-day CPA ${inr(cpa)} is between target ${inr(scaleMax)} and breakeven ${inr(KEEP_MAX_CPA)}`;
  return out("KEEP", "No change, check again tomorrow", reason, base);
}

// An ad set inside a CBO campaign: its budget is the campaign's, so only the pause check applies here
export function decideCboAdSet(unit) {
  const m = unit.last3 || ZERO;
  if (m.spend >= KILL_SPEND && m.purchases === 0) {
    return out("PAUSE", "Pause this ad set", `${inr(m.spend)} spent in the last 3 days with 0 purchases (limit ${inr(KILL_SPEND)})`);
  }
  return out("KEEP", "No change: budget is set on the campaign", m.purchases ? `3-day CPA ${inr(cpaOf(m))} with ${purch(m.purchases)}` : `0 purchases on ${inr(m.spend)}`);
}

// ── A+ Creative Test ──
const GRADUATE_TEXT = `Move to A+ Winning: new ad set at ${inr(TEST_BUDGET)}/day. Pause this test.`;
// Sunday rule on a 3-day window
export function sundayTestRule(m) {
  const cpa = cpaOf(m);
  if (m.purchases >= MIN_PURCHASES && cpa <= GRADUATE_MAX_CPA) return out("GRADUATE", GRADUATE_TEXT, `3-day CPA ${inr(cpa)} ≤ ${inr(GRADUATE_MAX_CPA)} with ${purch(m.purchases)}`);
  // CPA 196–259, or a good CPA that doesn't have 3 purchases yet: one more day before deciding
  if (m.purchases > 0 && cpa <= KEEP_MAX_CPA) {
    return out("KEEP_ONE_MORE_DAY", "Keep one more day: final check Monday",
      cpa <= GRADUATE_MAX_CPA ? `3-day CPA ${inr(cpa)} but only ${purch(m.purchases)} (need ${MIN_PURCHASES} to graduate)` : `3-day CPA ${inr(cpa)} is between ${inr(GRADUATE_MAX_CPA)} and ${inr(KEEP_MAX_CPA)}`);
  }
  return out("PAUSE", "Pause this test", m.purchases ? `3-day CPA ${inr(cpa)} > ${inr(KEEP_MAX_CPA)}` : `0 purchases on ${inr(m.spend)} in the last 3 days`);
}
// Final check (Monday for Sunday's KEEPs, and any test still running after its week): graduate or pause
export function finalTestRule(m) {
  const cpa = cpaOf(m);
  if (m.purchases >= MIN_PURCHASES && cpa <= GRADUATE_MAX_CPA) return out("GRADUATE", GRADUATE_TEXT, `3-day CPA ${inr(cpa)} ≤ ${inr(GRADUATE_MAX_CPA)} with ${purch(m.purchases)}`);
  return out("PAUSE", "Pause this test", m.purchases ? `3-day CPA ${inr(cpa)} with ${purch(m.purchases)}: needs ≤ ${inr(GRADUATE_MAX_CPA)} with ${MIN_PURCHASES}+` : `0 purchases on ${inr(m.spend)} in the last 3 days`);
}

// unit: { createdDate, last3, sinceLaunch, sundayWindow? }   ctx: { today }
export function decideTest(unit, ctx) {
  const dow = weekday(ctx.today);
  const m = unit.last3 || ZERO;
  if (dow >= 3 && dow <= 6) { // Wed–Sat
    const wed = addDays(ctx.today, -(dow - 3));
    if (!unit.createdDate || unit.createdDate >= wed) {
      const s = unit.sinceLaunch || ZERO;
      if (s.spend >= KILL_SPEND && s.purchases === 0) return out("PAUSE", "Pause this test", `${inr(s.spend)} spent since launch with 0 purchases (limit ${inr(KILL_SPEND)})`);
      return out("KEEP_RUNNING", "Keep running: judged on Sunday", `${inr(s.spend)} spent since launch, ${purch(s.purchases)}`);
    }
    const r = finalTestRule(m);
    return { ...r, reason: `Test from an earlier week still running. ${r.reason}` };
  }
  if (dow === 0) return sundayTestRule(m);
  if (dow === 1 && unit.sundayWindow) {
    const sun = sundayTestRule(unit.sundayWindow);
    if (sun.decision === "KEEP_ONE_MORE_DAY") return finalTestRule(m);
    return { ...sun, reason: `Sunday's check: ${sun.reason}` };
  }
  return finalTestRule(m); // Monday without Sunday's window, or Tuesday
}

// ── spend guard ──
// Budget an action leaves running per day. Rows with countsBudget false (ad sets inside a CBO campaign) add nothing.
export function projectedBudget(r) {
  if (r.countsBudget === false) return 0;
  if (r.decision === "PAUSE") return 0;
  if ((r.decision === "SCALE" || r.decision === "CUT") && r.newBudget != null) return r.newBudget;
  if (r.decision === "GRADUATE") return TEST_BUDGET; // the test is paused, a new ₹250/day ad set starts in A+ Winning
  return r.budget ?? r.avgDailySpend ?? 0;
}
// If today's recommended budgets add up to more than the daily allowance, no SCALE today.
// extraBudget: budgets not on any row (e.g. a CBO test campaign's budget).
export function applySpendGuard(rows, spendAllowedPerDay, extraBudget = 0) {
  const total = rows.reduce((t, r) => t + projectedBudget(r), extraBudget);
  if (spendAllowedPerDay == null || total <= spendAllowedPerDay) return { rows, total, holding: false };
  const held = rows.map((r) => (r.decision === "SCALE"
    ? { ...r, decision: "KEEP", held: true, heldFrom: r.newBudget, newBudget: null, instruction: "No change: Holding raises: November spend allowance",
        reason: `${r.reason}. Today's recommended budgets total ${inr(total)}, more than the ${inr(spendAllowedPerDay)}/day allowed` }
    : r));
  return { rows: held, total: held.reduce((t, r) => t + projectedBudget(r), extraBudget), totalBeforeHold: total, holding: held.some((r) => r.held) };
}

// Order for the "Do today" list
export const ACTION_ORDER = ["PAUSE", "CUT", "GRADUATE", "SCALE"];
export const needsAction = (r) => ACTION_ORDER.includes(r.decision);
export const sortActions = (rows) => rows.filter(needsAction).sort((a, b) => ACTION_ORDER.indexOf(a.decision) - ACTION_ORDER.indexOf(b.decision));

// ── November targets ──
// daily: account totals per day [{ date, spend, purchases, revenue }] (Meta); today: "YYYY-MM-DD" (India time)
// actual: { date: Razorpay + App total } entered by hand. On those days the actual total REPLACES Meta's revenue
// (never added to it), so purchases Meta attributes late don't change the number.
// Revenue per purchase (→ target CPA) stays Meta-only: Meta's value ÷ Meta's purchases.
export function computeTargets({ today, daily, actual = {} }) {
  const yesterday = addDays(today, -1);
  const sum = (from, to) => {
    const t = { spend: 0, purchases: 0, revenue: 0, metaRevenue: 0, actualDays: 0, revenueReported: false };
    for (const d of daily) {
      if (d.date < from || d.date > to) continue;
      t.spend += d.spend || 0; t.purchases += d.purchases || 0;
      if (d.revenue != null) { t.metaRevenue += d.revenue; t.revenueReported = true; }
      const act = actual[d.date];
      if (act != null) { t.revenue += act; t.actualDays++; } else if (d.revenue != null) t.revenue += d.revenue;
    }
    return { ...t, roas: t.spend > 0 ? t.revenue / t.spend : null, cpa: cpaOf(t) };
  };
  const to = yesterday < MONTH_END ? yesterday : MONTH_END;
  const mtd = sum(MONTH_START, to);
  const plan = sum(PLAN_START, to);

  const hasValue = mtd.revenueReported && mtd.purchases > 0 && mtd.metaRevenue > 0;
  const revPerPurchase = hasValue ? mtd.metaRevenue / mtd.purchases : FALLBACK_REV_PER_PURCH;
  const targetCPA = revPerPurchase / ROAS_TARGET;

  const monthDays = daysFrom(MONTH_START, MONTH_END) + 1;
  const daysLeft = today > MONTH_END ? 0 : daysFrom(today < MONTH_START ? MONTH_START : today, MONTH_END) + 1; // including today
  const daysDone = Math.min(monthDays, Math.max(0, daysFrom(MONTH_START, today)));          // 1 Nov … yesterday
  const revenueNeeded = Math.max(0, NOV_REVENUE_TARGET - mtd.revenue);
  const spendRoom = Math.max(0, NOV_SPEND_CAP - mtd.spend);
  const spendAllowedRest = Math.min(revenueNeeded / ROAS_TARGET, spendRoom);
  const per = (v) => (daysLeft > 0 ? v / daysLeft : null);

  const pace = (NOV_REVENUE_TARGET * daysDone) / monthDays;
  const revenueBehind = mtd.revenue < pace;
  const roasBehind = plan.roas == null || plan.roas < ROAS_TARGET;
  const behind = [revenueBehind && "revenue", roasBehind && "ROAS"].filter(Boolean);

  return {
    today, yesterday, mtd, plan, revPerPurchase, revPerPurchaseFallback: !hasValue, targetCPA,
    revenueNeeded, spendRoom, spendAllowedRest, spendCapLimits: spendRoom < revenueNeeded / ROAS_TARGET,
    daysLeft, daysDone, monthDays, pace,
    perDay: { revenue: per(revenueNeeded), purchases: per(revenueNeeded / revPerPurchase), spend: per(spendAllowedRest) },
    status: behind.length ? "Behind" : "On track", behind,
  };
}
