"use client";

import { Suspense, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts";
import {
  GL, C1, C2, C_INK, GOOD, BAD, WARN, WEEKDAYS, istToday, addDays, daysBetween, fmtDay, weekdayIdx,
  useRangeParam, useMetaSnapshot, useDhruvi, useMoney, ratio, fmtPct, fmtRoas, fmtInt, fmtNum1, round, empty, addInto, zeroIfReported,
  withMetrics, pctChange, notReported, listReports, NA, NA_TEXT, RoasValue, entityRows, sliceBreakdowns, sliceHourly, NotForCustom,
  PageShell, RangeBar, Section, Segmented, TipBox, TipRow, LegendDot, Legend, Empty,
} from "./shared";

// Meta Ads performance — only data from the Meta API (purchases and revenue are what Meta reports: pixel purchase
// count and purchase value). Each date range is cached in S3 separately; the page never calls Meta on load,
// "Refresh now" pulls the selected range (at most once every 30 min per range).

// ── Every threshold on this page — tune here ──
const RULES = {
  roasTarget: 1.5,
  lowDataSpend: 300,           // below this spend (₹) ROAS is shown grey with "low data" instead of green / red
  settlingDays: 2, // Meta keeps attributing purchases for 1–2 days, so the newest days are shaded as provisional
  working: {
    minRoas: 1.5,              // ROAS at or above this
    cheapCppMinSpend: 500,     // …or cost per purchase below the account average, with at least this much spend (₹)
  },
  notWorking: {
    zeroPurchaseSpend: 500,    // spend above this (₹) with zero purchases
    maxRoas: 1.0,              // …or ROAS below this
    minSpendForRoas: 300,      // (only judge ROAS once an ad has spent this much, ₹)
  },
  fatigue: {
    minFrequency: 3,           // frequency above this
    minCtrDropPct: 20,         // …and CTR down at least this much vs the previous period
  },
  cheapestHours: 3,            // highlight this many cheapest hours (cost per purchase)
  minHourPurchases: 2,         // an hour needs this many purchases before its cost per purchase counts
};

export default function MetaAdsPage() {
  return (
    <Suspense fallback={null}>
      <MetaAds />
    </Suspense>
  );
}

function MetaAds() {
  const user = useDhruvi();
  const allowed = ["dhruvi", "riddhi", "jagat"].includes(user);
  const data = useMetaSnapshot(allowed);
  const { snap, error } = data;
  const rp = useRangeParam(snap);
  const money = useMoney(snap?.account?.currency);
  const [level, setLevel] = useState("campaign");
  const [sort, setSort] = useState({ key: "spend", dir: -1 });

  // every range is cut from the one cached snapshot — switching tabs never calls Meta
  const view = useMemo(() => (snap && !rp.range.error ? buildView(snap, rp.range, money) : null), [snap, rp.range, money]);

  const COLUMNS = [
    { key: "name", label: level === "ad" ? "Ad" : "Campaign", text: true },
    { key: "spend", label: "Spend", fmt: (v) => money(v) },
    { key: "impressions", label: "Impr.", fmt: fmtInt },
    { key: "clicks", label: "Clicks", fmt: fmtInt },
    { key: "ctr", label: "CTR", fmt: (v) => fmtPct(v) },
    { key: "cpc", label: "CPC", fmt: (v) => money(v, 2) },
    { key: "cpm", label: "CPM", fmt: (v) => money(v) },
    { key: "frequency", label: "Freq.", fmt: (v) => (v ? v.toFixed(2) : rp.range.preset === "custom" ? <NotForCustom /> : "—") },
    { key: "purchases", label: "Purchases", fmt: fmtInt },
    { key: "cpp", label: "Cost / purchase", fmt: (v) => money(v) },
    { key: "revenue", label: "Revenue", fmt: (v) => money(v) },
    { key: "roas", label: "ROAS", fmt: fmtRoas },
  ];
  const rows = useMemo(() => {
    if (!view) return [];
    return [...view.table[level]].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
    });
  }, [view, level, sort]);

  if (!user) return null;
  if (!allowed) return <PageShell title="Meta Ads"><div style={{ ...GL.card, padding: 18, fontSize: 14, color: "#7b241c" }}>You don't have access to Meta Ads.</div></PageShell>;

  const s = view?.summary;
  const tz = snap?.account?.timezone || "the ad account's time zone";

  return (
    <PageShell title="Meta Ads">
      <RangeBar rp={rp} data={data} />
      {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}

      {view && (
        <>
          {/* Summary */}
          <div className="ma-grid-4">
            <Kpi label="Spend" value={money(s.cur.spend)} cur={s.cur.spend} prev={s.prev.spend} neutral />
            <Kpi label="Revenue" na={s.cur.revenue == null} value={money(s.cur.revenue)} cur={s.cur.revenue} prev={s.prev.revenue} />
            <Kpi label="ROAS" na={s.cur.revenue == null} value={fmtRoas(s.cur.roas)} cur={s.cur.roas} prev={s.prev.roas}
              extra={s.cur.roas == null ? null : (
                <span style={{ color: s.cur.roas >= RULES.roasTarget ? GOOD : BAD, fontWeight: 700 }}>
                  {s.cur.roas >= RULES.roasTarget ? "✓ at/above" : "✕ below"} target {RULES.roasTarget}
                </span>
              )}
              bar={s.cur.roas == null ? null : <TargetBar value={s.cur.roas} target={RULES.roasTarget} />} />
            <Kpi label="Purchases" na={s.cur.purchases == null} value={fmtInt(s.cur.purchases)} cur={s.cur.purchases} prev={s.prev.purchases} />
            <Kpi label="Cost per purchase" na={s.cur.purchases == null} value={money(s.cur.cpp)} cur={s.cur.cpp} prev={s.prev.cpp} lowerIsBetter />
            <Kpi label="CPC" value={money(s.cur.cpc, 2)} cur={s.cur.cpc} prev={s.prev.cpc} lowerIsBetter />
            <Kpi label="CTR" value={fmtPct(s.cur.ctr)} cur={s.cur.ctr} prev={s.prev.ctr} />
            <Kpi label="CPM" value={money(s.cur.cpm)} cur={s.cur.cpm} prev={s.prev.cpm} lowerIsBetter />
          </div>

          {view.settlingFrom && (
            <div style={{ ...GL.card, padding: "10px 16px", fontSize: 12.5, color: "#92400e", background: "rgba(254,243,199,0.7)" }}>
              ⏳ Purchase data for {fmtDay(view.settlingFrom)} – {fmtDay(view.until)} is still settling — Meta keeps attributing purchases
              for 1–2 days, so recent revenue and ROAS may still rise. Those days are shaded in the charts.
            </div>
          )}

          {/* Daily trend */}
          <Section title="Daily trend" sub="Spend vs revenue, and ROAS per day. Hover a day for details.">
            <Legend>
              <LegendDot color={C1} label="Spend" />
              <LegendDot color={C2} label="Revenue" />
              {view.settlingFrom && <LegendDot color="rgba(0,0,0,0.07)" label="Still settling" bar />}
            </Legend>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={view.series} syncId="ma-day" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => fmtDay(d)} tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} minTickGap={18} />
                <YAxis tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} width={58} tickFormatter={(v) => money(v)} />
                {view.settlingFrom && <ReferenceArea x1={view.settlingFrom} x2={view.until} fill="rgba(0,0,0,0.07)" />}
                <Tooltip content={<DayTooltip money={money} />} cursor={{ stroke: "rgba(0,0,0,0.15)", strokeWidth: 1 }} />
                <Line type="monotone" dataKey="spend" stroke={C1} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
                <Line type="monotone" dataKey="revenue" stroke={C2} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7b6b6b", padding: "4px 4px 0" }}>ROAS · dashed line = target {RULES.roasTarget}</div>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={view.series} syncId="ma-day" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => fmtDay(d)} tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} minTickGap={18} />
                <YAxis tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} width={58} domain={[0, (max) => Math.max(RULES.roasTarget * 1.3, Math.ceil(max * 2) / 2)]} />
                {view.settlingFrom && <ReferenceArea x1={view.settlingFrom} x2={view.until} fill="rgba(0,0,0,0.07)" />}
                <ReferenceLine y={RULES.roasTarget} stroke={GOOD} strokeDasharray="5 4" />
                <Tooltip content={<DayTooltip money={money} />} cursor={{ stroke: "rgba(0,0,0,0.15)", strokeWidth: 1 }} />
                <Line type="monotone" dataKey="roas" stroke={C_INK} strokeWidth={2} connectNulls dot={view.series.length <= 31 ? { r: 2.5, fill: C_INK } : false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </Section>

          {/* Week on week */}
          <WeekOnWeek weeks={view.weeks} money={money} />

          {/* What's working */}
          <div className="ma-grid-3">
            <Verdict title="✓ What's working" color={GOOD} bg="rgba(22,163,74,0.08)" items={view.working}
              rule={`ROAS ≥ ${RULES.working.minRoas}, or cost per purchase below average with ${money(RULES.working.cheapCppMinSpend)}+ spent`} />
            <Verdict title="✕ What's not" color={BAD} bg="rgba(220,38,38,0.07)" items={view.notWorking}
              rule={`Over ${money(RULES.notWorking.zeroPurchaseSpend)} spent with 0 purchases, or ROAS below ${RULES.notWorking.maxRoas}`} />
            <Verdict title="⚠ Fatigue warning" color={WARN} bg="rgba(217,119,6,0.09)" items={view.fatigue}
              rule={`Frequency above ${RULES.fatigue.minFrequency} and CTR down ${RULES.fatigue.minCtrDropPct}%+ vs the previous period`} />
          </div>

          {/* Campaign / ad table */}
          <Section title={level === "ad" ? "Ads" : "Campaigns"} sub={`${rows.length} with delivery in this range. Tap a column to sort.`}
            right={<Segmented value={level} onChange={setLevel} options={[["campaign", "Campaigns"], ["ad", "Ads"]]} />}>
            <div className="m-scroll-x" style={{ overflow: "auto", maxHeight: 560, borderRadius: 12, border: "1px solid rgba(171,31,16,0.08)", background: "rgba(255,255,255,0.6)" }}>
              <table className="ma">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={`sortable ${c.text ? "l name" : ""}`}
                        onClick={() => setSort((p) => ({ key: c.key, dir: p.key === c.key ? -p.dir : c.text ? 1 : -1 }))}>
                        {c.label}{sort.key === c.key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="l name">
                        <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.name}</div>
                        {level === "ad" && <div style={{ fontSize: 11, color: "#9b8b88", overflowWrap: "anywhere" }}>{r.campaign_name} · {r.adset_name}</div>}
                      </td>
                      {COLUMNS.slice(1).map((c) => (
                        <td key={c.key}>
                          {c.key === "roas" ? <RoasValue row={r} target={RULES.roasTarget} lowRoas={RULES.notWorking.maxRoas} lowDataSpend={RULES.lowDataSpend} />
                            : notReported(r, c.key) ? <NA /> : c.fmt(r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!rows.length && <tr><td className="l" colSpan={COLUMNS.length} style={{ color: "#9b8b88", padding: 16 }}>Nothing delivered in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Time of day */}
          <TimeOfDay hours={view.hours} money={money} tz={tz} />

          {/* Day of week */}
          <DayOfWeek weekdays={view.weekdays} money={money} />

          {/* Breakdowns */}
          <div className="ma-grid-2">
            <Breakdown title="Age" list={view.breakdowns.age} money={money} />
            <Breakdown title="Region" list={view.breakdowns.region} money={money} limit={12} clicksOnly />
            <Breakdown title="Placement" list={view.breakdowns.placement} money={money} limit={12} />
            <Breakdown title="Device" list={view.breakdowns.device} money={money} />
          </div>
        </>
      )}
    </PageShell>
  );
}

const roasProps = { target: RULES.roasTarget, lowRoas: RULES.notWorking.maxRoas, lowDataSpend: RULES.lowDataSpend };

// ── all numbers for the page, from one snapshot ──
function buildView(snap, range, money) {
  const { since, until, prevSince, prevUntil } = range;
  const isCur = (d) => d >= since && d <= until;
  const isPrev = (d) => d >= prevSince && d <= prevUntil;
  const today = snap.until; // last day in the fetched data
  const settleStart = addDays(today, -(RULES.settlingDays - 1));
  const settlingFrom = until >= settleStart ? (since > settleStart ? since : settleStart) : null;

  // per day (both periods) and per ad / campaign CTR in each period
  const byDay = {};
  const cur = empty(), prev = empty();
  const ctrIn = { cur: { ad: {}, campaign: {} }, prev: { ad: {}, campaign: {} } };
  for (const r of snap.daily) {
    addInto((byDay[r.date] ||= empty()), r);
    const p = isCur(r.date) ? "cur" : isPrev(r.date) ? "prev" : null;
    if (!p) continue;
    addInto(p === "cur" ? cur : prev, r);
    for (const [lvl, id] of [["ad", r.ad_id], ["campaign", snap.ads?.[r.ad_id]?.campaign_id]]) {
      const x = (ctrIn[p][lvl][id] ||= { c: 0, i: 0 });
      x.c += r.clicks; x.i += r.impressions;
    }
  }
  const summary = { cur: withMetrics(cur), prev: withMetrics(prev) };

  const n = daysBetween(since, until);
  const series = Array.from({ length: n }, (_, i) => {
    const date = addDays(since, i);
    const d = withMetrics(zeroIfReported(byDay[date] || empty(), cur));
    return { date, spend: Math.round(d.spend), revenue: round(d.revenue), purchases: d.purchases, roas: d.roas, settling: !!settlingFrom && date >= settlingFrom };
  });

  // tables
  const ctrOf = (x) => (x && x.i > 0 ? (x.c / x.i) * 100 : null);
  const table = {};
  for (const lvl of ["campaign", "ad"]) {
    table[lvl] = entityRows(snap, range, lvl).filter((r) => r.spend > 0 || r.impressions > 0).map((r) => {
      const m = withMetrics(r);
      const before = ctrOf(ctrIn.prev[lvl][r.id]);
      const now = ctrOf(ctrIn.cur[lvl][r.id]) ?? m.ctr;
      return { ...m, ctrBefore: before, ctrChangePct: before && now != null ? ((now - before) / before) * 100 : null };
    });
  }

  // what's working / what's not (ads)
  const avgCpp = summary.cur.cpp;
  const working = [], notWorking = [], fatigue = [];
  const nw = RULES.notWorking, w = RULES.working, f = RULES.fatigue;
  for (const a of table.ad) {
    const p = `${a.purchases} purchase${a.purchases === 1 ? "" : "s"}`;
    if (a.spend > nw.zeroPurchaseSpend && a.purchases === 0) notWorking.push({ ...a, reason: `${money(a.spend)} spent, 0 purchases` });
    else if (a.spend >= nw.minSpendForRoas && a.roas != null && a.roas < nw.maxRoas) notWorking.push({ ...a, reason: `ROAS ${fmtRoas(a.roas)} on ${money(a.spend)} spent (${p})` });
    else if (a.roas != null && a.roas >= w.minRoas && a.purchases > 0 && a.spend >= RULES.lowDataSpend) working.push({ ...a, reason: `ROAS ${fmtRoas(a.roas)} on ${money(a.spend)} spent · ${p}` });
    else if (a.cpp != null && avgCpp != null && a.cpp < avgCpp && a.spend >= w.cheapCppMinSpend) working.push({ ...a, reason: `${money(a.cpp)} per purchase vs ${money(avgCpp)} average · ${money(a.spend)} spent` });
    if (a.frequency > f.minFrequency && a.ctrChangePct != null && a.ctrChangePct <= -f.minCtrDropPct) {
      fatigue.push({ ...a, reason: `Frequency ${a.frequency.toFixed(1)}, CTR ${fmtPct(a.ctr)} (was ${fmtPct(a.ctrBefore)})` });
    }
  }
  working.sort((a, b) => b.spend - a.spend);
  notWorking.sort((a, b) => b.spend - a.spend);
  fatigue.sort((a, b) => b.frequency - a.frequency);

  // week on week: Mon–Sun weeks clipped to the range; WoW compares daily averages so partial weeks compare fairly
  const known = (d) => d >= snap.compareSince && d <= until; // days we have data for
  const weekStats = (start, clipFrom) => {
    const t = empty(); let days = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      if (d < clipFrom || d > until || !known(d)) continue;
      days++; addInto(t, byDay[d] || empty());
    }
    return { ...withMetrics(zeroIfReported(t, bothPeriods)), days };
  };
  const bothPeriods = addInto(addInto(empty(), cur), prev);
  const perDay = (x, k) => (x.days && x[k] != null ? x[k] / x.days : null);
  const weeks = [];
  let wStart = addDays(since, -weekdayIdx(since));
  let prevWeek = weekStats(addDays(wStart, -7), snap.compareSince);
  for (; wStart <= until; wStart = addDays(wStart, 7)) {
    const cw = weekStats(wStart, since);
    const from = wStart < since ? since : wStart;
    const to = addDays(wStart, 6) > until ? until : addDays(wStart, 6);
    const ch = prevWeek.days ? {
      spend: pctChange(perDay(cw, "spend"), perDay(prevWeek, "spend")),
      revenue: pctChange(perDay(cw, "revenue"), perDay(prevWeek, "revenue")),
      purchases: pctChange(perDay(cw, "purchases"), perDay(prevWeek, "purchases")),
      roas: pctChange(cw.roas, prevWeek.roas), cpc: pctChange(cw.cpc, prevWeek.cpc), ctr: pctChange(cw.ctr, prevWeek.ctr),
    } : {};
    weeks.push({ ...cw, from, to, label: `${fmtDay(from)} – ${fmtDay(to)}`, partial: cw.days < 7, ch });
    prevWeek = weekStats(wStart, snap.compareSince);
  }

  // hours (hour of the ad impression)
  const hourMap = sliceHourly(snap, since, until);
  const hourRef = Object.values(hourMap).reduce((t, h) => addInto(t, h), empty());
  const hours = Array.from({ length: 24 }, (_, h) => {
    const x = withMetrics(zeroIfReported(addInto(empty(), hourMap[h] || {}), hourRef));
    return { hour: h, label: `${String(h).padStart(2, "0")}:00`, linkClicks: x.linkClicks, lpv: x.lpv, purchases: x.purchases, revenue: round(x.revenue), spend: x.spend,
      cpp: x.purchases >= RULES.minHourPurchases ? x.cpp : null };
  });
  const cheapest = hours.filter((h) => h.cpp != null).sort((a, b) => a.cpp - b.cpp).slice(0, RULES.cheapestHours).map((h) => h.hour);
  hours.forEach((h) => { h.cheap = cheapest.includes(h.hour); });

  // weekdays — averages per weekday (a range can hold e.g. 5 Mondays and 4 Sundays)
  const wd = WEEKDAYS.map((name) => ({ name, count: 0, t: empty() }));
  for (let i = 0; i < n; i++) {
    const d = addDays(since, i);
    const x = wd[weekdayIdx(d)];
    x.count++; addInto(x.t, byDay[d] || empty());
  }
  const avg = (v, count) => (count && v != null ? v / count : null);
  const weekdays = wd.map(({ name, count, t }) => {
    zeroIfReported(t, cur);
    return {
      name, count, linkClicks: avg(t.linkClicks, count), lpv: avg(t.lpv, count), purchases: avg(t.purchases, count),
      revenue: avg(t.revenue, count), spend: avg(t.spend, count), totalSpend: t.spend, roas: ratio(t.revenue, t.spend),
    };
  });

  const breakdowns = {};
  for (const [name, list] of Object.entries(sliceBreakdowns(snap, since, until))) {
    breakdowns[name] = list.map(withMetrics).filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend);
  }

  return { since, until, settlingFrom, summary, series, table, working, notWorking, fatigue, weeks, hours, weekdays, breakdowns };
}

