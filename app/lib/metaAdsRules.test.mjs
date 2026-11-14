// Unit tests for the Today's actions rules. Run: node --test app/lib/metaAdsRules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideScalable, decideTest, decideCboAdSet, applySpendGuard, computeTargets, campaignRole, lastThreeDays, weekday,
  FALLBACK_REV_PER_PURCH, ROAS_TARGET, TEST_BUDGET,
} from "./metaAdsRules.js";

// Nov 2026: Sun 15, Mon 16, Fri 20, Sat 21, Sun 22, Mon 23
const FRI = "2026-11-20", SUN = "2026-11-22", MON = "2026-11-23", WED_LAUNCH = "2026-11-18";
const targetCPA = FALLBACK_REV_PER_PURCH / ROAS_TARGET; // ≈ ₹175
const ctx = (today) => ({ today, targetCPA });
const m = (spend, purchases, revenue = purchases * 259) => ({ spend, purchases, revenue });
const winning = (today, last3, { budget = 500, changedDaysAgo = null, ageDays = 30 } = {}) => ({
  kind: "adset", budget, last3,
  createdDate: new Date(Date.parse(`${today}T00:00:00Z`) - ageDays * 864e5).toISOString().slice(0, 10),
  lastBudgetChange: changedDaysAgo == null ? null : new Date(Date.parse(`${today}T00:00:00Z`) - changedDaysAgo * 864e5).toISOString().slice(0, 10),
});

test("calendar sanity", () => {
  assert.equal(weekday(FRI), 5);
  assert.equal(weekday(SUN), 0);
  assert.equal(weekday(MON), 1);
  assert.equal(weekday(WED_LAUNCH), 3);
  assert.deepEqual(lastThreeDays(MON), { from: "2026-11-20", to: "2026-11-22" });
  assert.ok(Math.abs(targetCPA - 175) < 0.5);
});

test("Winning: ₹1,200 / 7 purchases, last change 4 days ago → SCALE ₹500 → ₹600", () => {
  const r = decideScalable(winning(FRI, m(1200, 7), { changedDaysAgo: 4 }), ctx(FRI));
  assert.equal(r.decision, "SCALE");
  assert.equal(r.newBudget, 600);
  assert.match(r.instruction, /Raise from ₹500 to ₹600 \(\+₹100\)/);
});

test("Same ad set next day, CPA ₹150, changed 1 day ago → WAIT", () => {
  const r = decideScalable(winning(FRI, m(1050, 7), { budget: 600, changedDaysAgo: 1 }), ctx(FRI));
  assert.equal(r.decision, "WAIT");
  assert.equal(r.wouldBe, "SCALE");
  assert.equal(r.nextAllowed, "2026-11-21");
  assert.equal(r.newBudget, null);
});

test("Remarketing: ₹450 spend, 0 purchases → PAUSE", () => {
  const r = decideScalable(winning(FRI, m(450, 0), { changedDaysAgo: 1 }), ctx(FRI));
  assert.equal(r.decision, "PAUSE");
});

test("Winning: CPA ₹371, 7 purchases, last change 5 days ago → CUT ₹500 → ₹350", () => {
  const r = decideScalable(winning(FRI, m(2597, 7), { changedDaysAgo: 5 }), ctx(FRI));
  assert.equal(r.decision, "CUT");
  assert.equal(r.newBudget, 350);
});

test("Winning: CPA ₹220, 5 purchases → KEEP", () => {
  const r = decideScalable(winning(FRI, m(1100, 5), { changedDaysAgo: 10 }), ctx(FRI));
  assert.equal(r.decision, "KEEP");
});

test("Winning: CPA ₹160, 2 purchases → KEEP (fewer than 3 purchases)", () => {
  const r = decideScalable(winning(FRI, m(320, 2), { changedDaysAgo: 10 }), ctx(FRI));
  assert.equal(r.decision, "KEEP");
  assert.match(r.reason, /only 2 purchases/);
});

test("Cut that would land below ₹100 → PAUSE", () => {
  const r = decideScalable(winning(FRI, m(600, 2), { budget: 130, changedDaysAgo: 5 }), ctx(FRI)); // CPA ₹300 → 130 × 0.7 = 91 → ₹90
  assert.equal(r.decision, "PAUSE");
  assert.match(r.reason, /below the ₹100 minimum/);
});

test("Ad set under 3 days old → TOO NEW", () => {
  const r = decideScalable(winning(FRI, m(300, 3), { ageDays: 2 }), ctx(FRI));
  assert.equal(r.decision, "TOO_NEW");
});

test("Test, Friday: ₹450 spend since launch, 0 purchases → PAUSE", () => {
  const r = decideTest({ createdDate: WED_LAUNCH, last3: m(450, 0), sinceLaunch: m(450, 0) }, ctx(FRI));
  assert.equal(r.decision, "PAUSE");
});

test("Test, Friday: ₹300 spend, 1 purchase → keep running", () => {
  const r = decideTest({ createdDate: WED_LAUNCH, last3: m(300, 1), sinceLaunch: m(300, 1) }, ctx(FRI));
  assert.equal(r.decision, "KEEP_RUNNING");
});

test("Test, Sunday: ₹700 / 4 purchases (₹175) → GRADUATE", () => {
  const r = decideTest({ createdDate: WED_LAUNCH, last3: m(700, 4) }, ctx(SUN));
  assert.equal(r.decision, "GRADUATE");
  assert.match(r.instruction, /Move to A\+ Winning/);
});

