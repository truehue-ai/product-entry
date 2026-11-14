"use client";

// "Today's actions" on /meta-ads: what to do in Ads Manager today, and how November is tracking.
// Reads only the cached snapshot (no extra Meta calls). The rules live in app/lib/metaAdsRules.js.
// Advice only: nothing here changes budgets or statuses.

import { useCallback, useEffect, useMemo, useState } from "react";
import { GL, C1, GOOD, BAD, WARN, istToday, fmtDay, Section, Empty } from "./shared";
import * as R from "../lib/metaAdsRules";

const LIVE = new Set(["ACTIVE", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO"]);
const isLive = (o) => LIVE.has(o?.effective_status);
const ROLES = ["winning", "test", "remarketing"];
const GREY = "#6b7280", ORANGE = "#ea580c";
const BADGE = {
  SCALE: [GOOD, "SCALE"], KEEP: [WARN, "KEEP"], KEEP_RUNNING: [WARN, "KEEP RUNNING"], KEEP_ONE_MORE_DAY: [WARN, "KEEP ONE MORE DAY"],
  WAIT: [GREY, "WAIT"], CUT: [ORANGE, "CUT"], PAUSE: [BAD, "PAUSE"], GRADUATE: [C1, "GRADUATE"], TOO_NEW: [GREY, "TOO NEW"],
  "TO DO": [C1, "TO DO"], SUGGESTION: [C1, "SUGGESTION"],
};
const TASKS = [
  [[2], "Tuesday", "Prepare 3 new creatives (2 videos, 1 static)"],
  [[3], "Wednesday", `Launch 3 test ad sets in A+ Creative Test at ₹${R.TEST_BUDGET}/day each`],
  [[5, 6], "Friday / Saturday", "Kill check on this week's tests"],
  [[0], "Sunday", "Graduate or pause tests"],
  [[1], "Monday", "Final check on KEEP tests"],
];
const istDayOf = (iso) => (iso ? new Date(Date.parse(iso) + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : null);

// ── snapshot -> rule inputs -> decisions ──
// actualDays: { date: { razorpay, app } } entered by hand on this page
function buildActions(snap, today, actualDays = {}) {
  const st = snap.structure;
  if (!st) return { notice: "Ad set budgets and statuses aren't in the cached data yet. Click ↻ Refresh now to load them." };
  if (st.error) return { notice: `Couldn't load campaigns and ad sets on the last refresh: ${st.error}` };

  const l3 = R.lastThreeDays(today);
  const dow = R.weekday(today);
  const notes = [];
  const missing = [];

  // per ad set per day, and account totals per day: pixel purchases (fb_pixel_purchase) and their value
  const per = {}, account = {};
  let noPixelFields = false, unmappedSpend = 0;
  for (const r of snap.daily) {
    if (r.pxPurchases === undefined) noPixelFields = true;
    const p = r.pxPurchases ?? r.purchases ?? 0;
    const v = r.pxRevenue !== undefined ? r.pxRevenue : r.revenue;
    const a = (account[r.date] ||= { date: r.date, spend: 0, purchases: 0, revenue: null });
    a.spend += r.spend || 0; a.purchases += p; if (v != null) a.revenue = (a.revenue ?? 0) + v;
    const asid = snap.ads?.[r.ad_id]?.adset_id;
    if (!asid) { if (r.date >= l3.from && r.date <= l3.to) unmappedSpend += r.spend || 0; continue; }
    const d = ((per[asid] ||= {})[r.date] ||= { spend: 0, purchases: 0, revenue: 0 });
    d.spend += r.spend || 0; d.purchases += p; d.revenue += v || 0;
  }
  const win = (ids, from, to) => {
    const t = { spend: 0, purchases: 0, revenue: 0, days: 0 };
    for (const id of ids) for (const [d, x] of Object.entries(per[id] || {})) {
      if (d < from || d > to) continue;
      t.spend += x.spend; t.purchases += x.purchases; t.revenue += x.revenue;
    }
    return t;
  };
  const withM = (m) => ({ ...m, cpa: R.cpaOf(m), roas: R.roasOf(m) });

  // entered Razorpay + App totals replace Meta's revenue on those days (never added to it)
  const actual = Object.fromEntries(Object.entries(actualDays).map(([d, e]) => [d, (e.razorpay || 0) + (e.app || 0)]));
  const targets = R.computeTargets({ today, daily: Object.values(account), actual });
  const ctx = { today, targetCPA: targets.targetCPA };

  const rows = [], others = [], campaignsByRole = { winning: [], test: [], remarketing: [] };
  let extraBudget = 0;
  for (const [cid, c] of Object.entries(st.campaigns)) {
    const role = R.campaignRole(cid, c.name);
    const sets = Object.entries(st.adsets).filter(([, a]) => a.campaign_id === cid && isLive(a));
    if (!role) {
      if (isLive(c)) others.push({ id: cid, name: c.name, last3: withM(win(sets.map(([id]) => id), l3.from, l3.to)) });
      continue;
    }
    const cbo = c.daily_budget != null || c.lifetime_budget != null;
    campaignsByRole[role].push({ id: cid, name: c.name, live: isLive(c), cbo, budget: c.daily_budget, lifetime: c.lifetime_budget });
    if (!isLive(c)) continue;

    const common = (id, a) => {
      const last3 = win([id], l3.from, l3.to);
      if ((!a.created || a.created < l3.from) && !Object.keys(per[id] || {}).some((d) => d >= l3.from && d <= l3.to)) missing.push(`${a.name}: no delivery rows in the last 3 days`);
      if (!a.created) missing.push(`${a.name}: created date missing`);
      return { id, role, name: a.name, campaign: c.name, created: a.created, last3: withM(last3), avgDailySpend: last3.spend / 3 };
    };

    if (role === "test") {
      if (cbo) { extraBudget += c.daily_budget || 0; notes.push(`${c.name} uses a campaign budget (CBO), not ₹${R.TEST_BUDGET}/day per test ad set.`); }
      for (const [id, a] of sets) {
        const base = common(id, a);
        const unit = {
          createdDate: a.created, last3: base.last3,
          sinceLaunch: win([id], a.created || l3.from, snap.until),
          sundayWindow: dow === 1 ? win([id], R.addDays(today, -4), R.addDays(today, -2)) : null,
        };
        if (!cbo && a.daily_budget == null) missing.push(`${a.name}: no daily budget found${a.lifetime_budget ? " (lifetime budget)" : ""}`);
        rows.push({ ...base, level: cbo ? "campaign" : "adset", budget: cbo ? c.daily_budget : a.daily_budget, countsBudget: !cbo, sinceLaunch: withM(unit.sinceLaunch), ...R.decideTest(unit, ctx) });
      }
      continue;
    }

    if (cbo) {
      // budget lives on the campaign: one budget decision for the campaign, and a pause check per ad set
      const ids = sets.map(([id]) => id);
      if (c.daily_budget == null) missing.push(`${c.name}: lifetime campaign budget, so the instruction is a % change`);
      const unit = { kind: "campaign", budget: c.daily_budget, createdDate: c.created, lastBudgetChange: st.lastBudgetChange?.[cid] || null, last3: win(ids, l3.from, l3.to) };
      // with a single ad set the campaign row covers it (same spend, same pause check), so it isn't listed twice
      rows.push({ id: cid, role, name: c.name, campaign: c.name, isCampaign: true, created: c.created, level: "campaign", budget: c.daily_budget,
        adsetNote: sets.length === 1 ? `1 ad set: ${sets[0][1].name}` : `${sets.length} ad sets, listed below`,
        countsBudget: true, last3: withM(unit.last3), avgDailySpend: unit.last3.spend / 3, lastBudgetChange: unit.lastBudgetChange, ...R.decideScalable(unit, ctx) });
      if (sets.length > 1) for (const [id, a] of sets) {
        const base = common(id, a);
        rows.push({ ...base, level: "campaign", budget: c.daily_budget, countsBudget: false, sub: true, ...R.decideCboAdSet({ last3: base.last3 }) });
      }
    } else {
      for (const [id, a] of sets) {
        const base = common(id, a);
        if (a.daily_budget == null) missing.push(`${a.name}: no daily budget found${a.lifetime_budget ? " (lifetime budget)" : ""}, so the instruction is a % change`);
        const unit = { kind: "adset", budget: a.daily_budget, createdDate: a.created, lastBudgetChange: st.lastBudgetChange?.[id] || null, last3: base.last3 };
        rows.push({ ...base, level: "adset", budget: a.daily_budget, countsBudget: true, lastBudgetChange: unit.lastBudgetChange, ...R.decideScalable(unit, ctx) });
      }
    }
  }
  for (const role of ["test", "remarketing"]) if (!campaignsByRole[role].length) missing.push(`No campaign found for ${R.ROLE_LABEL[role]}. Check the name, or add its ID to CAMPAIGN_IDS in app/lib/metaAdsRules.js`);
  // No A+ Winning campaign yet: a graduating test needs it created first
  const noWinning = !campaignsByRole.winning.some((c) => c.live);
  if (noWinning) {
    for (const r of rows) {
      if (r.decision === "GRADUATE") r.instruction = `Create the A+ Winning campaign (none exists yet), then add this creative there as a new ad set at ₹${R.TEST_BUDGET}/day. Pause this test.`;
    }
  }

  const guard = R.applySpendGuard(rows, targets.perDay.spend, extraBudget);
  if (noPixelFields) notes.push("This snapshot was fetched before pixel purchases were stored separately, so purchases here use Meta's general purchase count. Refresh now to use fb_pixel_purchase.");
  if (unmappedSpend > 0) missing.push(`${R.inr(unmappedSpend)} of spend in the last 3 days can't be matched to an ad set (fetched before ad set IDs were stored). Refresh now`);
  if (st.activityError) notes.push(`Activity log not readable (${st.activityError}). Last budget changes come from this dashboard's own daily budget history${st.budgetHistorySince ? ` (since ${fmtDay(st.budgetHistorySince)})` : ""}. Where no change is recorded, the ad set's created date counts as the last change.`);
  else notes.push("Last budget change: from the ad account activity log (last 30 days) and this dashboard's budget history. Where none is recorded, the created date counts as the last change.");

  return { l3, dow, targets, rows: guard.rows, guard, others, campaignsByRole, missing: [...new Set(missing)], notes, structureAt: st.fetchedAt };
}

export default function TodayActions({ snap, money, actualDays, user }) {
  const today = istToday();
  const a = useMemo(() => buildActions(snap, today, actualDays), [snap, today, actualDays]);
  const fetchedDay = istDayOf(snap.fetchedAt);

  if (a.notice) {
    return <Section title="Today's actions"><Empty>{a.notice}</Empty></Section>;
  }
  const { targets: t, l3 } = a;
  const stale = fetchedDay && fetchedDay < today;
  const noWinning = !a.campaignsByRole.winning.some((c) => c.live);

  return (
    <Section title="Today's actions" sub={`Based on the last 3 days (${fmtDay(l3.from)} – ${fmtDay(l3.to)}). Advice only: nothing changes automatically.`}>
      {stale && <Banner>Data is from {fmtDay(fetchedDay)}. Click ↻ Refresh now first.</Banner>}
      <TodayTask dow={a.dow} />
      <TargetsCard t={t} money={money} />
      <DoToday rows={R.sortActions(a.rows)} others={a.others} money={money} noWinning={noWinning} today={today} user={user} />
      {a.guard.holding && <Banner>Budget increases are on hold: total budgets would go over the {money(t.perDay.spend)}/day allowed.</Banner>}
      {ROLES.map((role) => (
        <CampaignBlock key={role} role={role} campaigns={a.campaignsByRole[role]} rows={a.rows.filter((r) => r.role === role)} money={money} noWinning={noWinning} />
      ))}
      <details style={{ fontSize: 12, color: "#7b6b6b" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Data notes{a.missing.length ? ` · ${a.missing.length} missing` : ""}</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {a.missing.map((m) => <div key={m} style={{ color: WARN }}>• {m}</div>)}
          {a.notes.map((m) => <div key={m}>• {m}</div>)}
          <div>• Budgets and statuses as of {a.structureAt ? new Date(a.structureAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "the last refresh"}.</div>
        </div>
      </details>
    </Section>
  );
}

const Banner = ({ children }) => (
  <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e", background: "rgba(254,243,199,0.8)", borderRadius: 10, padding: "8px 12px" }}>{children}</div>
);

// Today's weekly task, plus the week at a glance
function TodayTask({ dow }) {
  const task = TASKS.find(([days]) => days.includes(dow));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "rgba(42,120,214,0.08)", borderRadius: 12, padding: "10px 14px" }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: C1 }}>{R.DAY_NAMES[dow]}:</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{task ? task[2] : "No weekly task today"}</span>
      <span title={TASKS.map(([, d, x]) => `${d}: ${x}`).join("\n")} style={{ fontSize: 12, color: "#7b6b6b", cursor: "help", marginLeft: "auto" }}>
        Week: Tue creatives · Wed launch · Fri/Sat kill check · Sun graduate · Mon final check
      </span>
    </div>
  );
}

function TargetsCard({ t, money }) {
  const revPct = Math.min(100, (t.mtd.revenue / R.NOV_REVENUE_TARGET) * 100);
  const pacePct = Math.min(100, (t.pace / R.NOV_REVENUE_TARGET) * 100);
  const spendPct = Math.min(100, (t.mtd.spend / R.NOV_SPEND_CAP) * 100);
  const onTrack = t.status === "On track";
  const box = { background: "rgba(255,255,255,0.55)", borderRadius: 14, padding: "12px 14px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 };
  const lbl = { fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.05em" };
  const big = { fontSize: 22, fontWeight: 800, color: "#1a0a09", overflowWrap: "anywhere" };
  const small = { fontSize: 12, color: "#7b6b6b" };
  const of = (v) => <span style={{ fontSize: 13, color: "#7b6b6b", fontWeight: 600 }}> / {v}</span>;
  const Bar = ({ pct, color, marker }) => (
    <div style={{ position: "relative", height: 8, borderRadius: 4, background: "rgba(0,0,0,0.07)", margin: "3px 0" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: color }} />
      {marker != null && <div title={`Where you should be today: ${money(t.pace)}`} style={{ position: "absolute", left: `${marker}%`, top: -3, width: 2, height: 14, background: "#1a0a09" }} />}
    </div>
  );
  const plan = R.PLAN_REFERENCE;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="ma-grid-4">
        <div style={box}>
          <span style={lbl}>November revenue</span>
          <span style={big}>{money(t.mtd.revenue)}{of(money(R.NOV_REVENUE_TARGET))}</span>
          <Bar pct={revPct} color={t.mtd.revenue >= t.pace ? GOOD : BAD} marker={pacePct} />
          <span style={small}>{money(t.revenueNeeded)} to go · {t.mtd.purchases} sales so far</span>
          <span style={{ ...small, color: t.mtd.actualDays ? C1 : "#9b8b88" }}
            title="Days with Razorpay + App entered use that total instead of Meta's revenue, so purchases Meta attributes later aren't counted twice.">
            {t.mtd.actualDays ? `Actual revenue on ${t.mtd.actualDays} of ${t.daysDone} days, Meta on the rest` : "Meta revenue (no actual revenue entered yet)"}
          </span>
        </div>
        <div style={box}>
          <span style={lbl}>ROAS since {fmtDay(R.PLAN_START)}</span>
          <span style={{ ...big, color: t.plan.roas == null ? "#1a0a09" : t.plan.roas >= R.ROAS_TARGET ? GOOD : BAD }}>{t.plan.roas == null ? "—" : `${t.plan.roas.toFixed(2)}x`}{of(`${R.ROAS_TARGET}x`)}</span>
          <span style={small}>{money(t.plan.revenue)} from {money(t.plan.spend)} spent</span>
        </div>
        <div style={box}>
          <span style={lbl}>November spend</span>
          <span style={big}>{money(t.mtd.spend)}{of(money(R.NOV_SPEND_CAP))}</span>
          <Bar pct={spendPct} color={spendPct > 90 ? BAD : C1} />
          <span style={small}>{money(t.spendAllowedRest)} left to spend</span>
        </div>
        <div style={box}>
          <span style={lbl}>Target cost per sale</span>
          <span style={big}>{money(t.targetCPA)}</span>
          <span style={small} title={`${money(t.revPerPurchase)} revenue per sale ÷ ${R.ROAS_TARGET}${t.revPerPurchaseFallback ? " (fallback value)" : ""}`}>or lower</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "rgba(255,255,255,0.55)", borderRadius: 14, padding: "10px 14px" }}>
        <span style={{ fontSize: 13, fontWeight: 800, padding: "4px 12px", borderRadius: 999, color: "#fff", background: onTrack ? GOOD : BAD }}>
          {onTrack ? "✓ On track" : `Behind on ${t.behind.join(" & ")}`}
        </span>
        <span style={{ fontSize: 14, color: "#1a0a09" }}
          title={`Plan from 9 Nov: revenue 9–30 Nov ≈ ${money(plan.revenue)}, spend ≤ ${money(plan.spendMax)}, cost per sale ≤ ${money(plan.cpaMax)}, ≈ ${plan.purchases} sales (${plan.purchasesPerDay}/day), November spend ≈ ${money(plan.novSpend)}`}>
          Every day till 30 Nov: <b>{money(t.perDay.revenue)}</b> revenue · <b>{t.perDay.purchases == null ? "—" : Math.ceil(t.perDay.purchases)}</b> sales · spend up to <b>{money(t.perDay.spend)}</b>
        </span>
      </div>
    </div>
  );
}

function Badge({ decision }) {
  const [color, label] = BADGE[decision] || [GREY, decision];
  return <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", padding: "3px 8px", borderRadius: 6, color, background: `${color}1a`, border: `1px solid ${color}55`, whiteSpace: "nowrap" }}>{label}</span>;
}

// The one short instruction shown everywhere
function actionText(r, money, noWinning) {
  const where = r.level === "campaign" ? "campaign budget" : "budget";
  switch (r.decision) {
    case "SCALE": return r.newBudget != null ? <>Increase {where}: {money(r.budget)} → <b>{money(r.newBudget)}</b></> : `Increase ${where} by ${R.RAISE_PCT * 100}%`;
    case "CUT": return r.newBudget != null ? <>Decrease {where}: {money(r.budget)} → <b>{money(r.newBudget)}</b></> : `Decrease ${where} by ${R.CUT_PCT * 100}%`;
    case "PAUSE": return r.isCampaign ? "Turn off campaign" : "Turn off";
    case "GRADUATE": return <>Duplicate to {noWinning ? <>a new <b>A+ Winning</b> campaign</> : <b>A+ Winning</b>} at {money(R.TEST_BUDGET)}/day, then turn this off</>;
    case "WAIT":
    case "TOO_NEW": return r.nextAllowed ? `No change till ${fmtDay(r.nextAllowed)}` : "No change";
    case "KEEP_RUNNING": return "Keep running";
    case "KEEP_ONE_MORE_DAY": return "Keep 1 more day";
    default: return r.held ? "No change (spend limit)" : "No change";
  }
}
const Why = ({ text }) => <span title={text} style={{ marginLeft: 6, color: "#b0a0a0", cursor: "help", fontSize: 12 }}>ⓘ</span>;

function CampaignBlock({ role, campaigns, rows, money, noWinning }) {
  const live = campaigns.filter((c) => c.live);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: "#1a0a09" }}>{R.ROLE_LABEL[role]}</span>
        <span style={{ fontSize: 12, color: "#9b8b88" }}>{campaigns.map((c) => `${c.name}${c.live ? "" : " (off)"}`).join(", ")}</span>
      </div>
      {!live.length ? (
        <Empty>{campaigns.length ? "Campaign is off." : role === "winning" ? "Not created yet. You'll make it when the first test graduates." : "No campaign found."}</Empty>
      ) : !rows.length ? <Empty>No active ad sets.</Empty> : (
        <div className="m-scroll-x" style={{ overflow: "auto", borderRadius: 12, border: "1px solid rgba(171,31,16,0.08)", background: "rgba(255,255,255,0.6)" }}>
          <table className="ma">
            <thead>
              <tr><th className="l name">Ad set</th><th>Budget</th><th>Spent</th><th>Sales</th><th>Cost / sale</th><th>ROAS</th><th className="l">What to do</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="l name" style={r.sub ? { paddingLeft: 20 } : undefined}><div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.name}</div></td>
                  <td>{r.budget == null ? "—" : money(r.budget)}</td>
                  <td>{money(r.last3.spend)}</td>
                  <td>{r.last3.purchases}</td>
                  <td>{money(r.last3.cpa)}</td>
                  <td>{r.last3.roas == null ? "—" : r.last3.roas.toFixed(2)}</td>
                  <td className="l" style={{ whiteSpace: "normal", minWidth: 260 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge decision={r.decision} />
                      <span style={{ fontSize: 13, color: "#1a0a09" }}>{actionText(r, money, noWinning)}<Why text={r.reason} /></span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Same instruction as actionText, as plain text (saved with a review, so it's clear what was approved / rejected)
function actionPlain(r, money, noWinning) {
  const where = r.level === "campaign" ? "campaign budget" : "budget";
  switch (r.decision) {
    case "SCALE": return r.newBudget != null ? `Increase ${where}: ${money(r.budget)} → ${money(r.newBudget)}` : `Increase ${where} by ${R.RAISE_PCT * 100}%`;
    case "CUT": return r.newBudget != null ? `Decrease ${where}: ${money(r.budget)} → ${money(r.newBudget)}` : `Decrease ${where} by ${R.CUT_PCT * 100}%`;
    case "PAUSE": return r.isCampaign ? "Turn off campaign" : "Turn off";
    case "GRADUATE": return `Duplicate to ${noWinning ? "a new A+ Winning campaign" : "A+ Winning"} at ${money(R.TEST_BUDGET)}/day, then turn this off`;
    case "WAIT":
    case "TOO_NEW": return r.nextAllowed ? `No change till ${fmtDay(r.nextAllowed)}` : "No change";
    case "KEEP_RUNNING": return "Keep running";
    case "KEEP_ONE_MORE_DAY": return "Keep 1 more day";
    default: return r.held ? "No change (spend limit)" : "No change";
  }
}

// Reviews saved in S3 (/api/meta-ads/reviews): approve / reject / suggestion / extra to-dos / done ticks
function useReviews(today) {
  const [days, setDays] = useState({});
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/meta-ads/reviews?t=${Date.now()}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        setDays(j.days || {});
      } catch (e) { setError(e?.message || "Could not load reviews"); }
    })();
  }, []);
  const post = useCallback(async (body) => {
    setError("");
    try {
      const r = await fetch("/api/meta-ads/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: today, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setDays(j.days || {});
      return true;
    } catch (e) { setError(e?.message || "Could not save"); return false; }
  }, [today]);
  return { day: days[today] || {}, error, post };
}

