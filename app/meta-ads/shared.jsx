"use client";

// Shared by /meta-ads and /meta-ads/persona: date ranges, loading / refreshing a range's snapshot,
// formatting, and the small UI pieces both pages use.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { addDays, daysBetween, istToday, fmtDay, dataWindow, computeRange, PRESETS } from "./ranges";
import { readUser } from "../components/currentUser";

export const GL = {
  card: {
    background: "rgba(255,255,255,0.62)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    border: "1.5px solid rgba(255,255,255,0.8)", borderRadius: 18, boxShadow: "0 4px 24px rgba(171,31,16,0.07)",
  },
  h: { fontSize: 13, fontWeight: 800, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase" },
  sub: { fontSize: 12, color: "#9b8b88", marginTop: 2 },
  btnOutline: {
    background: "rgba(255,255,255,0.7)", color: "#ab1f10", border: "1.5px solid rgba(171,31,16,0.3)", borderRadius: 10,
    padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  input: {
    background: "rgba(255,255,255,0.8)", border: "1.5px solid rgba(171,31,16,0.15)", borderRadius: 10, padding: "7px 10px",
    fontSize: 13, color: "#1a0a09", outline: "none",
  },
};
// Validated categorical pair (same as User Metrics): slot 1 blue, slot 2 orange. Single-series charts use slot 1.
export const C1 = "#2a78d6";
export const C2 = "#eb6834";
export const C_INK = "#374151";
export const GOOD = "#15803d", BAD = "#b91c1c", WARN = "#b45309";

// ── dates (India time) ──
export { addDays, daysBetween, istToday, fmtDay, dataWindow, computeRange, PRESETS };
export const weekdayIdx = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Range lives in the URL (?r=30d or ?r=custom&from=…&to=…) so it carries over between Overview and Persona.
// Presets count back from the last day in the fetched data, so they always match what's cached.
export function useRangeParam(snap) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const preset = sp.get("r") || "7d";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const today = snap?.until || istToday();
  const win = useMemo(() => (snap ? { since: snap.since, until: snap.until, compareSince: snap.compareSince } : dataWindow(today)), [snap, today]);
  const range = useMemo(() => computeRange(preset, from, to, today, win), [preset, from, to, today, win]);
  const setRange = (p, f, t) => {
    const q = new URLSearchParams({ r: p });
    if (p === "custom") { if (f) q.set("from", f); if (t) q.set("to", t); }
    router.replace(`${pathname}?${q}`, { scroll: false });
  };
  return { preset, from, to, range, win, setRange };
}

// The one cached snapshot (all ranges are cut from it in the browser) + Refresh now
export function useMetaSnapshot(enabled) {
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/meta-ads?t=${Date.now()}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setSnap(j);
    } catch (e) {
      setSnap(null);
      setError(e?.message || "Could not load Meta Ads data");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const refresh = async () => {
    setRefreshing(true); setRefreshMsg("");
    try {
      const r = await fetch("/api/meta-ads", { method: "POST" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setRefreshMsg(`✓ Pulled ${j.rows} ad-day rows from Meta`);
      await load();
    } catch (e) {
      setRefreshMsg(e?.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const ageMin = snap?.fetchedAt ? (now - Date.parse(snap.fetchedAt)) / 60000 : null;
  const cooldownLeft = ageMin == null ? 0 : Math.max(0, Math.ceil((snap?.cooldownMin || 30) - ageMin));
  return { snap: snap?.exists ? snap : null, missing: snap && !snap.exists, loading, error, refresh, refreshing, refreshMsg, ageMin, cooldownLeft };
}

export function useDhruvi() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_user=([^;]+)/);
    if (!m) { router.push("/login"); return; }
    setUser(decodeURIComponent(m[1]));
  }, [router]);
  return user;
}

// ── formatting ──
// null = Meta didn't report the metric (shown as "—" with a tooltip), never treated as 0
export const ratio = (a, b) => (a == null || b == null || !(b > 0) ? null : a / b);
export const fmtPct = (v, d = 2) => (v == null || !isFinite(v) ? "—" : `${v.toFixed(d)}%`);
export const fmtRoas = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(2));
export const fmtInt = (v) => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("en-IN"));
export const fmtNum1 = (v) => (v == null || !isFinite(v) ? "—" : v >= 100 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(1));
export const round = (v) => (v == null ? null : Math.round(v));
export function useMoney(currency = "INR") {
  return useMemo(() => {
    const f0 = new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 });
    const f2 = new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v, decimals = 0) => (v == null || !isFinite(v) ? "—" : (decimals ? f2 : f0).format(v));
  }, [currency]);
}