test("Test, Sunday: ₹700 / 3 purchases (₹233) → KEEP ONE MORE DAY", () => {
  const r = decideTest({ createdDate: WED_LAUNCH, last3: m(700, 3) }, ctx(SUN));
  assert.equal(r.decision, "KEEP_ONE_MORE_DAY");
});

test("Same test Monday: ₹650 / 4 purchases (₹162.50) → GRADUATE", () => {
  const r = decideTest({ createdDate: WED_LAUNCH, sundayWindow: m(700, 3), last3: m(650, 4) }, ctx(MON));
  assert.equal(r.decision, "GRADUATE");
});

test("Same test Monday without 3 purchases → PAUSE", () => {
  const r = decideTest({ createdDate: WED_LAUNCH, sundayWindow: m(700, 3), last3: m(650, 2) }, ctx(MON));
  assert.equal(r.decision, "PAUSE");
});

test("Recommended budgets above the daily spend allowance → SCALE suppressed", () => {
  const scale = { ...decideScalable(winning(FRI, m(1200, 7), { changedDaysAgo: 4 }), ctx(FRI)), budget: 500 };
  const keep = { ...decideScalable(winning(FRI, m(1100, 5), { budget: 1500, changedDaysAgo: 10 }), ctx(FRI)), budget: 1500 };
  const { rows, holding, totalBeforeHold } = applySpendGuard([scale, keep], 2000);
  assert.equal(totalBeforeHold, 2100); // 600 + 1500
  assert.equal(holding, true);
  assert.equal(rows[0].decision, "KEEP");
  assert.equal(rows[0].held, true);
  assert.match(rows[0].instruction, /Holding raises: November spend allowance/);
  // within the allowance, the raise stays
  assert.equal(applySpendGuard([scale, keep], 2500).rows[0].decision, "SCALE");
});

test("Spend guard counts PAUSE as 0, GRADUATE as a new ₹250 ad set, CBO ad sets not at all", () => {
  const { total } = applySpendGuard([
    { decision: "PAUSE", budget: 800 },
    { decision: "GRADUATE", budget: 250 },
    { decision: "KEEP", budget: 900, countsBudget: false },
  ], 10000);
  assert.equal(total, TEST_BUDGET);
});

test("CBO ad set: only the pause check", () => {
  assert.equal(decideCboAdSet({ last3: m(500, 0) }).decision, "PAUSE");
  assert.equal(decideCboAdSet({ last3: m(500, 1) }).decision, "KEEP");
});

test("Campaign roles by name", () => {
  assert.equal(campaignRole("1", "A+ Winning"), "winning");
  assert.equal(campaignRole("2", "a+ creative TEST"), "test");
  assert.equal(campaignRole("5", "FY27_A+_Creative_Tests"), "test");
  assert.equal(campaignRole("3", "FY27_Meta_Remarketing"), "remarketing");
  assert.equal(campaignRole("4", "Old prospecting"), null);
});

test("Targets: revenue per purchase, target CPA, allowances", () => {
  const daily = [];
  for (let d = 1; d <= 13; d++) daily.push({ date: `2026-11-${String(d).padStart(2, "0")}`, spend: 2000, purchases: 10, revenue: 2600 });
  const t = computeTargets({ today: "2026-11-14", daily });
  assert.equal(t.mtd.spend, 26000);
  assert.equal(t.mtd.revenue, 33800);
  assert.equal(t.revPerPurchase, 260);
  assert.ok(Math.abs(t.targetCPA - 260 / 1.48) < 1e-9);
  assert.equal(t.revenueNeeded, 46200);
  assert.equal(t.daysLeft, 17);
  assert.ok(Math.abs(t.spendAllowedRest - 46200 / 1.48) < 1e-6); // below the ₹39,000 left under the cap
  assert.equal(t.status, "Behind"); // ROAS 1.30 < 1.48, and 33,800 < pace 34,667
  assert.deepEqual(t.behind, ["revenue", "ROAS"]);
  // no purchase value → fallback ₹259
  assert.equal(computeTargets({ today: "2026-11-14", daily: [{ date: "2026-11-10", spend: 100, purchases: 1, revenue: null }] }).revPerPurchase, 259);
});

test("Targets: entered actual revenue replaces Meta's revenue on that day, never adds to it", () => {
  const daily = [
    { date: "2026-11-10", spend: 1000, purchases: 4, revenue: 1000 },
    { date: "2026-11-11", spend: 1000, purchases: 4, revenue: 1000 },
  ];
  const actual = { "2026-11-10": 2000 };
  const before = computeTargets({ today: "2026-11-14", daily, actual });
  assert.equal(before.mtd.revenue, 3000);          // 2000 actual + 1000 Meta (11 Nov not entered)
  assert.equal(before.mtd.actualDays, 1);
  // Meta later attributes 600 more to 10 Nov: the total doesn't move, the entered amount still wins
  daily[0].revenue = 1600;
  const after = computeTargets({ today: "2026-11-14", daily, actual });
  assert.equal(after.mtd.revenue, 3000);
  assert.equal(after.plan.roas, 1.5);
  // revenue per purchase (target CPA) stays Meta-only: 2600 / 8
  assert.equal(after.revPerPurchase, 325);
});

test("Targets: spend cap limits the allowance", () => {
  const t = computeTargets({ today: "2026-11-20", daily: [{ date: "2026-11-10", spend: 60000, purchases: 10, revenue: 3000 }] });
  assert.equal(t.spendAllowedRest, 5000);
  assert.equal(t.spendCapLimits, true);
});