const REVIEW_CHIP = {
  waiting: ["#9b8b88", "Waiting for review"],
  approved: [GOOD, "Approved"],
  rejected: [BAD, "Rejected"],
  added: [C1, "Added"],
};
const btn = (color) => ({ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8, border: `1px solid ${color}55`, background: `${color}12`, color, cursor: "pointer", whiteSpace: "nowrap" });

// Checklist of everything to change today, PAUSE → CUT → GRADUATE → SCALE.
// riddhi (and dhruvi) approve or reject each change; a rejection can carry her own suggestion, which then becomes
// the to-do instead. She can also add to-dos of her own. jagat sees the same list read-only.
function DoToday({ rows, others, money, noWinning, today, user }) {
  const canReview = user === "riddhi" || user === "dhruvi";
  const { day, error, post } = useReviews(today);
  const [rejecting, setRejecting] = useState(null); // item key being rejected
  const [draft, setDraft] = useState("");
  const [newTodo, setNewTodo] = useState("");
  const [busy, setBusy] = useState(false);

  const items = [
    ...others.map((c) => ({ key: `o|${c.id}`, decision: "PAUSE", name: c.name, plain: "Turn off campaign (not one of the 3)", text: "Turn off campaign (not one of the 3)", reason: `${money(c.last3.spend)} spent, ${c.last3.purchases} sales in the last 3 days` })),
    ...rows.map((r) => ({ key: `${r.role}|${r.id}`, decision: r.decision, name: r.name, plain: actionPlain(r, money, noWinning), text: actionText(r, money, noWinning), reason: r.reason })),
  ];
  const known = new Set(items.map((x) => x.key));
  // reviews whose item isn't in today's list any more (data refreshed) still show if they carry a to-do
  const extra = Object.entries(day)
    .filter(([k, v]) => !known.has(k) && (v.status === "added" || (v.status === "rejected" && v.suggestion)))
    .map(([k, v]) => ({ key: k, decision: null, name: v.status === "added" ? "" : v.name, plain: v.original, text: v.original, reason: "", orphan: true }));
  const all = [...items, ...extra];

  const run = async (body) => { setBusy(true); const ok = await post(body); setBusy(false); return ok; };
  const approve = (x) => run({ key: x.key, status: "approved", original: x.plain, name: x.name });
  const reject = async (x) => {
    if (await run({ key: x.key, status: "rejected", suggestion: draft, original: x.plain, name: x.name })) { setRejecting(null); setDraft(""); }
  };
  const addTodo = async () => {
    if (!newTodo.trim()) return;
    if (await run({ key: `s|${Date.now().toString(36)}`, status: "added", suggestion: newTodo })) setNewTodo("");
  };

  const waiting = items.filter((x) => !day[x.key]?.status).length;
  const toDo = all.filter((x) => { const v = day[x.key]; return !(v?.status === "rejected" && !v.suggestion); }).length;

  return (
    <div style={{ ...GL.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#7b241c" }}>Do today <span style={{ color: "#9b8b88", fontWeight: 600 }}>({toDo})</span></span>
        {waiting > 0 && <span style={{ fontSize: 12, color: "#9b8b88" }}>{waiting} waiting for Riddhi's review</span>}
        {!canReview && <span style={{ fontSize: 12, color: "#9b8b88", marginLeft: "auto" }}>View only</span>}
      </div>
      {error && <div style={{ fontSize: 12, color: BAD }}>{error}</div>}
      {!all.length && <Empty>Nothing to change today.</Empty>}

      {all.map((x) => {
        const v = day[x.key] || {};
        const status = v.status || (x.key.startsWith("s|") ? "added" : "waiting");
        const [chipColor, chipLabel] = REVIEW_CHIP[status];
        const dropped = status === "rejected" && !v.suggestion; // rejected with no alternative: nothing to do
        const replaced = (status === "rejected" && v.suggestion) || status === "added";
        const changed = v.original && !x.orphan && status !== "added" && v.original !== x.plain;
        const done = !!v.done;
        return (
          <div key={x.key} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 4px", borderTop: "1px solid rgba(171,31,16,0.06)", opacity: done || dropped ? 0.5 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input type="checkbox" checked={done} disabled={!canReview || busy || dropped} title={canReview ? "Mark done" : "Only Riddhi or Dhruvi can tick"}
                onChange={(e) => run({ key: x.key, done: e.target.checked })} />
              <span style={{ minWidth: 92 }}>{x.decision ? <Badge decision={x.decision} /> : <Badge decision={status === "added" ? "TO DO" : "SUGGESTION"} />}</span>
              {x.name && <span style={{ flex: "1 1 200px", fontWeight: 600, fontSize: 13, color: "#1a0a09", overflowWrap: "anywhere", textDecoration: done ? "line-through" : "none" }}>{x.name}</span>}
              <span style={{ flex: "1 1 260px", fontSize: 13, color: "#1a0a09", textDecoration: done ? "line-through" : "none" }}>
                {replaced ? <b>{v.suggestion}</b> : <span style={{ textDecoration: dropped ? "line-through" : undefined }}>{x.text}</span>}
                {x.reason && <Why text={x.reason} />}
                {replaced && status === "rejected" && x.plain && <div style={{ fontSize: 11.5, color: "#9b8b88" }}>Instead of: <s>{x.plain}</s></div>}
                {dropped && <div style={{ fontSize: 11.5, color: BAD }}>Rejected: don't do this</div>}
                {changed && <div style={{ fontSize: 11.5, color: WARN }}>Changed since the review (was: {v.original})</div>}
              </span>
              <span title={v.at ? `${v.by} · ${new Date(v.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : undefined}
                style={{ fontSize: 11, fontWeight: 700, color: chipColor, whiteSpace: "nowrap" }}>
                {chipLabel}{v.by ? ` · ${v.by}` : ""}
              </span>
              {canReview && rejecting !== x.key && (
                <span style={{ display: "flex", gap: 6 }}>
                  {status === "waiting" && <>
                    <button style={btn(GOOD)} disabled={busy} onClick={() => approve(x)}>✓ Approve</button>
                    <button style={btn(BAD)} disabled={busy} onClick={() => { setRejecting(x.key); setDraft(""); }}>✕ Reject</button>
                  </>}
                  {(status === "rejected" && !x.orphan) && <button style={btn(GREY)} disabled={busy} onClick={() => { setRejecting(x.key); setDraft(v.suggestion || ""); }}>Edit suggestion</button>}
                  {status !== "waiting" && <button style={btn(GREY)} disabled={busy} onClick={() => run({ key: x.key, clear: true })}>{status === "added" || x.orphan ? "Remove" : "Undo"}</button>}
                </span>
              )}
            </div>
            {rejecting === x.key && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 26 }}>
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500}
                  onKeyDown={(e) => { if (e.key === "Enter") reject(x); if (e.key === "Escape") setRejecting(null); }}
                  placeholder="Your suggestion instead (optional), e.g. Increase to ₹600 only"
                  style={{ flex: "1 1 280px", fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(171,31,16,0.2)", background: "rgba(255,255,255,0.8)" }} />
                <button style={btn(BAD)} disabled={busy} onClick={() => reject(x)}>{draft.trim() ? "Reject + use my suggestion" : "Reject"}</button>
                <button style={btn(GREY)} disabled={busy} onClick={() => setRejecting(null)}>Cancel</button>
              </div>
            )}
          </div>
        );
      })}

      {canReview && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid rgba(171,31,16,0.06)" }}>
          <input value={newTodo} onChange={(e) => setNewTodo(e.target.value)} maxLength={500}
            onKeyDown={(e) => { if (e.key === "Enter") addTodo(); }}
            placeholder="Add your own to-do, e.g. Test a new hook on the Remarketing ad"
            style={{ flex: "1 1 280px", fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(171,31,16,0.2)", background: "rgba(255,255,255,0.8)" }} />
          <button style={btn(C1)} disabled={busy || !newTodo.trim()} onClick={addTodo}>+ Add to-do</button>
        </div>
      )}
    </div>
  );
}