// Sums -> every derived metric. spend / impressions / clicks are always reported; the rest may be null.
const ALWAYS = ["spend", "impressions", "clicks"];
const OPTIONAL = ["linkClicks", "lpv", "purchases", "revenue"];
export const empty = () => ({ spend: 0, impressions: 0, clicks: 0, linkClicks: null, lpv: null, purchases: null, revenue: null });
export const addInto = (t, r) => {
  for (const k of ALWAYS) t[k] += r[k] || 0;
  for (const k of OPTIONAL) if (r[k] != null) t[k] = (t[k] ?? 0) + r[k];
  return t;
};
// Fills days/rows that reported nothing with real zeros where the period as a whole was reported
export const zeroIfReported = (t, ref) => { for (const k of OPTIONAL) if (t[k] == null && ref?.[k] != null) t[k] = 0; return t; };
export const withMetrics = (o) => ({
  ...o,
  roas: ratio(o.revenue, o.spend),
  cpp: o.purchases == null ? null : ratio(o.spend, o.purchases),
  cpc: ratio(o.spend, o.clicks),
  ctr: o.impressions > 0 ? (o.clicks / o.impressions) * 100 : null,
  cpm: o.impressions > 0 ? (o.spend / o.impressions) * 1000 : null,
  linkCtr: o.linkClicks != null && o.impressions > 0 ? (o.linkClicks / o.impressions) * 100 : null,
  linkCpc: ratio(o.spend, o.linkClicks),
});
export const pctChange = (cur, prev) => (cur == null || prev == null || !prev ? null : ((cur - prev) / Math.abs(prev)) * 100);

// Which source field each shown metric depends on — if that's null, the metric wasn't reported by Meta
const SOURCE = { purchases: "purchases", cpp: "purchases", revenue: "revenue", roas: "revenue", linkClicks: "linkClicks", lpv: "lpv", linkCtr: "linkClicks", linkCpc: "linkClicks" };
export const notReported = (row, key) => !!row && SOURCE[key] != null && row[SOURCE[key]] == null;
// A whole list where Meta never reported the field (e.g. purchases by region)
export const listReports = (list, field) => (list || []).some((x) => x[field] != null);

export const NA = () => <span title="Not reported by Meta" style={{ color: "#9b8b88", cursor: "help" }}>—</span>;
export const NA_TEXT = "not reported by Meta";

// ROAS with status colour — grey + "low data" below the spend threshold, "—" when Meta didn't report it
export function RoasValue({ row, target, lowRoas, lowDataSpend, strongOnly }) {
  if (notReported(row, "roas")) return <NA />;
  if (row.roas == null) return <span style={{ color: "#9b8b88" }}>—</span>;
  if (row.spend < lowDataSpend) {
    return (
      <span title={`Only ${Math.round(row.spend)} spent — too little to judge`} style={{ color: "#9b8b88", fontWeight: 600 }}>
        {fmtRoas(row.roas)}{!strongOnly && <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 4, padding: "1px 5px", borderRadius: 6, background: "rgba(0,0,0,0.06)" }}>low data</span>}
      </span>
    );
  }
  const color = row.roas >= target ? GOOD : row.roas < lowRoas ? BAD : "#1a0a09";
  return <span style={{ color, fontWeight: 700 }}>{fmtRoas(row.roas)}</span>;
}

// ── cutting a range out of the snapshot ──
const inRange = (d, since, until) => d >= since && d <= until;

// Campaign or ad rows for a range: daily sums, plus Meta's reach / frequency when the range is a preset
// (those can't be added up by day, so custom ranges show them as "—")
export function entityRows(snap, range, level) {
  const t = {};
  for (const r of snap.daily) {
    if (!inRange(r.date, range.since, range.until)) continue;
    const ad = snap.ads?.[r.ad_id] || {};
    const id = level === "ad" ? r.ad_id : ad.campaign_id;
    const x = (t[id] ||= { id, name: (level === "ad" ? ad.name : ad.campaign) || id, campaign_name: ad.campaign, adset_name: ad.adset, ...empty() });
    addInto(x, r);
  }
  const tot = snap.totals?.[range.preset];
  const exact = tot && tot.since === range.since && tot.until === range.until;
  return Object.values(t).map((x) => {
    const rf = exact ? tot[level]?.[x.id] : null;
    return { ...x, reach: rf?.reach ?? null, frequency: rf?.frequency ?? null };
  });
}

