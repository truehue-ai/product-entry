"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { useActionPassword } from "../components/useActionPassword";
import { METRIC_GROUPS } from "../lib/adsPlatformGoals";
import { formatMetric, fmtDate, fmtMonth, COME_BACK_WINDOWS } from "../lib/adsPlatformMetrics";

// Ads Platform Metrics (dhruvi; jagat can view, not rebuild): is the paid community ready to sell ad placements to beauty brands?
// Each metric's current value next to its goal for every stage. Goals: app/lib/adsPlatformGoals.js.
// Calculations: app/lib/adsPlatformMetrics.js. Data: one snapshot that the backend keeps up to date (merged every
// ~2 min); this page re-reads it every 2 minutes. "Full rebuild" seeds the history once / is a manual fallback.

const REFRESH_MS = 120 * 1000; // matches the backend's USAGE_FLUSH_SECONDS

const GL = {
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
};
// Same validated pair as User Metrics
const C_MAU = "#2a78d6";
const C_PAID = "#eb6834";
const MET_BG = "rgba(22,163,74,0.14)";
const MET_INK = "#15803d";
const UNMET_BG = "rgba(0,0,0,0.04)";
const UNMET_INK = "#7b6b6b";

export default function AdsPlatformMetricsPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rebuild, setRebuild] = useState({ busy: false, msg: "" });
  const { runWithPassword, passwordModal } = useActionPassword();

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_user=([^;]+)/);
    if (!m) { router.push("/login"); return; }
    setMe(decodeURIComponent(m[1]));
  }, [router]);
  const allowed = me === "dhruvi" || me === "jagat";
  const canRebuild = me === "dhruvi";

  // quiet = background refresh (keeps showing the current numbers while it loads)
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/analytics/ads-platform", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Failed to load metrics");
      setData(j);
    } catch (e) {
      setError(e?.message || "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  useEffect(() => {
    if (!allowed) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(true); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [allowed, load]);

  const doRebuild = async () => {
    setRebuild({ busy: true, msg: "" });
    try {
      const r = await runWithPassword((password) => fetch("/api/analytics/ads-platform", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      }));
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Rebuild failed");
      setRebuild({ busy: false, msg: `✓ Rebuilt from ${j.userCount.toLocaleString()} users.` });
      await load();
    } catch (e) {
      setRebuild({ busy: false, msg: `Rebuild failed: ${e?.message || "unknown error"}` });
    }
  };

  if (!me) return null;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-btn-ghost:hover, .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; }
        .ap-stages { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .ap-aud { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
        .scroll-x { overflow-x: auto; }
        table.ap { border-collapse: separate; border-spacing: 3px; font-size: 13.5px; width: 100%; }
        table.ap th { font-size: 11px; font-weight: 700; color: #7b6b6b; text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 10px; text-align: left; white-space: nowrap; }
        table.ap td { padding: 9px 10px; border-radius: 8px; vertical-align: top; }
        @media (max-width: 640px) { .m-pad { padding: 16px !important; } .m-topbar { padding: 12px 16px !important; } }
      `}</style>
      {passwordModal}

      {/* Top nav */}
      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <button className="th-btn-ghost" onClick={() => router.push("/")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#ab1f10", padding: "8px 12px", borderRadius: 9 }}>← Home</button>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Ads Platform Metrics</span>
        <span style={{ width: 80 }} />
      </div>

      <div className="m-pad" style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
        {!allowed ? (
          <div style={{ ...GL.card, padding: 18, fontSize: 15 }}>You don't have access to Ads Platform Metrics.</div>
        ) : (
          <>
            <Header data={data} loading={loading} rebuild={rebuild} onRebuild={canRebuild ? doRebuild : null} onRefresh={() => load(true)} />
            {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}
            {data?.exists && (
              <>
                <StageCards stages={data.stages} />
                <MetricsTable rows={data.rows} stages={data.stages} />
                <Cohorts cohorts={data.cohorts} />
                <ComeBack data={data.comeBack} startDate={data.startDate} />
                <Audience audience={data.audience} notTracked={data.audienceNotTracked} />
                <Trend trend={data.trend} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── header: title, last updated, start date, current stage, rebuild ──
function Header({ data, loading, rebuild, onRebuild, onRefresh }) {
  const p = data?.paid;
  const other = p ? Object.entries(p.other) : [];
  const ageMin = data?.generatedAt ? (Date.now() - new Date(data.generatedAt).getTime()) / 60000 : null;
  const stale = ageMin != null && ageMin > 60; // no events merged in the last hour
  return (
    <div style={{ ...GL.card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1a0a09", letterSpacing: "-0.4px" }}>Ads Platform Metrics</div>
          <div style={{ fontSize: 13, color: "#7b6b6b", marginTop: 4 }}>
            {data?.exists
              ? <>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", marginRight: 6, background: stale ? "#d97706" : "#16a34a" }} />
                  {stale ? "Not updated recently" : "Live"} · last updated {new Date(data.generatedAt).toLocaleString()} · Paid members counted from {fmtDate(data.startDate)}
                </>
              : loading ? "Loading…" : "No snapshot yet — press Full rebuild once to load the history (takes a few minutes)."}
          </div>
        </div>
        {data?.exists && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Current stage</span>
            <span style={{
              fontSize: 15, fontWeight: 800, padding: "6px 14px", borderRadius: 999,
              background: data.currentStage === "Pre-pilot" ? "rgba(0,0,0,0.06)" : MET_BG,
              color: data.currentStage === "Pre-pilot" ? "#4a3a3a" : MET_INK,
            }}>{data.currentStage === "Pre-pilot" ? "Pre-pilot" : `✓ ${data.currentStage}`}</span>
          </div>
        )}
      </div>

      {data?.needsRebuild && (
        <div style={{ fontSize: 12.5, color: "#92400e", background: "rgba(217,119,6,0.1)", borderRadius: 10, padding: "9px 12px" }}>
          This data has no history loaded yet. Press <b>Full rebuild</b> once — after that the backend keeps it up to date on its own.
        </div>
      )}

      {p && (
        <div style={{ fontSize: 12.5, color: "#4a3a3a", background: "rgba(171,31,16,0.05)", borderRadius: 10, padding: "9px 12px", lineHeight: 1.6 }}>
          <b>{p.members.toLocaleString()}</b> paid members (lifetime pass, account created from {fmtDate(data.startDate)})
          {" "}· <b>{p.engaged.toLocaleString()}</b> of them engaged in the last 30 days. <b>Every metric on this page is about these paid members</b>, except rows marked "all users".
          <br />
          Not counted:{" "}
          {other.length > 0 && <>{other.map(([t, n]) => `${n.toLocaleString()} other pass (${t})`).join(", ")} · </>}
          {p.noDate.toLocaleString()} with a pass but no createdAt · {p.beforeStart.toLocaleString()} with a pass whose account was created before {fmtDate(data.startDate)}
          {" "}· web-funnel guest accounts aren't included ({data.scannedUsers.toLocaleString()} app users scanned).
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="th-btn-outline" style={{ ...GL.btnOutline, opacity: loading ? 0.6 : 1 }} disabled={loading} onClick={onRefresh}>↻ Refresh</button>
        {onRebuild && <button onClick={onRebuild} disabled={rebuild.busy}
          title="Rescans every user and Product Analytics and overwrites the snapshot — only needed once, or if the live updates break"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#9b8b88", textDecoration: "underline" }}>
          {rebuild.busy ? "Rebuilding every user… (a few minutes)" : "Full rebuild (fallback)"}
        </button>}
        {rebuild.msg && <span style={{ fontSize: 13, fontWeight: 600, color: rebuild.msg.startsWith("✓") ? MET_INK : "#c0392b" }}>{rebuild.msg}</span>}
      </div>
    </div>
  );
}

// ── stage progress cards ──
function StageCards({ stages }) {
  return (
    <div className="ap-stages">
      {stages.map((s) => (
        <div key={s.key} style={{ ...GL.card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#1a0a09" }}>{s.done ? "✓ " : ""}{s.label}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: s.done ? MET_INK : "#4a3a3a" }}>{s.met} / {s.total} met</span>
          </div>
          <div style={{ height: 8, background: "rgba(0,0,0,0.06)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${s.total ? (s.met / s.total) * 100 : 0}%`, height: "100%", background: s.done ? "#16a34a" : "#ab1f10", borderRadius: 999 }} />
          </div>
          <div style={{ fontSize: 12, color: "#9b8b88" }}>{s.description}</div>
        </div>
      ))}
    </div>
  );
}