// ── pieces ──

function Kpi({ label, value, cur, prev, lowerIsBetter, neutral, extra, bar, na }) {
  if (na) {
    return (
      <div style={{ ...GL.card, padding: "14px 16px", minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        <div className="kpi-value" style={{ fontSize: 26, fontWeight: 800, margin: "4px 0 2px" }}><NA /></div>
        <div style={{ fontSize: 12, color: "#9b8b88" }}>Not reported by Meta</div>
      </div>
    );
  }
  const change = pctChange(cur, prev);
  const good = change == null ? null : lowerIsBetter ? change < 0 : change > 0;
  const color = change == null || neutral || Math.abs(change) < 0.5 ? "#7b6b6b" : good ? GOOD : BAD;
  return (
    <div style={{ ...GL.card, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div className="kpi-value" style={{ fontSize: 26, fontWeight: 800, color: "#1a0a09", margin: "4px 0 2px", overflowWrap: "anywhere" }}>{value}</div>
      <div style={{ fontSize: 12, color, fontWeight: 600 }}>{change == null ? "no data before" : `${arrow(change)} ${fmtChange(change)} vs previous`}</div>
      {extra && <div style={{ fontSize: 12, marginTop: 4 }}>{extra}</div>}
      {bar}
    </div>
  );
}
const arrow = (c) => (c > 0 ? "▲" : c < 0 ? "▼" : "•");
const fmtChange = (c) => `${Math.abs(c).toFixed(c !== 0 && Math.abs(c) < 10 ? 1 : 0)}%`;

// ROAS on a 0 – 2×target track, with a tick at the target
function TargetBar({ value, target }) {
  const pos = Math.min(100, (value / (target * 2)) * 100);
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 3, background: "rgba(0,0,0,0.07)", marginTop: 8 }}>
      <div style={{ width: `${pos}%`, height: "100%", borderRadius: 3, background: value >= target ? GOOD : BAD }} />
      <div title={`Target ${target}`} style={{ position: "absolute", left: "50%", top: -3, width: 2, height: 12, background: "#1a0a09" }} />
    </div>
  );
}

function WeekOnWeek({ weeks, money }) {
  // change cell: up is good unless lowerIsBetter
  const Ch = ({ v, lowerIsBetter, neutral, muted }) => {
    if (v == null) return <span style={{ color: "#c0b0b0" }}>—</span>;
    const good = lowerIsBetter ? v < 0 : v > 0;
    const color = muted || neutral || Math.abs(v) < 0.5 ? "#7b6b6b" : good ? GOOD : BAD;
    return <span style={{ color, fontSize: 11.5, fontWeight: 600 }}>{arrow(v)} {fmtChange(v)}</span>;
  };
  const cell = (main, change) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
      <span>{main}</span>{change}
    </div>
  );
  return (
    <Section title="Week on week" sub="Mon–Sun weeks. WoW % compares each week with the one before using daily averages, so partial weeks compare fairly.">
      {weeks.length ? (
        <>
          <Legend><LegendDot color={C1} label="Spend" bar /><LegendDot color={C2} label="Revenue" bar /></Legend>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeks} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
              <YAxis tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} width={58} tickFormatter={(v) => money(v)} />
              <Tooltip cursor={{ fill: "rgba(171,31,16,0.05)" }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const w = payload[0].payload;
                return (
                  <TipBox title={`${w.label}${w.partial ? ` · ${w.days} days` : ""}`}>
                    <TipRow color={C1} label="Spend" value={money(w.spend)} />
                    <TipRow color={C2} label="Revenue" value={w.revenue == null ? NA_TEXT : money(w.revenue)} />
                    <TipRow label="ROAS" value={w.revenue == null ? NA_TEXT : fmtRoas(w.roas)} />
                    <TipRow label="Purchases" value={w.purchases == null ? NA_TEXT : fmtInt(w.purchases)} />
                  </TipBox>
                );
              }} />
              <Bar dataKey="spend" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="revenue" fill={C2} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
          <div className="m-scroll-x" style={{ overflow: "auto", borderRadius: 12, border: "1px solid rgba(171,31,16,0.08)", background: "rgba(255,255,255,0.6)" }}>
            <table className="ma">
              <thead>
                <tr><th className="l name">Week</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>Purchases</th><th>CPC</th><th>CTR</th></tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.from}>
                    <td className="l name">
                      <div style={{ fontWeight: 600 }}>{w.label}</div>
                      {w.partial && <div style={{ fontSize: 11, color: "#9b8b88" }}>partial · {w.days} day{w.days === 1 ? "" : "s"}</div>}
                    </td>
                    <td>{cell(money(w.spend), <Ch v={w.ch.spend} neutral />)}</td>
                    <td>{cell(notReported(w, "revenue") ? <NA /> : money(w.revenue), <Ch v={w.ch.revenue} />)}</td>
                    <td>{cell(<RoasValue row={w} {...roasProps} />, <Ch v={w.ch.roas} />)}</td>
                    <td>{cell(notReported(w, "purchases") ? <NA /> : fmtInt(w.purchases), <Ch v={w.ch.purchases} />)}</td>
                    <td>{cell(money(w.cpc, 2), <Ch v={w.ch.cpc} lowerIsBetter />)}</td>
                    <td>{cell(fmtPct(w.ctr), <Ch v={w.ch.ctr} />)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <Empty />}
    </Section>
  );
}

