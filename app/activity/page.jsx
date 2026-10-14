"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BRANDS_INDIA from "../shade-capture/brands-india.json";
import BRANDS_USA from "../shade-capture/brands-usa.json";
import { useActionPassword } from "../components/useActionPassword";

// Daily work log from activity/activity.json. A product counts for a day when it was newly added to S3
// that day with more than 3 shades; edits to existing products are listed but not counted.
// Days marked as holidays are left out of every average (their products still show in totals).

const MIN_SHADES = 4; // "more than 3"
// Monthly pay: average above PAY_AVG_THRESHOLD -> active working days × PAY_PER_UNIT,
// otherwise (products ÷ 10) × PAY_PER_UNIT.
const PAY_AVG_THRESHOLD = 9;
const PAY_PER_UNIT = 800;
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const USERS = ["aastha", "dhruvi"];

const GL = {
  card: {
    background: "rgba(255,255,255,0.58)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    border: "1.5px solid rgba(255,255,255,0.8)", borderRadius: 18, boxShadow: "0 4px 24px rgba(171,31,16,0.07)",
  },
  pill: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" },
  sectionHeader: { fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase" },
  btnOutline: {
    background: "rgba(255,255,255,0.7)", color: "#ab1f10", border: "1.5px solid rgba(171,31,16,0.3)", borderRadius: 11,
    padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOLIDAY_BG = "repeating-linear-gradient(135deg, rgba(14,165,233,0.14) 0 6px, rgba(255,255,255,0.65) 6px 12px)";
const MARKET_FLAG = { india: "🇮🇳", usa: "🇺🇸" };

const normKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BRAND_NAMES = {
  india: new Map(BRANDS_INDIA.map((b) => [normKey(b.slug), b.name])),
  usa: new Map(BRANDS_USA.map((b) => [normKey(b.slug), b.name])),
};
const brandName = (market, brand) => BRAND_NAMES[market]?.get(normKey(brand)) || brand;
const prettyType = (t) => (t ? t.replace(/-/g, " ") : "");

// India-time dates as "YYYY-MM-DD"
const istDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtDay = (s, opts) => parseDay(s).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
const addDays = (s, n) => { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

// One day's saves -> distinct products, with what counts
function summarise(entries = []) {
  const byProduct = new Map();
  for (const e of entries) {
    const k = `${e.market}:::${e.brand}:::${e.product}`;
    const cur = byProduct.get(k) || { ...e, saves: 0, isNew: false, shades: 0 };
    cur.saves += 1;
    cur.isNew = cur.isNew || !!e.isNew;
    cur.shades = Math.max(cur.shades, e.shades || 0);
    cur.at = e.at > (cur.at || "") ? e.at : cur.at;
    cur.productType = e.productType || cur.productType;
    byProduct.set(k, cur);
  }
  const all = [...byProduct.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const counted = all.filter((p) => p.isNew && p.shades >= MIN_SHADES);
  const fewShades = all.filter((p) => p.isNew && p.shades < MIN_SHADES);
  const edits = all.filter((p) => !p.isNew);
  return { counted, fewShades, edits, count: counted.length };
}

export default function ActivityPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [user, setUser] = useState("aastha");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openMonths, setOpenMonths] = useState(() => new Set([istDay().slice(0, 7)]));
  const [selected, setSelected] = useState(null); // { day, where: "week" | "YYYY-MM" }
  const [rebuild, setRebuild] = useState({ step: null, msg: "" });
  const { runWithPassword, passwordModal } = useActionPassword();

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_auth=([^;]+)/);
    setMe(m ? decodeURIComponent(m[1]) : "");
  }, []);

  const load = useCallback(async (u) => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/activity?user=${encodeURIComponent(u)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setData((prev) => ({ ...prev, [u]: j }));
    } catch (e) {
      setError(e?.message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, []);
  const canEdit = me === "dhruvi";
  const canView = me === "dhruvi" || me === "aastha";
  // aastha only ever sees her own activity
  useEffect(() => { if (me && me !== "dhruvi") setUser(me); }, [me]);
  useEffect(() => { if (canView && !data[user] && (canEdit || user === me)) load(user); }, [canView, canEdit, me, user, data, load]);

  const days = data[user]?.days || {};
  const holidays = data[user]?.holidays || {};
  const isHoliday = (d) => !!holidays[d];
  // average products/day over the given days, leaving holidays out
  const avgOver = (list) => {
    const work = list.filter((d) => !isHoliday(d));
    return { avg: work.length ? work.reduce((a, d) => a + countOn(d), 0) / work.length : 0, workDays: work.length, holidaysIn: list.length - work.length };
  };
  // Pay for a month, from its elapsed days
  const payFor = (list) => {
    const { avg } = avgOver(list);
    const products = list.reduce((a, d) => a + countOn(d), 0);
    const activeDays = list.filter((d) => !isHoliday(d) && countOn(d) > 0).length;
    const byDays = avg > PAY_AVG_THRESHOLD;
    const amount = byDays ? activeDays * PAY_PER_UNIT : (products / 10) * PAY_PER_UNIT;
    const working = byDays
      ? `Average ${avg.toFixed(1)} is above ${PAY_AVG_THRESHOLD} → ${activeDays} active working day${activeDays === 1 ? "" : "s"} × ${inr(PAY_PER_UNIT)}`
      : `Average ${avg.toFixed(1)} is not above ${PAY_AVG_THRESHOLD} → ${products} product${products === 1 ? "" : "s"} ÷ 10 × ${inr(PAY_PER_UNIT)}`;
    return { amount, working, byDays, activeDays, products, avg };
  };
  const summaries = useMemo(() => Object.fromEntries(Object.entries(days).map(([d, e]) => [d, summarise(e)])), [days]);
  function countOn(d) { return summaries[d]?.count || 0; }

  const today = istDay();
  const thisMonth = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  const monthTotal = Object.keys(summaries).filter((d) => d.startsWith(thisMonth)).reduce((a, d) => a + countOn(d), 0);
  const monthSoFar = Array.from({ length: dayOfMonth }, (_, i) => `${thisMonth}-${String(i + 1).padStart(2, "0")}`);
  const running = avgOver(monthSoFar);
  const runningAvg = running.avg;
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const weekTotal = last7.reduce((a, d) => a + countOn(d), 0);
  const week = avgOver(last7);
  const monthPay = payFor(monthSoFar);
  const maxCount = Math.max(1, ...Object.keys(summaries).map(countOn));

  const months = useMemo(() => {
    const set = new Set(Object.keys(days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map((d) => d.slice(0, 7)));
    set.add(thisMonth);
    return [...set].sort().reverse();
  }, [days, thisMonth]);

  const toggleMonth = (m) => setOpenMonths((prev) => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });

  const [holidayBusy, setHolidayBusy] = useState(false);
  const toggleHoliday = async (day, holiday) => {
    setHolidayBusy(true); setError("");
    try {
      const r = await fetch("/api/activity", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "holiday", user, day, holiday }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Could not update holiday");
      setData((prev) => ({ ...prev, [user]: { ...prev[user], holidays: j.holidays || {} } }));
    } catch (e) {
      setError(e?.message || "Could not update holiday");
    } finally {
      setHolidayBusy(false);
    }
  };

  const doRebuild = async () => {
    setRebuild({ step: "busy", msg: "" });
    try {
      const r = await runWithPassword((password) => fetch("/api/activity", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rebuild", user, password }),
      }));
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Rebuild failed");
      setRebuild({ step: null, msg: `✓ Rebuilt from audit history: ${j.saves} saves, ${j.products} products over ${j.days} days.` });
      await load(user);
    } catch (e) {
      setRebuild({ step: null, msg: `Rebuild failed: ${e?.message || "unknown error"}` });
    }
  };

  if (me === null) return null;
  if (!canView) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", color: "#7b241c" }}>
        Activity isn't available for this account.
      </div>
    );
  }

  const intensity = (n) => (n === 0 ? "rgba(171,31,16,0.04)" : `rgba(22,163,74,${0.18 + 0.72 * Math.min(1, n / maxCount)})`);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-btn-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .week-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
        .day-block { border-radius: 14px; padding: 12px 12px 10px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; border: 1.5px solid rgba(255,255,255,0.8); }
        .day-block:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(171,31,16,0.12); }
        .day-block.sel { outline: 2.5px solid #ab1f10; outline-offset: 1px; }
        .cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
        .cal-cell { aspect-ratio: 1; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;
          font-size: 12px; transition: transform 0.12s; border: 1px solid rgba(171,31,16,0.06); }
        .cal-cell:hover { transform: scale(1.06); }
        .cal-cell.sel { outline: 2.5px solid #ab1f10; outline-offset: 1px; }
        .cal-cell.future { opacity: 0.35; cursor: default; }
        .cal-cell.future:hover { transform: none; }
        .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
        @media (max-width: 1000px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 760px) {
          .week-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
          .stats { grid-template-columns: 1fr; }
          .cal { gap: 4px; }
          .cal-cell { font-size: 11px; border-radius: 7px; }
        }
      `}</style>
      {passwordModal}

      {/* Top nav */}
      <div style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <button className="th-btn-ghost" onClick={() => router.push("/")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#ab1f10", padding: "8px 12px", borderRadius: 9 }}>← Home</button>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Activity</span>
        {!canEdit ? (
          <span style={{ fontSize: 14, fontWeight: 600, color: "#7b241c", textTransform: "capitalize" }}>{user}</span>
        ) : (
        <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 11, padding: 3, gap: 3 }}>
          {USERS.map((u) => (
            <button key={u} onClick={() => { setUser(u); setSelected(null); }} style={{
              border: "none", cursor: "pointer", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, textTransform: "capitalize",
              background: u === user ? "#fff" : "transparent", color: u === user ? "#ab1f10" : "#9b4a42",
              boxShadow: u === user ? "0 2px 8px rgba(171,31,16,0.15)" : "none",
            }}>{u}</button>
          ))}
        </div>
        )}
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Running average */}
        <div className="stats">
          <div style={{ ...GL.card, padding: "18px 20px", background: "linear-gradient(135deg, rgba(255,255,255,0.75), rgba(220,252,231,0.75))" }}>
            <div style={GL.sectionHeader}>{fmtDay(today, { month: "long" })} running average</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: "#15803d", margin: "6px 0 2px" }}>{data[user] ? runningAvg.toFixed(1) : "—"}</div>
            <div style={{ fontSize: 13, color: "#4d7c0f" }}>
              products / day · {monthTotal} in {running.workDays} working day{running.workDays === 1 ? "" : "s"}
              {running.holidaysIn ? ` · ${running.holidaysIn} holiday${running.holidaysIn === 1 ? "" : "s"} left out` : ""}
            </div>
          </div>
          <div style={{ ...GL.card, padding: "18px 20px" }}>
            <div style={GL.sectionHeader}>Last 7 days</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: "#1a0a09", margin: "6px 0 2px" }}>{data[user] ? weekTotal : "—"}</div>
            <div style={{ fontSize: 13, color: "#9b4a42" }}>
              products · {week.avg.toFixed(1)} / working day{week.holidaysIn ? ` · ${week.holidaysIn} holiday${week.holidaysIn === 1 ? "" : "s"}` : ""}
            </div>
          </div>
          <div style={{ ...GL.card, padding: "18px 20px", background: "linear-gradient(135deg, rgba(255,255,255,0.75), rgba(254,243,199,0.8))" }}>
            <div style={GL.sectionHeader}>{fmtDay(today, { month: "long" })} pay so far</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: "#92400e", margin: "6px 0 2px" }}>{data[user] ? inr(monthPay.amount) : "—"}</div>
            <div style={{ fontSize: 12, color: "#a16207", lineHeight: 1.4 }}>{data[user] ? monthPay.working : ""}</div>
          </div>
          <div style={{ ...GL.card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={GL.sectionHeader}>What counts</div>
            <div style={{ fontSize: 13, color: "#7b241c", lineHeight: 1.5 }}>
              New products saved to S3 with <b>more than 3 shades</b>, India + USA. Edits to existing products are listed, not counted.
              🌴 Holidays are left out of averages{canEdit ? " — open a day to mark one" : ""}. Pay: average above {PAY_AVG_THRESHOLD} → active
              working days × {inr(PAY_PER_UNIT)}, otherwise products ÷ 10 × {inr(PAY_PER_UNIT)}.
            </div>
            <div style={{ fontSize: 12, color: "#b08080" }}>
              {data[user]?.updatedAt ? `Updated ${new Date(data[user].updatedAt).toLocaleString()}` : ""}
            </div>
          </div>
        </div>

        {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}
        {!data[user] && <div style={{ ...GL.card, padding: 28, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>{loading ? "Loading activity…" : ""}</div>}

        {data[user] && (
          <>
            {/* Last week */}
            <div style={{ ...GL.card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a0a09" }}>This week</div>
              <div className="week-grid">
                {last7.map((d) => {
                  const s = summaries[d]; const n = countOn(d); const hol = isHoliday(d);
                  return (
                    <div key={d} className={`day-block ${selected?.where === "week" && selected.day === d ? "sel" : ""}`} onClick={() => setSelected({ day: d, where: "week" })}
                      style={{ background: hol ? HOLIDAY_BG : n ? `linear-gradient(160deg, ${intensity(n)}, rgba(255,255,255,0.7))` : "rgba(255,255,255,0.55)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#9b4a42", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {d === today ? "Today" : fmtDay(d, { weekday: "short" })}{hol ? " 🌴" : ""}
                      </div>
                      <div style={{ fontSize: 12, color: "#b08080" }}>{fmtDay(d, { day: "numeric", month: "short" })}</div>
                      <div style={{ fontSize: 30, fontWeight: 700, color: n ? "#14532d" : "#d0c0c0", margin: "6px 0 2px" }}>{n}</div>
                      <div style={{ fontSize: 11, color: "#7b241c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {hol && !n ? "Holiday" : s?.counted.slice(0, 2).map((p) => brandName(p.market, p.brand)).join(", ") || (s?.edits.length ? `${s.edits.length} edit${s.edits.length > 1 ? "s" : ""}` : "—")}
                      </div>
                    </div>
                  );
                })}
              </div>
              {selected?.where === "week" && (
                <DayDetails day={selected.day} summary={summaries[selected.day]} onClose={() => setSelected(null)} canEdit={canEdit}
                  holiday={isHoliday(selected.day)} holidayBusy={holidayBusy} onToggleHoliday={(h) => toggleHoliday(selected.day, h)} />
              )}
            </div>

            {/* Months */}
            {months.map((m) => {
              const [y, mo] = m.split("-").map(Number);
              const nDays = daysInMonth(y, mo);
              const firstWeekday = (parseDay(`${m}-01`).getUTCDay() + 6) % 7; // Monday = 0
              const monthDays = Array.from({ length: nDays }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
              const total = monthDays.reduce((a, d) => a + countOn(d), 0);
              const activeDays = monthDays.filter((d) => countOn(d) > 0).length;
              const elapsedDays = monthDays.slice(0, m === thisMonth ? dayOfMonth : nDays);
              const mAvg = avgOver(elapsedDays);
              const mPay = payFor(elapsedDays);
              const open = openMonths.has(m);
              const sel = selected?.where === m ? selected.day : null;
              return (
                <div key={m} style={{ ...GL.card, overflow: "hidden" }}>
                  <div onClick={() => toggleMonth(m)} style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", flexWrap: "wrap" }}>
                    <span style={{ color: "#ab1f10", fontSize: 12, display: "inline-block", width: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "#1a0a09", flex: "1 1 auto" }}>{fmtDay(`${m}-01`, { month: "long", year: "numeric" })}</span>
                    <span style={{ ...GL.pill, background: "rgba(22,163,74,0.12)", color: "#15803d" }}>{total} products</span>
                    <span style={{ ...GL.pill, background: "rgba(171,31,16,0.06)", color: "#7b241c" }}>{mAvg.avg.toFixed(1)} / working day</span>
                    <span style={{ ...GL.pill, background: "rgba(217,119,6,0.14)", color: "#92400e", fontSize: 12 }}>
                      {m === thisMonth ? "so far " : ""}{inr(mPay.amount)}
                    </span>
                    <span style={{ fontSize: 12, color: "#9b4a42" }}>
                      {activeDays} active day{activeDays === 1 ? "" : "s"}{mAvg.holidaysIn ? ` · 🌴 ${mAvg.holidaysIn} holiday${mAvg.holidaysIn === 1 ? "" : "s"}` : ""}
                    </span>
                  </div>
                  {open && (
                    <div style={{ padding: "0 20px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ fontSize: 13, color: "#92400e", background: "rgba(254,243,199,0.6)", borderRadius: 10, padding: "8px 12px" }}>
                        💰 <b>{inr(mPay.amount)}</b>{m === thisMonth ? " so far" : ""} — {mPay.working}
                      </div>
                      <div className="cal">
                        {WEEKDAYS.map((w) => <div key={w} style={{ fontSize: 11, fontWeight: 700, color: "#b08080", textAlign: "center" }}>{w}</div>)}
                        {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad${i}`} />)}
                        {monthDays.map((d) => {
                          const n = countOn(d); const future = d > today; const hol = isHoliday(d);
                          const hasAny = !!summaries[d];
                          return (
                            <div key={d} className={`cal-cell ${sel === d ? "sel" : ""} ${future ? "future" : ""}`}
                              onClick={() => !future && setSelected({ day: d, where: m })}
                              title={future ? "" : `${fmtDay(d, { weekday: "long", day: "numeric", month: "long" })}: ${n} product${n === 1 ? "" : "s"}${hol ? " · holiday" : ""}`}
                              style={{ background: hol ? HOLIDAY_BG : intensity(n), color: !hol && n / maxCount > 0.55 ? "#fff" : "#7b241c" }}>
                              <span style={{ fontSize: 10, opacity: 0.75 }}>{Number(d.slice(8))}</span>
                              <span style={{ fontSize: 15, fontWeight: 700 }}>{hol ? (n ? `🌴${n}` : "🌴") : n || (hasAny ? "·" : "")}</span>
                            </div>
                          );
                        })}
                      </div>
                      {sel && <DayDetails day={sel} summary={summaries[sel]} onClose={() => setSelected(null)} canEdit={canEdit}
                        holiday={isHoliday(sel)} holidayBusy={holidayBusy} onToggleHoliday={(h) => toggleHoliday(sel, h)} />}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Rebuild */}
            {canEdit && <div style={{ ...GL.card, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 300px", fontSize: 13, color: "#9b4a42" }}>
                New saves are logged automatically. To fill in days before this page existed, rebuild <b style={{ textTransform: "capitalize" }}>{user}</b>’s
                activity from the daily audit logs (replaces what’s stored for {user}).
              </div>
              {rebuild.step !== "confirm" ? (
                <button className="th-btn-outline" style={GL.btnOutline} disabled={rebuild.step === "busy"} onClick={() => setRebuild({ step: "confirm", msg: "" })}>
                  {rebuild.step === "busy" ? "Rebuilding…" : "Rebuild from history"}
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="th-btn-outline" style={{ ...GL.btnOutline, background: "#ab1f10", color: "#fff", borderColor: "#ab1f10" }} onClick={doRebuild}>Yes, rebuild</button>
                  <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setRebuild({ step: null, msg: "" })}>Cancel</button>
                </div>
              )}
              {rebuild.msg && <div style={{ flexBasis: "100%", fontSize: 13, fontWeight: 600, color: rebuild.msg.startsWith("✓") ? "#15803d" : "#c0392b" }}>{rebuild.msg}</div>}
            </div>}
          </>
        )}
      </div>
    </div>
  );
}

