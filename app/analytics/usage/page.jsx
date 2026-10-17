"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { useActionPassword } from "../../components/useActionPassword";

// User Metrics: how often people use the app — daily/weekly/monthly actives, usage in a user's first
// 3 / 7 / 30 days and in the last 3 / 7 / 30 days, signup-cohort retention, premium users per day and
// which features are used each day. Everything is computed here from one snapshot
// (permanent/analytics/usage_metrics.json). The backend keeps it up to date (merges new events every
// ~2 minutes); this page re-reads it every 2 minutes. "Full rescan" is only a manual fallback. Days are India time.

const REFRESH_MS = 120 * 1000; // matches the backend's USAGE_FLUSH_SECONDS

const GL = {
  card: {
    background: "rgba(255,255,255,0.62)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    border: "1.5px solid rgba(255,255,255,0.8)", borderRadius: 18, boxShadow: "0 4px 24px rgba(171,31,16,0.07)",
  },
  h: { fontSize: 13, fontWeight: 800, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase" },
  sub: { fontSize: 12, color: "#9b8b88", marginTop: 2 },
  input: {
    background: "rgba(255,255,255,0.75)", border: "1.5px solid rgba(171,31,16,0.15)", borderRadius: 11, padding: "10px 13px",
    fontSize: 14, color: "#1a0a09", outline: "none", width: "100%", boxSizing: "border-box",
  },
  btnOutline: {
    background: "rgba(255,255,255,0.7)", color: "#ab1f10", border: "1.5px solid rgba(171,31,16,0.3)", borderRadius: 10,
    padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
};
// Two fixed categorical slots (validated pair: CVD ΔE 24.7, normal-vision ΔE 33.6, ≥ 3:1 contrast)
const C_ALL = "#2a78d6";
const C_PREMIUM = "#eb6834";
// Sequential ramp (one hue, light -> dark) for heat cells
const heat = (v, max) => (v <= 0 || !max ? "rgba(42,120,214,0.04)" : `rgba(42,120,214,${0.12 + 0.7 * Math.min(1, v / max)})`);
const heatText = (v, max) => (max && v / max > 0.6 ? "#fff" : "#1a0a09");

// "How often people use the app" only counts users who signed up from this day on
const USAGE_FROM = "2026-09-01";

// Steps -> features
const FEATURES = [
  ["Shade Finder", (s) => s === "shade-finder"],
  ["Product Finder", (s) => s === "product-finder"],
  ["Shade Guide", (s) => s === "shade-guide"],
  ["Model Fine Tune", (s) => s === "model-fine-tune"],
  ["The Edit", (s) => s === "the-edit-open" || s === "the-edit-article-open"],
  ["Try Once Free", (s) => s.startsWith("try-once-for-free")],
  ["Ritual", (s) => s.startsWith("ritual-")],
  ["Paywall & passes", (s) => s === "payment-popup close" || s.startsWith("pass-selected") || s.startsWith("cta-clicked") || s.includes("paywall")],
  ["Purchases", (s) => s.startsWith("bought-") || s.startsWith("payment-success")],
];
const isOpenStep = (s) => s === "login" || s.startsWith("login-platform");
const featureOf = (s) => (isOpenStep(s) ? null : (FEATURES.find(([, t]) => t(s)) || ["Other"])[0]);
const FEATURE_NAMES = [...FEATURES.map(([n]) => n), "Other"];

// ── day helpers (all "YYYY-MM-DD", India time) ──
const istDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (s, n) => new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000); // b - a
const fmtDay = (s, o = { day: "numeric", month: "short" }) => new Date(toUTC(s)).toLocaleDateString(undefined, { timeZone: "UTC", ...o });
// "1–7 Sep" / "29 Sep – 5 Oct"
const weekRange = (start) => {
  const end = addDays(start, 6);
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${Number(start.slice(8))}–${fmtDay(end)}`
    : `${fmtDay(start)} – ${fmtDay(end)}`;
};
const pctStr = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default function UserMetricsPage() {
  const router = useRouter();
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [audience, setAudience] = useState("all"); // all | premium | free
  const [range, setRange] = useState(30);
  const [rebuild, setRebuild] = useState({ busy: false, msg: "", confirm: false });
  const [now, setNow] = useState(() => Date.now()); // ticks so "updated N min ago" stays current
  const { runWithPassword, passwordModal } = useActionPassword();

  // quiet = background refresh (keeps showing the current numbers while it loads)
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/analytics/usage", { cache: "no-store" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setSnap(j);
    } catch (e) {
      setError(e?.message || "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = setInterval(() => { if (document.visibilityState === "visible") load(true); }, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [load]);
  const updatedAgo = (() => {
    if (!snap?.generatedAt) return "";
    const mins = Math.max(0, Math.round((now - new Date(snap.generatedAt).getTime()) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 48 ? `${h} h ago` : new Date(snap.generatedAt).toLocaleString();
  })();
  const stale = snap?.generatedAt && now - new Date(snap.generatedAt).getTime() > 10 * 60 * 1000; // backend flushes every ~2 min

  const doRebuild = async () => {
    setRebuild({ busy: true, msg: "", confirm: false });
    try {
      const r = await runWithPassword((password) => fetch("/api/analytics/usage", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      }));
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Rebuild failed");
      setRebuild({ busy: false, msg: `✓ Full rescan done: ${j.userCount.toLocaleString()} users.`, confirm: false });
      await load();
    } catch (e) {
      setRebuild({ busy: false, msg: `Full rescan failed: ${e?.message || "unknown error"}`, confirm: false });
    }
  };

  const today = istDay();

  // Per-user prep: signup day, sorted active days, premium-on-day
  const users = useMemo(() => (snap?.users || []).map((u) => {
    const days = Object.keys(u.d || {}).sort();
    const signup = u.c || days[0] || null;
    return {
      id: u.id, signup, premium: !!u.p, premiumSince: u.ps || null, d: u.d || {}, days, daySet: new Set(days),
      premiumOn: (day) => !!u.p && (!u.ps || day >= u.ps),
    };
  }).filter((u) => u.signup), [snap]);

  const inAudience = useCallback((u) => audience === "all" || (audience === "premium" ? u.premium : !u.premium), [audience]);
  const aud = useMemo(() => users.filter(inAudience), [users, inAudience]);

  // ── headline numbers ──
  const kpi = useMemo(() => {
    const activeIn = (from, to) => aud.filter((u) => u.days.some((d) => d >= from && d <= to)).length;
    const dau = activeIn(today, today);
    const yesterday = activeIn(addDays(today, -1), addDays(today, -1));
    const wau = activeIn(addDays(today, -6), today);
    const mau = activeIn(addDays(today, -29), today);
    const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
    const avgDau7 = last7.reduce((a, d) => a + aud.filter((u) => u.daySet.has(d)).length, 0) / 7;
    const premiumToday = users.filter((u) => u.daySet.has(today) && u.premiumOn(today)).length;
    const newSignups7 = aud.filter((u) => u.signup >= addDays(today, -6)).length;
    return { dau, yesterday, wau, mau, stickiness: mau ? avgDau7 / mau : 0, premiumToday, newSignups7, total: aud.length,
      premiumUsers: users.filter((u) => u.premium).length };
  }, [aud, users, today]);

  // ── daily actives (all vs premium) ──
  const series = useMemo(() => Array.from({ length: range }, (_, i) => {
    const day = addDays(today, i - range + 1);
    let all = 0, prem = 0, opens = 0;
    for (const u of aud) {
      if (!u.daySet.has(day)) continue;
      all++;
      if (u.premiumOn(day)) prem++;
      opens += u.d[day]?.login || 0;
    }
    return { day, all, premium: prem, opens };
  }), [aud, range, today]);

  // ── usage by account age: first N days after signup, and last N days ──
  const byAge = useMemo(() => [3, 7, 30].map((n) => {
    const eligible = aud.filter((u) => u.signup >= USAGE_FROM && diffDays(u.signup, today) >= n - 1);
    const first = eligible.map((u) => {
      const end = addDays(u.signup, n - 1);
      return u.days.filter((d) => d >= u.signup && d <= end).length;
    });
    const recent = eligible.map((u) => {
      const from = addDays(today, -(n - 1));
      return u.days.filter((d) => d >= from && d <= today).length;
    });
    const signups = eligible.map((u) => u.signup).sort();
    const buckets = n === 3
      ? [["Didn't open it", (x) => x === 0], ["1 day", (x) => x === 1], ["2 days", (x) => x === 2], ["All 3 days", (x) => x === 3]]
      : n === 7
      ? [["Didn't open it", (x) => x === 0], ["1 day", (x) => x === 1], ["2–3 days", (x) => x >= 2 && x <= 3], ["4–7 days", (x) => x >= 4]]
      : [["Didn't open it", (x) => x === 0], ["1 day", (x) => x === 1], ["2–3 days", (x) => x >= 2 && x <= 3], ["4–9 days", (x) => x >= 4 && x <= 9], ["10+ days", (x) => x >= 10]];
    const summary = (arr) => ({
      users: arr.length,
      avg: arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
      returned: arr.filter((x) => x >= 2).length,
      anyActive: arr.filter((x) => x >= 1).length,
      buckets: buckets.map(([label, test]) => ({ label, count: arr.filter(test).length })),
    });
    return { n, first: summary(first), recent: summary(recent), from: signups[0] || null, to: signups[signups.length - 1] || null };
  }), [aud, today]);
  const [usageMode, setUsageMode] = useState("first"); // first | recent

  // ── weekly signup cohorts: % who came back within N days ──
  const cohorts = useMemo(() => {
    const weekStart = (s) => { const dow = (new Date(toUTC(s)).getUTCDay() + 6) % 7; return addDays(s, -dow); };
    const groups = new Map();
    for (const u of aud) {
      const w = weekStart(u.signup);
      if (!groups.has(w)) groups.set(w, []);
      groups.get(w).push(u);
    }
    const weeks = [...groups.keys()].sort().reverse().slice(0, 10);
    const N = [1, 3, 7, 14, 30];
    return weeks.map((w) => {
      const list = groups.get(w);
      const cells = N.map((n) => {
        const eligible = list.filter((u) => diffDays(u.signup, today) >= n);
        if (!eligible.length) return null;
        const back = eligible.filter((u) => u.days.some((d) => d > u.signup && d <= addDays(u.signup, n))).length;
        return { n, pct: back / eligible.length, back, of: eligible.length };
      });
      return { week: w, size: list.length, cells };
    });
  }, [aud, today]);
  const RET_WINDOWS = [[1, "Next day"], [3, "3 days"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"]];
  const retentionOverall = useMemo(() => RET_WINDOWS.map(([n], i) => {
    let back = 0, of = 0;
    cohorts.forEach((c) => { const cell = c.cells[i]; if (cell) { back += cell.back; of += cell.of; } });
    return { n, back, of, pct: of ? back / of : null };
  }), [cohorts]);

  // ── features per day: unique users who used each feature ──
  const [featDays, setFeatDays] = useState(14);
  const features = useMemo(() => {
    const days = Array.from({ length: featDays }, (_, i) => addDays(today, i - featDays + 1));
    const rows = FEATURE_NAMES.map((name) => ({ name, perDay: days.map(() => 0), users: new Set() }));
    const idx = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i]));
    days.forEach((day, di) => {
      for (const u of users) {
        const steps = u.d[day];
        if (!steps) continue;
        if (audience === "premium" && !u.premiumOn(day)) continue;
        if (audience === "free" && u.premiumOn(day)) continue;
        const used = new Set(Object.keys(steps).map(featureOf).filter(Boolean));
        used.forEach((f) => { rows[idx[f]].perDay[di]++; rows[idx[f]].users.add(u.id); });
      }
    });
    const max = Math.max(1, ...rows.flatMap((r) => r.perDay));
    return { days, rows: rows.filter((r) => r.users.size > 0).sort((a, b) => b.users.size - a.users.size), max };
  }, [users, audience, featDays, today]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-btn-ghost:hover, .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; }
        .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
        .scroll-x { overflow-x: auto; }
        .usage-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .ret-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
        @media (max-width: 700px) { .ret-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 900px) { .usage-grid { grid-template-columns: 1fr; } }
        table.m { border-collapse: separate; border-spacing: 3px; font-size: 13px; width: 100%; }
        table.m th { font-size: 11px; font-weight: 700; color: #7b6b6b; text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 8px; white-space: nowrap; }
        table.m td { padding: 7px 8px; border-radius: 7px; white-space: nowrap; }
      `}</style>
      {passwordModal}

      {/* Top nav */}
      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="th-btn-ghost" onClick={() => router.push("/")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#ab1f10", padding: "8px 12px", borderRadius: 9 }}>← Home</button>
          <button className="th-btn-ghost" onClick={() => router.push("/analytics")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#7b241c", padding: "8px 12px", borderRadius: 9 }}>User Analytics</button>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>User Metrics</span>
        <Segmented value={audience} onChange={setAudience} options={[["all", "All users"], ["premium", "👑 Premium"], ["free", "Free"]]} />
      </div>

      <div className="m-pad" style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Live status */}
        <div style={{ ...GL.card, padding: "12px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1a0a09", flex: "1 1 300px" }}>
            {snap?.exists ? (
              <>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: stale ? "#d97706" : "#16a34a",
                  boxShadow: stale ? "none" : "0 0 0 3px rgba(22,163,74,0.18)" }} />
                <b>{stale ? "Not updated recently" : "Live"}</b>
                <span style={{ color: "#7b6b6b" }}>
                  · updated {updatedAgo} · {Number(snap.userCount || users.length).toLocaleString()} number users · refreshes every 2 min
                </span>
              </>
            ) : loading ? "Loading…" : "No metrics file yet."}
          </span>
          <button className="th-btn-outline" style={{ ...GL.btnOutline, opacity: loading ? 0.6 : 1 }} disabled={loading} onClick={() => load(true)}>
            ↻ Refresh
          </button>
          {!rebuild.confirm ? (
            <button onClick={() => setRebuild((r) => ({ ...r, confirm: true, msg: "" }))} disabled={rebuild.busy}
              title="Rescans every user and overwrites the metrics file — only needed if the automatic updates break"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#9b8b88", textDecoration: "underline" }}>
              {rebuild.busy ? "Rescanning every user… (a few minutes)" : "Full rescan (fallback)"}
            </button>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexBasis: "100%", fontSize: 12.5, color: "#92400e",
              background: "rgba(217,119,6,0.1)", borderRadius: 10, padding: "8px 11px", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 260px" }}>
                Only needed if automatic updates stop. It overwrites the file, and steps logged while it runs may be counted twice in per-day step counts.
              </span>
              <button className="th-btn-outline" style={GL.btnOutline} onClick={doRebuild}>Rescan anyway</button>
              <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setRebuild((r) => ({ ...r, confirm: false }))}>Cancel</button>
            </span>
          )}
          {rebuild.msg && <span style={{ flexBasis: "100%", fontSize: 13, fontWeight: 600, color: rebuild.msg.startsWith("✓") ? "#15803d" : "#c0392b" }}>{rebuild.msg}</span>}
        </div>
        {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}

        {snap?.exists && (
          <>
            {/* KPIs */}
            <div className="kpis">
              <Kpi label="Active today" value={kpi.dau} sub={`yesterday ${kpi.yesterday}`} />
              <Kpi label="Active · 7 days" value={kpi.wau} sub="weekly active users" />
              <Kpi label="Active · 30 days" value={kpi.mau} sub="monthly active users" />
              <Kpi label="Stickiness" value={`${Math.round(kpi.stickiness * 100)}%`} sub="avg daily ÷ monthly actives" />
              <Kpi label="👑 Premium active today" value={kpi.premiumToday} sub={`${kpi.premiumUsers} premium users in total`} accent={C_PREMIUM} />
              <Kpi label="New signups · 7 days" value={kpi.newSignups7} sub={`${kpi.total.toLocaleString()} users${audience !== "all" ? " in this view" : ""}`} />
            </div>

            {/* Daily actives */}
            <Section title="Daily active users" sub="Users who opened the app (any step) each day."
              right={<Segmented value={String(range)} onChange={(v) => setRange(Number(v))} options={[["14", "14 d"], ["30", "30 d"], ["60", "60 d"], ["90", "90 d"]]} />}>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#374151", padding: "0 4px 8px" }}>
                <LegendDot color={C_ALL} label="Active users" />
                <LegendDot color={C_PREMIUM} label="👑 Premium active" />
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d) => fmtDay(d)} stroke="#D1D5DB" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} minTickGap={18} />
                  <YAxis stroke="#D1D5DB" tick={{ fontSize: 11, fill: "#6b7280" }} width={36} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<DauTooltip />} cursor={{ stroke: "rgba(0,0,0,0.15)", strokeWidth: 1 }} />
                  <Line type="monotone" dataKey="all" stroke={C_ALL} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="premium" stroke={C_PREMIUM} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </Section>

            {/* Usage by account age */}
            <Section title="How often people use the app"
              sub={`On how many different days people opened the app · users who joined from ${fmtDay(USAGE_FROM, { day: "numeric", month: "short", year: "numeric" })}`}
              right={<Segmented value={usageMode} onChange={setUsageMode}
                options={[["first", "Right after signing up"], ["recent", "In the last few days"]]} />}>
              <div style={{ fontSize: 13, color: "#52514e", background: "rgba(42,120,214,0.06)", borderRadius: 10, padding: "9px 12px" }}>
                {usageMode === "first"
                  ? <>For each new user, we count on how many <b>different days</b> they opened the app in their <b>first 3 days, first week and first month</b> after signing up. A user only counts once their account is that old.</>
                  : <>For each user, we count on how many <b>different days</b> they opened the app in the <b>last 3 days, last week and last month</b> (up to today).</>}
              </div>
              <div className="usage-grid">
                {byAge.map(({ n, first, recent, from, to }) => (
                  <UsageCard key={n} n={n} mode={usageMode} s={usageMode === "first" ? first : recent} from={from} to={to} />
                ))}
              </div>
            </Section>

            {/* Retention */}
            <Section title="Do new users come back?" sub="% of new users who opened the app again within…">
              {/* all signup weeks together */}
              <div className="ret-grid">
                {RET_WINDOWS.map(([n, label], i) => {
                  const r = retentionOverall[i];
                  return (
                    <div key={n} title={r.of ? `${r.back} of ${r.of} new users came back within ${label.toLowerCase()}` : "No signups old enough yet"}
                      style={{ background: "rgba(255,255,255,0.7)", borderRadius: 12, border: "1px solid rgba(0,0,0,0.05)", padding: "12px 12px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: "#1a0a09", margin: "4px 0 6px" }}>{r.pct == null ? "—" : `${Math.round(r.pct * 100)}%`}</div>
                      <div style={{ height: 6, borderRadius: 3, background: "rgba(0,0,0,0.05)", overflow: "hidden" }}>
                        <div style={{ width: `${(r.pct || 0) * 100}%`, height: "100%", background: C_ALL, borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: 11, color: "#9b8b88", marginTop: 5 }}>{r.of ? `${r.back.toLocaleString()} of ${r.of.toLocaleString()}` : "too new"}</div>
                    </div>
                  );
                })}
              </div>

              {/* by signup week */}
              <div className="scroll-x">
                <table className="m">
                  <thead>
                    <tr>
                      <th rowSpan={2} style={{ textAlign: "left", verticalAlign: "bottom" }}>Joined</th>
                      <th rowSpan={2} style={{ verticalAlign: "bottom" }}>New users</th>
                      <th colSpan={RET_WINDOWS.length} style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>Came back within</th>
                    </tr>
                    <tr>{RET_WINDOWS.map(([n, label]) => <th key={n}>{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cohorts.map((c) => (
                      <tr key={c.week}>
                        <td style={{ fontWeight: 600, color: "#1a0a09" }}>{weekRange(c.week)}</td>
                        <td style={{ textAlign: "center", color: "#52514e" }}>{c.size}</td>
                        {c.cells.map((cell, i) => cell ? (
                          <td key={i} title={`${cell.back} of ${cell.of} came back within ${RET_WINDOWS[i][1].toLowerCase()}`}
                            style={{ textAlign: "center", background: heat(cell.pct, 1), color: heatText(cell.pct, 1), fontWeight: 700, minWidth: 64 }}>
                            {Math.round(cell.pct * 100)}%
                          </td>
                        ) : (
                          <td key={i} title="This week's users haven't had their accounts that long yet"
                            style={{ textAlign: "center", color: "#c8bebc", fontSize: 11, minWidth: 64 }}>too new</td>
                        ))}
                      </tr>
                    ))}
                    {cohorts.length === 0 && <tr><td colSpan={7} style={{ color: "#9b8b88" }}>No signups yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#9b8b88" }}>
                <span>Lower</span>
                {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => <span key={v} style={{ width: 22, height: 10, borderRadius: 3, background: heat(v, 1) }} />)}
                <span>Higher % came back</span>
              </div>
            </Section>

            {/* Features per day */}
            <Section title="Features used each day"
              sub={`Unique ${audience === "premium" ? "premium " : audience === "free" ? "free " : ""}users who used each feature that day (premium = had premium on that day).`}
              right={<Segmented value={String(featDays)} onChange={(v) => setFeatDays(Number(v))} options={[["7", "7 d"], ["14", "14 d"], ["30", "30 d"]]} />}>
              <div className="scroll-x">
                <table className="m">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Feature</th>
                      <th>Users</th>
                      {features.days.map((d) => <th key={d} title={fmtDay(d, { weekday: "long", day: "numeric", month: "short" })}>{fmtDay(d)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {features.rows.map((r) => (
                      <tr key={r.name}>
                        <td style={{ fontWeight: 600, color: "#1a0a09" }}>{r.name}</td>
                        <td style={{ textAlign: "center", fontWeight: 700, color: "#1a0a09" }}>{r.users.size}</td>
                        {r.perDay.map((v, i) => (
                          <td key={i} title={`${r.name} · ${fmtDay(features.days[i])}: ${v} user${v === 1 ? "" : "s"}`}
                            style={{ textAlign: "center", background: heat(v, features.max), color: heatText(v, features.max), minWidth: 38 }}>
                            {v || ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {features.rows.length === 0 && (
                      <tr><td colSpan={features.days.length + 2} style={{ color: "#9b8b88" }}>No feature usage in this range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* One user */}
            <UserLookup users={users} today={today} />
          </>
        )}
      </div>
    </div>
  );
}

const WINDOW_NAME = { 3: "3 days", 7: "week", 30: "month" };

function UsageCard({ n, mode, s, from, to }) {
  const first = mode === "first";
  const title = first ? `First ${WINDOW_NAME[n]}` : `Last ${WINDOW_NAME[n]}`;
  const max = Math.max(1, ...s.buckets.map((b) => b.count));
  return (
    <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)", padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#7b241c", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {title} <span style={{ fontWeight: 600, color: "#9b8b88", textTransform: "none", letterSpacing: 0 }}>({n} days)</span>
      </div>

      {s.users === 0 ? (
        <div style={{ fontSize: 13, color: "#9b8b88" }}>
          {first ? `No one who joined from 1 Sep has had their account for ${n} days yet.` : "No users yet."}
        </div>
      ) : (
        <>
          {/* the headline, as a sentence */}
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 34, fontWeight: 800, color: "#1a0a09", lineHeight: 1 }}>{s.avg.toFixed(1)}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#52514e" }}>of {n} days</span>
            </div>
            <div style={{ fontSize: 13, color: "#52514e", marginTop: 6, lineHeight: 1.4 }}>
              {first
                ? <>On average, a new user opened the app on <b>{s.avg.toFixed(1)} different days</b> in their first {n} days.</>
                : <>On average, a user opened the app on <b>{s.avg.toFixed(1)} different days</b> in the last {n} days.</>}
            </div>
          </div>

          <div style={{ fontSize: 13, color: "#1a0a09", background: "rgba(42,120,214,0.08)", borderRadius: 9, padding: "8px 10px" }}>
            {first
              ? <><b>{pctStr(s.returned, s.users)}</b> came back on a second day ({s.returned.toLocaleString()} of {s.users.toLocaleString()})</>
              : <><b>{pctStr(s.anyActive, s.users)}</b> opened the app at least once ({s.anyActive.toLocaleString()} of {s.users.toLocaleString()})</>}
          </div>

          {/* breakdown: how many users opened it on how many days */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Opened the app on…
            </div>
            {s.buckets.map((b, i) => (
              <div key={b.label} title={`${b.count} users`} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 82px", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                <span style={{ color: "#374151" }}>{b.label}</span>
                <div style={{ height: 12, borderRadius: 6, background: "rgba(0,0,0,0.04)", overflow: "hidden" }}>
                  <div style={{ width: `${(b.count / max) * 100}%`, height: "100%", borderRadius: 6, background: heat(i + 1, s.buckets.length) }} />
                </div>
                <span style={{ textAlign: "right", color: "#1a0a09" }}>
                  <b>{pctStr(b.count, s.users)}</b> <span style={{ color: "#9b8b88" }}>· {b.count.toLocaleString()}</span>
                </span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: "#9b8b88", borderTop: "1px solid rgba(0,0,0,0.05)", paddingTop: 8 }}>
            Based on {s.users.toLocaleString()} user{s.users === 1 ? "" : "s"} who joined {from ? fmtDay(from) : "—"} – {to ? fmtDay(to) : "—"}
            {first ? ` (accounts at least ${n} days old)` : ""}.
          </div>
        </>
      )}
    </div>
  );
}

function UserLookup({ users, today }) {
  const [q, setQ] = useState("");
  const [id, setId] = useState(null);
  const matches = useMemo(() => {
    const t = q.trim();
    return t ? users.filter((u) => u.id.includes(t)).slice(0, 8) : [];
  }, [users, q]);
  const u = users.find((x) => x.id === id) || null;

  const stats = useMemo(() => {
    if (!u) return null;
    const inLast = (n) => u.days.filter((d) => d >= addDays(today, -(n - 1)) && d <= today).length;
    const feats = {};
    for (const day of u.days) {
      const used = new Set(Object.keys(u.d[day]).map(featureOf).filter(Boolean));
      used.forEach((f) => { feats[f] = (feats[f] || 0) + 1; });
    }
    const opens = u.days.reduce((a, d) => a + (u.d[d].login || 0), 0);
    return {
      age: diffDays(u.signup, today) + 1, last3: inLast(3), last7: inLast(7), last30: inLast(30), total: u.days.length,
      lastSeen: u.days[u.days.length - 1] || null, opens, feats: Object.entries(feats).sort((a, b) => b[1] - a[1]),
      strip: Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)),
    };
  }, [u, today]);

  return (
    <Section title="One user" sub="Search a number to see how they use the app.">
      <div style={{ position: "relative", maxWidth: 360 }}>
        <input style={GL.input} placeholder="Search by number…" value={q} onChange={(e) => { setQ(e.target.value); setId(null); }} inputMode="search" />
        {matches.length > 0 && !u && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", borderRadius: 10, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", overflow: "hidden" }}>
            {matches.map((m) => (
              <div key={m.id} onClick={() => { setId(m.id); setQ(m.id); }}
                style={{ padding: "9px 12px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid rgba(0,0,0,0.04)", display: "flex", justifyContent: "space-between" }}>
                <span>{m.id}</span><span style={{ color: "#9b8b88" }}>{m.premium ? "👑 " : ""}{m.days.length} active day{m.days.length === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {u && stats && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
          <div className="kpis">
            <Kpi label="Signed up" value={fmtDay(u.signup, { day: "numeric", month: "short", year: "numeric" })} sub={`${stats.age} day${stats.age === 1 ? "" : "s"} ago`} small />
            <Kpi label="Premium" value={u.premium ? "👑 Yes" : "No"} sub={u.premiumSince ? `since ${fmtDay(u.premiumSince)}` : u.premium ? "since: unknown" : ""} small accent={u.premium ? C_PREMIUM : undefined} />
            <Kpi label="Active · last 3 days" value={stats.last3} sub="days" small />
            <Kpi label="Active · last 7 days" value={stats.last7} sub="days" small />
            <Kpi label="Active · last 30 days" value={stats.last30} sub="days" small />
            <Kpi label="All time" value={stats.total} sub={`active days · ${stats.opens} logins · last seen ${stats.lastSeen ? fmtDay(stats.lastSeen) : "—"}`} small />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7b6b6b", marginBottom: 6 }}>LAST 30 DAYS</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(30, minmax(0, 1fr))", gap: 3 }}>
              {stats.strip.map((d) => {
                const steps = u.d[d];
                const n = steps ? Object.values(steps).reduce((a, b) => a + b, 0) : 0;
                return (
                  <div key={d} title={`${fmtDay(d, { weekday: "short", day: "numeric", month: "short" })}: ${n ? `${n} steps` : "not active"}`}
                    style={{ aspectRatio: "1", borderRadius: 4, background: n ? heat(Math.min(n, 30), 30) : "rgba(0,0,0,0.05)" }} />
                );
              })}
            </div>
          </div>
          {stats.feats.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7b6b6b", marginBottom: 6 }}>FEATURES (DAYS USED)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {stats.feats.map(([f, n]) => (
                  <span key={f} style={{ fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 999, background: "rgba(42,120,214,0.1)", color: "#1a0a09" }}>
                    {f} · {n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function DauTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", fontSize: 13, minWidth: 170 }}>
      <div style={{ fontWeight: 700, color: "#1a0a09", marginBottom: 6 }}>{fmtDay(label, { weekday: "short", day: "numeric", month: "short" })}</div>
      <TipRow color={C_ALL} label="Active users" value={r.all} />
      <TipRow color={C_PREMIUM} label="👑 Premium active" value={r.premium} />
      <div style={{ color: "#7b6b6b", fontSize: 12, marginTop: 4 }}>{r.opens} logins</div>
    </div>
  );
}
const TipRow = ({ color, label, value }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
    <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
    <span style={{ flex: 1, color: "#374151" }}>{label}</span><b style={{ color: "#1a0a09" }}>{value}</b>
  </div>
);
const LegendDot = ({ color, label }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 3, borderRadius: 2, background: color }} /> {label}</span>
);

function Kpi({ label, value, sub, accent, small }) {
  return (
    <div style={{ ...GL.card, padding: small ? "12px 14px" : "16px 18px", borderLeft: accent ? `4px solid ${accent}` : GL.card.border }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: small ? 20 : 30, fontWeight: 800, color: "#1a0a09", margin: "4px 0 2px" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub && <div style={{ fontSize: 12, color: "#9b8b88" }}>{sub}</div>}
    </div>
  );
}

function Section({ title, sub, right, children }) {
  return (
    <div style={{ ...GL.card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={GL.h}>{title}</div>
          {sub && <div style={GL.sub}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 10, padding: 3, gap: 3 }}>
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          border: "none", cursor: "pointer", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
          background: value === k ? "#fff" : "transparent", color: value === k ? "#ab1f10" : "#9b4a42",
          boxShadow: value === k ? "0 2px 8px rgba(171,31,16,0.15)" : "none",
        }}>{l}</button>
      ))}
    </div>
  );
}