// Breakdown rows summed over a range, per segment (keeps age / gender for age × gender)
export function sliceBreakdowns(snap, since, until) {
  const out = {};
  for (const [name, list] of Object.entries(snap.breakdowns || {})) {
    const g = {};
    for (const r of list) {
      if (!inRange(r.date, since, until)) continue;
      addInto((g[r.key] ||= { key: r.key, age: r.age, gender: r.gender, ...empty() }), r);
    }
    out[name] = Object.values(g);
  }
  return out;
}

// Hourly rows summed over a range -> { hour: totals }
export function sliceHourly(snap, since, until) {
  const g = {};
  for (const r of snap.hourly || []) {
    if (!inRange(r.date, since, until)) continue;
    addInto((g[r.hour] ||= { hour: r.hour, ...empty() }), r);
  }
  return g;
}

export const NotForCustom = () => (
  <span title="Reach and frequency come straight from Meta for the preset ranges only — they can't be added up for custom dates" style={{ color: "#9b8b88", cursor: "help" }}>—</span>
);

// ── UI pieces ──
export function PageShell({ title, children, right }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const q = sp.toString() ? `?${sp}` : "";
  const [me, setMe] = useState(null); // read after mount so server and browser render the same
  useEffect(() => { setMe(readUser()); }, []);
  const tab = (href, label) => (
    <button key={href} className="th-btn-ghost" onClick={() => router.push(`${href}${q}`)}
      style={{ background: pathname === href ? "rgba(171,31,16,0.08)" : "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
        color: pathname === href ? "#ab1f10" : "#7b241c", padding: "8px 12px", borderRadius: 9 }}>{label}</button>
  );
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-btn-ghost:hover, .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; }
        .ma-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
        .ma-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .ma-grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        @media (max-width: 1000px) { .ma-grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ma-grid-3 { grid-template-columns: 1fr; } }
        @media (max-width: 900px) { .ma-grid-2 { grid-template-columns: 1fr; } }
        table.ma { border-collapse: separate; border-spacing: 0; font-size: 13px; width: 100%; }
        table.ma th { font-size: 11px; font-weight: 700; color: #7b6b6b; text-transform: uppercase; letter-spacing: 0.04em; padding: 9px 8px; white-space: nowrap; text-align: right; position: sticky; top: 0; background: #fff6f4; z-index: 1; }
        table.ma th.sortable { cursor: pointer; user-select: none; }
        table.ma th.l, table.ma td.l { text-align: left; }
        table.ma td { padding: 8px; white-space: nowrap; text-align: right; border-top: 1px solid rgba(171,31,16,0.06); color: #1a0a09; font-variant-numeric: tabular-nums; }
        table.ma tr:hover td:not(.name) { background: rgba(171,31,16,0.03); }
        table.ma td.name { position: sticky; left: 0; background: #fffaf9; min-width: 150px; max-width: 280px; white-space: normal; }
        table.ma th.name { left: 0; z-index: 2; }
        @media (max-width: 760px) { table.ma td.name { min-width: 110px; max-width: 150px; } .kpi-value { font-size: 21px !important; } }
      `}</style>
      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button className="th-btn-ghost" onClick={() => router.push("/")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#ab1f10", padding: "8px 12px", borderRadius: 9 }}>← Home</button>
          {tab("/meta-ads", "Overview")}
          {me === "dhruvi" && tab("/meta-ads/persona", "Persona")}
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>{title}</span>
        {right || <span />}
      </div>
      <div className="m-pad" style={{ padding: "24px 28px", maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
        {children}
      </div>
    </div>
  );
}

// Presets + custom dates + status + Refresh now (one refresh covers every range)
export function RangeBar({ rp, data }) {
  const { preset, from, to, range, win, setRange } = rp;
  const [f, setF] = useState(from || addDays(win.until, -29));
  const [t, setT] = useState(to || win.until);
  const { snap, loading, refresh, refreshing, refreshMsg, ageMin, cooldownLeft, missing } = data;
  const long = { day: "numeric", month: "short", year: "numeric" };
  return (
    <div style={{ ...GL.card, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div className="m-scroll-x" style={{ maxWidth: "100%" }}>
          <Segmented value={preset} onChange={(v) => setRange(v, v === "custom" ? f : "", v === "custom" ? t : "")} options={PRESETS} />
        </div>
        {preset === "custom" && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={f} min={win.since} max={win.until} onChange={(e) => setF(e.target.value)} style={GL.input} aria-label="Start date" />
            <span style={{ color: "#9b8b88" }}>→</span>
            <input type="date" value={t} min={win.since} max={win.until} onChange={(e) => setT(e.target.value)} style={GL.input} aria-label="End date" />
            <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setRange("custom", f, t)}>Apply</button>
          </div>
        )}
      </div>
      {range.error && <div style={{ fontSize: 13, color: "#c0392b", fontWeight: 600 }}>{range.error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "#374151", flex: "1 1 260px" }}>
          {!range.error && (
            <>
              <b>{range.label}</b> ({fmtDay(range.since)} – {fmtDay(range.until, long)})
              <span style={{ color: "#7b6b6b" }}> · compared with {range.prevLabel} ({fmtDay(range.prevSince)} – {fmtDay(range.prevUntil)})</span>
              <br />
            </>
          )}
          <span style={{ color: "#7b6b6b" }}>
            {snap ? <>{snap.account?.name || snap.account?.id} · data from Meta {agoText(ageMin)} · covers {fmtDay(snap.since)} – {fmtDay(snap.until, long)}</>
              : loading ? "Loading…" : missing ? "No Meta data cached yet — click Refresh now (it fetches the last 3 months once; every range is shown from that)." : ""}
          </span>
        </span>
        <button className="th-btn-outline" style={{ ...GL.btnOutline, opacity: refreshing || cooldownLeft ? 0.55 : 1 }}
          disabled={refreshing || cooldownLeft > 0} onClick={refresh}
          title={cooldownLeft ? "Meta data can be refreshed once every 30 min" : "Pull the last 3 months from Meta again"}>
          {refreshing ? "Pulling from Meta…" : cooldownLeft ? `↻ Refresh in ${cooldownLeft} min` : "↻ Refresh now"}
        </button>
        {refreshing && <span style={{ flexBasis: "100%", fontSize: 12, color: "#7b6b6b" }}>Fetching about 3 months from Meta — this can take a minute or two.</span>}
        {refreshMsg && <span style={{ flexBasis: "100%", fontSize: 13, fontWeight: 600, color: refreshMsg.startsWith("✓") ? GOOD : "#c0392b" }}>{refreshMsg}</span>}
      </div>
    </div>
  );
}

export const agoText = (m) => (m == null ? "" : m < 1 ? "just now" : m < 60 ? `${Math.floor(m)} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`);

export function Section({ title, sub, right, children }) {
  return (
    <div style={{ ...GL.card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={GL.h}>{title}</div>
          {sub && <div style={GL.sub}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", background: "rgba(171,31,16,0.07)", borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
            background: value === v ? "#fff" : "transparent", color: value === v ? "#ab1f10" : "#7b6b6b",
            boxShadow: value === v ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}>
          {label}
        </button>
      ))}
    </div>
  );
}

export const TipBox = ({ title, children }) => (
  <div style={{ background: "#fff", borderRadius: 12, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", fontSize: 13, minWidth: 170 }}>
    <div style={{ fontWeight: 700, color: "#1a0a09", marginBottom: 6 }}>{title}</div>
    {children}
  </div>
);
export const TipRow = ({ color, label, value }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
    {color && <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />}
    <span style={{ flex: 1, color: "#374151" }}>{label}</span><b style={{ color: "#1a0a09" }}>{value}</b>
  </div>
);
export const LegendDot = ({ color, label, bar }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ width: bar ? 10 : 12, height: bar ? 10 : 3, borderRadius: 2, background: color }} /> {label}
  </span>
);
export const Legend = ({ children }) => (
  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#374151", padding: "0 4px", flexWrap: "wrap" }}>{children}</div>
);
export const Empty = ({ children = "No data in this range." }) => <div style={{ fontSize: 13, color: "#9b8b88" }}>{children}</div>;