function DayDetails({ day, summary, onClose, holiday, holidayBusy, onToggleHoliday, canEdit }) {
  const s = summary || { counted: [], fewShades: [], edits: [], count: 0 };
  const future = day > istDay();
  return (
    <div style={{ borderRadius: 14, background: "rgba(255,255,255,0.75)", border: "1px solid rgba(171,31,16,0.1)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a0a09" }}>{fmtDay(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <div style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>{s.count} product{s.count === 1 ? "" : "s"} counted</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!future && canEdit && (
            <button onClick={() => onToggleHoliday(!holiday)} disabled={holidayBusy}
              title={holiday ? "Count this day in averages again" : "Leave this day out of averages"}
              style={{ ...GL.btnOutline, padding: "7px 12px", opacity: holidayBusy ? 0.6 : 1,
                background: holiday ? "rgba(14,165,233,0.12)" : GL.btnOutline.background,
                borderColor: holiday ? "rgba(14,165,233,0.5)" : GL.btnOutline.border.split(" ").slice(2).join(" "),
                color: holiday ? "#0369a1" : GL.btnOutline.color }}>
              {holidayBusy ? "Saving…" : holiday ? "🌴 Holiday — unmark" : "🌴 Mark as holiday"}
            </button>
          )}
          <button onClick={onClose} className="th-btn-ghost"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "6px 10px", borderRadius: 8 }}>Close ✕</button>
        </div>
      </div>
      {holiday && (
        <div style={{ fontSize: 13, color: "#0369a1", background: "rgba(14,165,233,0.08)", borderRadius: 10, padding: "8px 11px" }}>
          🌴 Holiday — left out of the averages{s.count ? "; products saved this day still count in the totals" : ""}.
        </div>
      )}
      {!summary && <div style={{ fontSize: 13, color: "#9b4a42" }}>Nothing saved this day.</div>}
      <ProductList title="Counted — new products with more than 3 shades" items={s.counted} color="#15803d" />
      <ProductList title="New, 3 shades or fewer (not counted)" items={s.fewShades} color="#b45309" muted />
      <ProductList title="Edits to existing products (not counted)" items={s.edits} color="#8a7a7a" muted />
    </div>
  );
}

function ProductList({ title, items, color, muted }) {
  if (!items.length) return null;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>{title} · {items.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map((p) => (
          <div key={`${p.market}:::${p.brand}:::${p.product}`} style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) auto", gap: 10, alignItems: "center",
            padding: "7px 10px", borderRadius: 9, background: muted ? "rgba(0,0,0,0.02)" : "rgba(22,163,74,0.06)" }}>
            <span title={p.market === "usa" ? "USA" : "India"}>{MARKET_FLAG[p.market] || ""}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: muted ? "#7b6b6b" : "#1a0a09", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.product.replace(/-/g, " ")}
              </div>
              <div style={{ fontSize: 12, color: "#9b4a42", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {brandName(p.market, p.brand)}{p.productType ? ` · ${prettyType(p.productType)}` : ""}
                {p.saves > 1 ? ` · saved ${p.saves}×` : ""}
                {p.at ? ` · ${new Date(p.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : ""}
              </div>
            </div>
            <span style={{ ...GL.pill, background: "rgba(171,31,16,0.07)", color: "#7b241c" }}>{p.shades} shade{p.shades === 1 ? "" : "s"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