// ── main table ──
function MetricsTable({ rows, stages }) {
  return (
    <Section title="Metrics vs goals" sub="Green = current value meets the goal. Pilot also shows how much of the goal is reached.">
      <div className="scroll-x">
        <table className="ap">
          <thead>
            <tr>
              <th>Metric</th><th>Current</th>
              {stages.map((s) => <th key={s.key}>{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {METRIC_GROUPS.map((g) => {
              const groupRows = rows.filter((r) => r.group === g);
              if (!groupRows.length) return null;
              return [
                <tr key={`g-${g}`}>
                  <td colSpan={2 + stages.length} style={{ ...GL.h, fontSize: 11.5, padding: "14px 10px 4px" }}>{g}</td>
                </tr>,
                ...groupRows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ minWidth: 200, fontWeight: 600, color: "#1a0a09" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{r.label} <Info text={r.definition} /></span>
                    </td>
                    <td style={{ minWidth: 150, background: "rgba(255,255,255,0.7)" }}>
                      {r.value != null ? (
                        <>
                          <div style={{ fontSize: 16, fontWeight: 800, color: "#1a0a09" }}>{formatMetric(r.value, r.format)}</div>
                          {r.note && <div style={{ fontSize: 11.5, color: "#9b8b88", marginTop: 2 }}>{r.note}</div>}
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#7b6b6b" }}>{r.notTracked ? "Not tracked yet" : "—"}</div>
                          {r.note && <div style={{ fontSize: 11.5, color: "#9b8b88", marginTop: 2, whiteSpace: "normal", maxWidth: 240 }}>{r.note}</div>}
                        </>
                      )}
                    </td>
                    {stages.map((s, i) => {
                      const goal = r.goals?.[s.key];
                      if (goal == null) return <td key={s.key} style={{ color: "#b8a8a5" }}>—</td>;
                      const met = r.met[s.key];
                      const reached = i === 0 && r.value != null && goal > 0 ? Math.round((r.value / goal) * 100) : null;
                      return (
                        <td key={s.key} style={{ background: met ? MET_BG : UNMET_BG, color: met ? MET_INK : UNMET_INK, fontWeight: 700, whiteSpace: "nowrap" }}>
                          {met ? "✓ " : ""}{formatMetric(goal, r.format)}
                          {reached != null && <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>{reached}% of goal</div>}
                        </td>
                      );
                    })}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// small "i" with the definition on hover / tap
function Info({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="What this means" onClick={() => setOpen((o) => !o)}
        style={{ width: 17, height: 17, borderRadius: "50%", border: "1.5px solid #c9b8b5", background: "#fff", color: "#7b6b6b",
          fontSize: 10.5, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>i</button>
      {open && (
        <span role="tooltip" style={{
          position: "absolute", left: 0, top: 22, zIndex: 30, width: 260, background: "#1a0a09", color: "#fff", fontSize: 12,
          fontWeight: 500, lineHeight: 1.45, padding: "9px 11px", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", whiteSpace: "normal",
        }}>{text}</span>
      )}
    </span>
  );
}

// ── retention cohorts ──
function Cohorts({ cohorts }) {
  const cell = (v) => (v == null ? "" : `${Math.round(v * 100)}%`);
  return (
    <Section title="Paid-member retention by signup month"
      sub="% of each month's paid members (by account creation month) who were engaged 1, 2 and 3 months later. Empty = that month isn't over yet.">
      <div className="scroll-x">
        <table className="ap">
          <thead><tr><th>Signup month</th><th>Cohort size</th><th>M1</th><th>M2</th><th>M3</th></tr></thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.month}>
                <td style={{ fontWeight: 600, color: "#1a0a09" }}>{fmtMonth(c.month)}</td>
                <td>{c.size.toLocaleString()}</td>
                {["m1", "m2", "m3"].map((k) => (
                  <td key={k} style={{ background: c[k] != null ? "rgba(42,120,214,0.1)" : "transparent", fontWeight: 700, color: "#1a0a09" }}>{cell(c[k])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── "Do paid members come back?" — same calculation as User Metrics, paid members only ──
const heat = (v) => (v == null ? "transparent" : `rgba(42,120,214,${0.12 + 0.7 * Math.min(1, v)})`);
function ComeBack({ data, startDate }) {
  if (!data) return null;
  const range = (w, e) => (w.slice(0, 7) === e.slice(0, 7)
    ? `${Number(w.slice(8))}–${fmtDate(e).replace(/ \d{4}$/, "")}`
    : `${fmtDate(w).replace(/ \d{4}$/, "")} – ${fmtDate(e).replace(/ \d{4}$/, "")}`);
  return (
    <Section title="Do paid members come back?"
      sub="Same calculation as User Metrics' “Do new users come back?” — % of paid members who opened the app again within…">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {data.overall.map((o, i) => (
          <div key={o.n} title={o.of ? `${o.back} of ${o.of} paid members came back within ${COME_BACK_WINDOWS[i][1].toLowerCase()}` : "No members old enough yet"}
            style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{COME_BACK_WINDOWS[i][1]}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#1a0a09", margin: "4px 0" }}>{o.pct == null ? "—" : `${Math.round(o.pct * 100)}%`}</div>
            <div style={{ fontSize: 12, color: "#9b8b88" }}>{o.of ? `${o.back} of ${o.of}` : "too new"}</div>
          </div>
        ))}
      </div>

      <div className="scroll-x">
        <table className="ap">
          <thead>
            <tr><th>Joined</th><th>Paid members</th>{COME_BACK_WINDOWS.map(([n, l]) => <th key={n}>{l}</th>)}</tr>
          </thead>
          <tbody>
            {data.weeks.map((w) => (
              <tr key={w.week}>
                <td style={{ fontWeight: 600, color: "#1a0a09", whiteSpace: "nowrap" }}>{range(w.week, w.weekEnd)}</td>
                <td>{w.size}</td>
                {w.cells.map((c, i) => (
                  <td key={i} title={c ? `${c.back} of ${c.of} came back within ${COME_BACK_WINDOWS[i][1].toLowerCase()}` : ""}
                    style={{ background: heat(c?.pct), fontWeight: 700, textAlign: "center", color: c && c.pct > 0.6 ? "#fff" : c ? "#1a0a09" : "#b8a8a5" }}>
                    {c ? `${Math.round(c.pct * 100)}%` : "too new"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12.5, color: "#4a3a3a", background: "rgba(0,0,0,0.04)", borderRadius: 10, padding: "10px 12px", lineHeight: 1.65 }}>
        <b>Why this is different from other numbers</b>
        <br />• <b>vs User Metrics → Premium tab:</b> there, “premium” is anyone whose paid_data says subscriber = true today —
        lifetime, 1-day / 7-day / 30-day passes and premium given by hand. Here it's only lifetime passes on accounts created from {fmtDate(startDate)}.
        <br />• <b>vs M1 retention above:</b> this counts opening the app (any step) on any day <i>soon after signup</i>.
        M1 counts a meaningful action (search, product view, try-on) at any time <i>in the whole next calendar month</i> —
        someone who joined on 5 Aug, came back on 6 Aug and then stopped is “back within 1 month” here, but not retained in M1.
      </div>
    </Section>
  );
}

// ── audience splits (engaged paid members) ──
function Audience({ audience, notTracked }) {
  const splits = [["Skin tone", audience.skinTone], ["Undertone", audience.undertone]].filter(([, rows]) => rows.length);
  return (
    <Section title="Audience — engaged paid members" sub="Who the engaged paid members are (what we pitch to brands). No goals — distribution only.">
      <div className="ap-aud">
        {splits.map(([title, rows]) => <Bars key={title} title={title} rows={rows} />)}
      </div>
      <div style={{ fontSize: 12.5, color: "#4a3a3a", background: "rgba(0,0,0,0.04)", borderRadius: 10, padding: "9px 12px", lineHeight: 1.6 }}>
        <b>Not tracked yet:</b>{" "}
        {notTracked.map((n, i) => <span key={n.label}>{i ? " · " : ""}<b>{n.label}</b> — {n.note}</span>)}
      </div>
    </Section>
  );
}

function Bars({ title, rows }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1a0a09", marginBottom: 10 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${r.count.toLocaleString()} users (${total ? Math.round((r.count / total) * 100) : 0}%)`}
          style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ width: 70, fontSize: 12.5, fontWeight: 600, color: "#4a3a3a", flexShrink: 0 }}>{r.label}</span>
          <div style={{ flex: 1, height: 12, background: "rgba(0,0,0,0.05)", borderRadius: 4 }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: "100%", background: r.label === "Not set" ? "#b8a8a5" : C_MAU, borderRadius: 4 }} />
          </div>
          <span style={{ width: 92, fontSize: 12.5, color: "#1a0a09", textAlign: "right", flexShrink: 0 }}>
            <b>{r.count.toLocaleString()}</b> <span style={{ color: "#9b8b88" }}>· {total ? Math.round((r.count / total) * 100) : 0}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── monthly trend ──
function Trend({ trend }) {
  if (!trend.length) return null;
  const rows = trend.map((t) => ({ ...t, label: `${fmtMonth(t.month)}${t.partial ? " (so far)" : ""}` }));
  return (
    <Section title="Trend by month"
      sub="Engaged paid members in each month, and paid members by account creation date (people with a lifetime pass today).">
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#374151", padding: "0 4px" }}>
        <LegendDot color={C_MAU} label="Engaged paid members" />
        <LegendDot color={C_PAID} label="Paid members" />
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
          <Tooltip content={<TrendTip />} />
          <Line type="monotone" dataKey="engagedMau" stroke={C_MAU} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
          <Line type="monotone" dataKey="paidMembers" stroke={C_PAID} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </Section>
  );
}
function TrendTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", fontSize: 13, minWidth: 170 }}>
      <div style={{ fontWeight: 700, color: "#1a0a09", marginBottom: 6 }}>{r.label}</div>
      <TipRow color={C_MAU} label="Engaged paid members" value={r.engagedMau.toLocaleString()} />
      <TipRow color={C_PAID} label="Paid members" value={r.paidMembers.toLocaleString()} />
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

function Section({ title, sub, children }) {
  return (
    <div style={{ ...GL.card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={GL.h}>{title}</div>
        {sub && <div style={GL.sub}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}