const axisProps = { tick: { fontSize: 11, fill: "#7b6b6b" }, tickLine: false, axisLine: false };

function TimeOfDay({ hours, money, tz }) {
  const hasData = hours.some((h) => h.spend > 0);
  const cheap = hours.filter((h) => h.cheap).sort((a, b) => a.cpp - b.cpp);
  const buysReported = listReports(hours, "purchases");
  const visitsReported = listReports(hours, "linkClicks") || listReports(hours, "lpv");
  const noBuys = <Empty>Meta didn't report purchases by hour for this range.</Empty>;
  return (
    <Section title="Time of day" sub={`Ad-driven visitors only — people who came from these Meta ads, not all website visitors. Hours are in ${tz}.`}>
      {!hasData ? <Empty /> : (
        <>
          <div style={{ fontSize: 12, color: "#7b6b6b", background: "rgba(0,0,0,0.03)", borderRadius: 10, padding: "8px 11px" }}>
            Meta reports hourly results by the hour the ad was <b>shown</b>. A purchase is counted at the hour of the ad impression, which isn't
            necessarily when the payment happened.
          </div>
          <div className="ma-grid-2">
            <MiniChart title="When people visit" sub="Link clicks and landing page views by hour">
              <Legend><LegendDot color={C1} label="Link clicks" /><LegendDot color={C2} label="Landing page views" /></Legend>
              {!visitsReported ? <Empty>Meta didn't report clicks by hour for this range.</Empty> : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis dataKey="hour" {...axisProps} interval={3} tickFormatter={(h) => `${h}h`} />
                  <YAxis {...axisProps} width={44} />
                  <Tooltip content={<HourTip money={money} rows={[["linkClicks", "Link clicks", C1], ["lpv", "Landing page views", C2]]} />} />
                  <Line type="monotone" dataKey="linkClicks" stroke={C1} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="lpv" stroke={C2} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>)}
            </MiniChart>
            <MiniChart title="Cheapest hours" sub={`Cost per purchase by hour (hours with ${RULES.minHourPurchases}+ purchases). Darker = the ${RULES.cheapestHours} cheapest.`}>
              {!buysReported ? noBuys : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis dataKey="hour" {...axisProps} interval={3} tickFormatter={(h) => `${h}h`} />
                  <YAxis {...axisProps} width={52} tickFormatter={(v) => money(v)} />
                  <Tooltip cursor={{ fill: "rgba(171,31,16,0.05)" }} content={<HourTip money={money} rows={[["cpp", "Cost per purchase", C1, true], ["purchases", "Purchases"], ["spend", "Spend", null, true]]} />} />
                  <Bar dataKey="cpp" radius={[4, 4, 0, 0]} maxBarSize={14}>
                    {hours.map((h) => <Cell key={h.hour} fill={h.cheap ? C1 : "rgba(42,120,214,0.35)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>)}
              {buysReported && cheap.length > 0 && (
                <div style={{ fontSize: 12.5, color: "#374151" }}>
                  Cheapest: {cheap.map((h) => `${h.label} (${money(h.cpp)})`).join(" · ")}
                </div>
              )}
            </MiniChart>
            <MiniChart title="When people buy · purchases" sub="Purchases by hour of the ad impression">
              {!buysReported ? noBuys : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis dataKey="hour" {...axisProps} interval={3} tickFormatter={(h) => `${h}h`} />
                  <YAxis {...axisProps} width={44} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(171,31,16,0.05)" }} content={<HourTip money={money} rows={[["purchases", "Purchases", C1], ["revenue", "Purchase value", null, true]]} />} />
                  <Bar dataKey="purchases" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>)}
            </MiniChart>
            <MiniChart title="When people buy · purchase value" sub="Purchase value by hour of the ad impression">
              {!buysReported ? noBuys : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis dataKey="hour" {...axisProps} interval={3} tickFormatter={(h) => `${h}h`} />
                  <YAxis {...axisProps} width={52} tickFormatter={(v) => money(v)} />
                  <Tooltip cursor={{ fill: "rgba(171,31,16,0.05)" }} content={<HourTip money={money} rows={[["revenue", "Purchase value", C2, true], ["purchases", "Purchases"]]} />} />
                  <Bar dataKey="revenue" fill={C2} radius={[4, 4, 0, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>)}
            </MiniChart>
          </div>
        </>
      )}
    </Section>
  );
}

function HourTip({ active, payload, rows, money }) {
  if (!active || !payload?.length) return null;
  const h = payload[0].payload;
  return (
    <TipBox title={`${h.label} – ${String(h.hour).padStart(2, "0")}:59`}>
      {rows.map(([k, label, color, isMoney]) => <TipRow key={k} color={color} label={label} value={notReported(h, k) ? NA_TEXT : isMoney ? money(h[k]) : fmtInt(h[k])} />)}
    </TipBox>
  );
}

function DayOfWeek({ weekdays, money }) {
  const hasData = weekdays.some((d) => d.spend > 0);
  const counts = weekdays.map((d) => `${d.name} ×${d.count}`).join(", ");
  const tip = (rows) => ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <TipBox title={`${d.name} · average of ${d.count} day${d.count === 1 ? "" : "s"}`}>
        {rows.map(([k, label, color, f]) => <TipRow key={k} color={color} label={label} value={f(d[k])} />)}
      </TipBox>
    );
  };
  const bars = (key, color, fmt, rows) => (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={weekdays} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} width={52} tickFormatter={fmt} />
        <Tooltip cursor={{ fill: "rgba(171,31,16,0.05)" }} content={tip(rows)} />
        {key === "roas" && <ReferenceLine y={RULES.roasTarget} stroke={GOOD} strokeDasharray="5 4" />}
        <Bar dataKey={key} fill={color} radius={[4, 4, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
  return (
    <Section title="Day of week" sub={`Average per weekday in this range (${counts}) — not totals, since a range can hold more of some weekdays than others.`}>
      {!hasData ? <Empty /> : (
        <>
          <MiniChart title="Visits" sub="Average link clicks and landing page views per weekday (ad-driven visitors only)">
            <Legend><LegendDot color={C1} label="Link clicks" bar /><LegendDot color={C2} label="Landing page views" bar /></Legend>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weekdays} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} width={44} />
                <Tooltip cursor={{ fill: "rgba(171,31,16,0.05)" }} content={tip([["linkClicks", "Link clicks", C1, fmtNum1], ["lpv", "Landing page views", C2, fmtNum1]])} />
                <Bar dataKey="linkClicks" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="lpv" fill={C2} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </MiniChart>
          <div className="ma-grid-3">
            <MiniChart title="Purchases" sub="Average per weekday">
              {bars("purchases", C1, (v) => fmtNum1(v), [["purchases", "Purchases", C1, fmtNum1], ["spend", "Spend", null, (v) => money(v)]])}
            </MiniChart>
            <MiniChart title="Revenue" sub="Average per weekday">
              {bars("revenue", C2, (v) => money(v), [["revenue", "Revenue", C2, (v) => money(v)], ["spend", "Spend", null, (v) => money(v)]])}
            </MiniChart>
            <MiniChart title="ROAS" sub={`Total revenue ÷ spend for that weekday · dashed = ${RULES.roasTarget}`}>
              {bars("roas", C_INK, (v) => (v == null ? "" : v.toFixed(1)), [["roas", "ROAS", C_INK, fmtRoas], ["revenue", "Avg revenue", null, (v) => money(v)]])}
            </MiniChart>
          </div>
        </>
      )}
    </Section>
  );
}

function MiniChart({ title, sub, children }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, padding: "12px 12px 8px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a0a09" }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: "#9b8b88" }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Verdict({ title, color, bg, items, rule }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 6);
  return (
    <div style={{ ...GL.card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color }}>{title} <span style={{ color: "#9b8b88", fontWeight: 600 }}>({items.length})</span></div>
        <div style={{ fontSize: 11.5, color: "#9b8b88", marginTop: 2 }}>{rule}</div>
      </div>
      {items.length === 0 && <div style={{ fontSize: 13, color: "#9b8b88" }}>No ads here right now.</div>}
      {shown.map((a) => (
        <div key={a.id} style={{ background: bg, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a0a09", overflowWrap: "anywhere" }}>{a.name}</div>
          <div style={{ fontSize: 12.5, color: "#374151", marginTop: 2 }}>{a.reason}</div>
        </div>
      ))}
      {items.length > 6 && (
        <button onClick={() => setAll((v) => !v)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ab1f10", alignSelf: "flex-start" }}>
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

// Region: Meta doesn't report conversions by region, so it shows click performance instead.
// Any other breakdown whose purchases Meta didn't report falls back to the same view.
function Breakdown({ title, list = [], money, limit, clicksOnly }) {
  const data = limit ? list.slice(0, limit) : list;
  const max = Math.max(1, ...data.map((x) => x.spend));
  const totalSpend = list.reduce((s, x) => s + x.spend, 0);
  const clicks = clicksOnly || (list.length > 0 && !listReports(list, "purchases"));
  const th = (label, left, extra) => <th style={{ textAlign: left ? "left" : "right", padding: 6, ...extra }}>{label}</th>;
  const td = (v, extra) => <td style={{ padding: 7, textAlign: "right", color: "#1a0a09", whiteSpace: "nowrap", ...extra }}>{v}</td>;
  const sub = [
    clicks ? "Meta doesn't report purchases by " + title.toLowerCase() + ". Showing click performance instead." : null,
    limit && list.length > limit ? `Top ${limit} of ${list.length} by spend` : "By spend",
  ].filter(Boolean).join(" · ");
  return (
    <Section title={`By ${title.toLowerCase()}`} sub={sub}>
      {data.length ? (
        <div className="m-scroll-x" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {th(title, true, { paddingLeft: 0 })}
                {th("Spend", true, { width: clicks ? "30%" : "38%" })}
                {clicks ? <>{th("Link clicks")}{th("CTR")}{th("CPC")}{th("% spend")}</> : <>{th("Purch.")}{th("ROAS")}</>}
              </tr>
            </thead>
            <tbody>
              {data.map((x) => (
                <tr key={x.key} style={{ borderTop: "1px solid rgba(171,31,16,0.06)" }}>
                  <td style={{ padding: "7px 6px 7px 0", color: "#1a0a09", textTransform: "capitalize", minWidth: 90 }}>{x.key}</td>
                  <td style={{ padding: 7 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 40, height: 8, borderRadius: 4, background: "rgba(0,0,0,0.05)" }}>
                        <div style={{ width: `${(x.spend / max) * 100}%`, height: "100%", borderRadius: 4, background: C1 }} />
                      </div>
                      <span style={{ whiteSpace: "nowrap", color: "#1a0a09", minWidth: 58, textAlign: "right" }}>{money(x.spend)}</span>
                    </div>
                  </td>
                  {clicks ? (
                    <>
                      {td(notReported(x, "linkClicks") ? <NA /> : fmtInt(x.linkClicks))}
                      {td(notReported(x, "linkCtr") ? <NA /> : fmtPct(x.linkCtr))}
                      {td(notReported(x, "linkCpc") ? <NA /> : money(x.linkCpc, 2))}
                      {td(fmtPct(totalSpend ? (x.spend / totalSpend) * 100 : null, 1))}
                    </>
                  ) : (
                    <>
                      {td(notReported(x, "purchases") ? <NA /> : fmtInt(x.purchases))}
                      {td(<RoasValue row={x} {...roasProps} />)}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty />}
      {clicks && data.length > 0 && <div style={{ fontSize: 11.5, color: "#9b8b88" }}>CTR and CPC here are for link clicks.</div>}
    </Section>
  );
}

function DayTooltip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TipBox title={<>{fmtDay(label, { weekday: "short", day: "numeric", month: "short" })}{r.settling && <span style={{ color: WARN, fontWeight: 600 }}> · still settling</span>}</>}>
      <TipRow color={C1} label="Spend" value={money(r.spend)} />
      <TipRow color={C2} label="Revenue" value={r.revenue == null ? NA_TEXT : money(r.revenue)} />
      <TipRow color={C_INK} label="ROAS" value={r.revenue == null ? NA_TEXT : fmtRoas(r.roas)} />
      <div style={{ color: "#7b6b6b", fontSize: 12, marginTop: 4 }}>{r.purchases == null ? `Purchases ${NA_TEXT}` : `${r.purchases} purchase${r.purchases === 1 ? "" : "s"}`}</div>
    </TipBox>
  );
}
