"use client";

import { createPortal } from "react-dom";

import React, { useState, useMemo, useEffect } from "react";
import {
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";

function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

const formatShort = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

// ── iOS vs Android ──
// Two fixed categorical slots (validated: CVD ΔE 24.7, normal-vision ΔE 33.6, both ≥ 3:1 on the light surface).
const PLATFORMS = [
  { key: "ios", field: "loginPlatformIos", label: "iOS", icon: "🍎", color: "#2a78d6" },
  { key: "android", field: "loginPlatformAndroid", label: "Android", icon: "🤖", color: "#eb6834" },
];
const RANGES = [["14", "14 days"], ["30", "30 days"], ["all", "All"]];
const pct = (a, total) => (total ? Math.round((a / total) * 100) : 0);

const PlatformTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const total = row.ios + row.android;
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid rgba(0,0,0,0.06)", minWidth: 180 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#1a0a09", marginBottom: 8 }}>{formatDate(label)}</div>
      {PLATFORMS.map((p) => (
        <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", marginBottom: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
          <span style={{ flex: 1 }}>{p.icon} {p.label}</span>
          <b style={{ color: "#1a0a09" }}>{row[p.key]}</b>
          <span style={{ color: "#9CA3AF", width: 34, textAlign: "right" }}>{pct(row[p.key], total)}%</span>
        </div>
      ))}
      <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", marginTop: 6, paddingTop: 6, fontSize: 12, color: "#6b7280", display: "flex", justifyContent: "space-between" }}>
        <span>Total logins</span><b style={{ color: "#1a0a09" }}>{total}</b>
      </div>
    </div>
  );
};

function PlatformBreakdownChart({ sortedData }) {
  const [range, setRange] = useState("30");
  const [showTable, setShowTable] = useState(false);

  // Only days that have at least one platform login recorded
  const allDays = useMemo(
    () => sortedData
      .filter((d) => (d.loginPlatformIos || 0) > 0 || (d.loginPlatformAndroid || 0) > 0)
      .map((d) => ({ date: d.date, ios: d.loginPlatformIos || 0, android: d.loginPlatformAndroid || 0 })),
    [sortedData]
  );
  const days = useMemo(() => (range === "all" ? allDays : allDays.slice(-Number(range))), [allDays, range]);

  if (allDays.length === 0) return null;

  const totals = { ios: days.reduce((a, d) => a + d.ios, 0), android: days.reduce((a, d) => a + d.android, 0) };
  const total = totals.ios + totals.android;
  const iosShare = pct(totals.ios, total);

  return (
    <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Title + filters in one row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase" }}>iOS vs Android</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>Logins by platform · {days.length} day{days.length === 1 ? "" : "s"} with platform data</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 10, padding: 3, gap: 3 }}>
            {RANGES.map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} style={{
                border: "none", cursor: "pointer", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600,
                background: range === k ? "#fff" : "transparent", color: range === k ? "#ab1f10" : "#9b4a42",
                boxShadow: range === k ? "0 2px 8px rgba(171,31,16,0.15)" : "none",
              }}>{l}</button>
            ))}
          </div>
          <button onClick={() => setShowTable((v) => !v)} style={{
            border: "1.5px solid rgba(171,31,16,0.25)", background: "rgba(255,255,255,0.7)", color: "#ab1f10",
            borderRadius: 9, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>{showTable ? "Chart" : "Table"}</button>
        </div>
      </div>

      {/* Totals + share */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {PLATFORMS.map((p) => (
          <div key={p.key} style={{ background: "rgba(255,255,255,0.65)", borderRadius: 14, padding: "14px 16px", border: "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} /> {p.icon} {p.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#1a0a09", marginTop: 4 }}>{totals[p.key].toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>
              logins · {pct(totals[p.key], total)}% · {(totals[p.key] / Math.max(1, days.length)).toFixed(1)} / day
            </div>
          </div>
        ))}
        <div style={{ background: "rgba(255,255,255,0.65)", borderRadius: 14, padding: "14px 16px", border: "1px solid rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Share</div>
          <div role="img" aria-label={`iOS ${iosShare}%, Android ${100 - iosShare}%`}
            style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", gap: 2, background: "#fff" }}>
            {total > 0 && <div style={{ width: `${iosShare}%`, background: PLATFORMS[0].color, borderRadius: "7px 0 0 7px" }} />}
            {total > 0 && <div style={{ flex: 1, background: PLATFORMS[1].color, borderRadius: "0 7px 7px 0" }} />}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151" }}>
            <span>🍎 <b>{iosShare}%</b></span>
            <span><b>{total ? 100 - iosShare : 0}%</b> 🤖</span>
          </div>
        </div>
      </div>

      {showTable ? (
        <div style={{ maxHeight: 380, overflowY: "auto", background: "rgba(255,255,255,0.65)", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#6b7280", textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700 }}>Date</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>🍎 iOS</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>🤖 Android</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>Total</th>
                <th style={{ padding: "10px 14px", fontWeight: 700 }}>iOS share</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date} style={{ borderTop: "1px solid rgba(0,0,0,0.05)", textAlign: "right", color: "#1a0a09" }}>
                  <td style={{ textAlign: "left", padding: "8px 14px" }}>{formatShort(d.date)}</td>
                  <td style={{ padding: "8px 14px" }}>{d.ios}</td>
                  <td style={{ padding: "8px 14px" }}>{d.android}</td>
                  <td style={{ padding: "8px 14px", fontWeight: 600 }}>{d.ios + d.android}</td>
                  <td style={{ padding: "8px 14px", color: "#6b7280" }}>{pct(d.ios, d.ios + d.android)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.5)", borderRadius: 14, padding: "14px 8px 6px", border: "1px solid rgba(0,0,0,0.04)" }}>
          {/* Legend (2 series) */}
          <div style={{ display: "flex", gap: 16, padding: "0 12px 8px", fontSize: 12, color: "#374151" }}>
            {PLATFORMS.map((p) => (
              <span key={p.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color }} /> {p.icon} {p.label}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={days} margin={{ top: 8, right: 16, left: 0, bottom: 4 }} barCategoryGap="22%" barGap={2}>
              <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatShort} stroke="#D1D5DB" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} minTickGap={16} />
              <YAxis stroke="#D1D5DB" tick={{ fontSize: 11, fill: "#6b7280" }} width={36} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<PlatformTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              {PLATFORMS.map((p) => (
                <Bar key={p.key} dataKey={p.key} name={p.label} fill={p.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const percent = (a, b) => {
  if (!b || b === 0) return "0%";
  return ((a / b) * 100).toFixed(1) + "%";
};

// ── Distinct, readable colour palette ──
const NUMERIC_LINES = {
  fineTune:               { label: "Model Fine Tune",           color: "#1e92a9" },
  productFinder:          { label: "Product Finder",            color: "#da5439" },
  shadeFinder:            { label: "Shade Finder",              color: "#fe9525" },
  shadeGuide:             { label: "Shade Guide",               color: "#9464e7" },
  boughtCoins:            { label: "Bought Coins",              color: "#579b56" },
  boughtShadeGuide:       { label: "Bought Shade Guide",        color: "#41a22e" },
  boughtPremium:          { label: "Bought Premium",            color: "#43d400" },
  paymentPopupClose:      { label: "Payment Popup Close",       color: "#ffd736" },
  theEditOpen:            { label: "The Edit Open",             color: "#e8488a" },
  tryOnceForFreeProduct:  { label: "Try Once Free (Product)",   color: "#06b6d4" },
  tryOnceForFreeShade:    { label: "Try Once Free (Shade)",     color: "#f97316" },
  theEditArticleOpen:     { label: "The Edit Article Open",     color: "#a855f7" },
  passSelected1day:       { label: "Pass Selected 1 Day",       color: "#fb923c" },
  passSelected1month:     { label: "Pass Selected 1 Month",     color: "#f59e0b" },
  passSelected1year:      { label: "Pass Selected 1 Year",      color: "#eab308" },
  ctaClicked1day:         { label: "CTA Clicked 1 Day",         color: "#ef4444" },
  ctaClicked1month:       { label: "CTA Clicked 1 Month",       color: "#dc2626" },
  ctaClicked1year:        { label: "CTA Clicked 1 Year",        color: "#b91c1c" },
  ritualPageLoaded:        { label: "Ritual Page Loaded",      color: "#0d9488" },
  ritualBeginTapped:       { label: "Ritual Begin Tapped",     color: "#0891b2" },
  ritualQuiz1Done:         { label: "Ritual Quiz 1 Done",      color: "#7c3aed" },
  ritualPreviewNext:       { label: "Ritual Preview Next",     color: "#6d28d9" },
  ritualTimelineNext:      { label: "Ritual Timeline Next",    color: "#5b21b6" },
  ritualQuiz2Done:         { label: "Ritual Quiz 2 Done",      color: "#4c1d95" },
  ritualCheckinDone:       { label: "Ritual Checkin Done",     color: "#059669" },
  ritualPaywallCtaTapped:  { label: "Ritual Paywall CTA",      color: "#dc2626" },
};

const ALPHA_LINES = {
  funnelGuestLogin:       { label: "Guest Login",           color: "#1e92a9" },
  funnelQuiz:             { label: "Funnel Quiz",           color: "#da5439" },
  submitPhoto:            { label: "Submit Photo",          color: "#fe9525" },
  funnelTwinStart:        { label: "Twin Start",            color: "#9464e7" },
  modelSelect:            { label: "Model Select",          color: "#579b56" },
  shadeGuidePaywallOpen:  { label: "Paywall Open",          color: "#ffd736" },
  shadeGuidePaywallCta:   { label: "Paywall CTA",           color: "#e8488a" },
  paymentSuccess249:      { label: "Payment Success ₹249", color: "#43d400" },
  paymentSuccess199:      { label: "Payment Success ₹199", color: "#06b6d4" },
};

// Tooltip Section header
const TSection = ({ title }) => (
  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#9CA3AF", textTransform: "uppercase", margin: "16px 0 8px", paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
    {title}
  </div>
);

const TRow = ({ label, value, extra, color }) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {color && <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />}
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{label}</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 800, color: "#111827", flexShrink: 0 }}>{value}</span>
    </div>
    {extra && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2, paddingLeft: color ? 17 : 0 }}>{extra}</div>}
  </div>
);

const CustomTooltip = ({ active, payload, label, coordinate, viewBox, allData, visibleLines = {} }) => {
  if (!active || !payload?.length || typeof window === "undefined") return null;
  const dayEntry = (allData || []).find(d => d.date === label) || {};
  const map = {};
  Object.keys(dayEntry).forEach(k => {
    if (k === "date" || k === "logins" || k === "returningUsers") { map[k] = dayEntry[k]; return; }
    map[k] = visibleLines[k] !== false ? (dayEntry[k] ?? 0) : 0;
  });
  payload.forEach((p) => (map[p.dataKey] = p.value ?? 0));

  const logins = map.logins || 0;
  const fineTune = map.fineTune || 0;
  const productFinder = map.productFinder || 0;
  const shadeFinder = map.shadeFinder || 0;
  const boughtCoins = map.boughtCoins || 0;
  const shadeGuide = map.shadeGuide || 0;
  const boughtShadeGuide = map.boughtShadeGuide || 0;
  const boughtPremium = map.boughtPremium || 0;
  const paymentPopupClose = map.paymentPopupClose || 0;
  const theEditOpen = map.theEditOpen || 0;
  const tryOnceForFreeProduct = map.tryOnceForFreeProduct || 0;
  const tryOnceForFreeShade = map.tryOnceForFreeShade || 0;
  const theEditArticleOpen = map.theEditArticleOpen || 0;
  const passSelected1day = map.passSelected1day || 0;
  const passSelected1month = map.passSelected1month || 0;
  const passSelected1year = map.passSelected1year || 0;
  const ctaClicked1day = map.ctaClicked1day || 0;
  const ctaClicked1month = map.ctaClicked1month || 0;
  const ctaClicked1year = map.ctaClicked1year || 0;
  const ritualPageLoaded = map.ritualPageLoaded || 0;
  const ritualBeginTapped = map.ritualBeginTapped || 0;
  const ritualQuiz1Done = map.ritualQuiz1Done || 0;
  const ritualPreviewNext = map.ritualPreviewNext || 0;
  const ritualTimelineNext = map.ritualTimelineNext || 0;
  const ritualQuiz2Done = map.ritualQuiz2Done || 0;
  const ritualCheckinDone = map.ritualCheckinDone || 0;
  const ritualPaywallCtaTapped = map.ritualPaywallCtaTapped || 0;

  const margin = 16;
  // never wider than the screen (phones)
  const tooltipWidth = Math.min(340, window.innerWidth - margin * 2);
  const tooltipHeight = 520; // approximate full height

  // coordinate is relative to the chart container — we need viewport position
  // viewBox gives us the chart's position within ResponsiveContainer
  // Use viewBox to get the bar's absolute position on screen
  // viewBox.left/top is the chart offset within the page
  const barX = (viewBox?.left ?? 0) + (coordinate?.x ?? 0);
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  let left = barX + 20;
  if (left + tooltipWidth > screenW - margin) {
    left = barX - tooltipWidth - 20;
  }
  left = Math.max(margin, Math.min(left, screenW - tooltipWidth - margin)); // keep it on screen

  // Flip up if tooltip would overflow bottom edge
  const rawTop = (coordinate?.y ?? 100) - 40;
  let top = rawTop;
  if (top + tooltipHeight > screenH - margin) {
    top = screenH - tooltipHeight - margin;
  }
  if (top < margin) top = margin;

  return createPortal(
    <div style={{
      position: "fixed",
      left,
      top,
      background: "#ffffff",
      borderRadius: 18,
      padding: "20px 24px",
      boxShadow: "0 24px 48px rgba(0,0,0,0.16)",
      border: "1px solid rgba(0,0,0,0.06)",
      fontSize: 13,
      width: tooltipWidth,
      maxHeight: `calc(100vh - ${margin * 2}px)`,
      overflowY: "auto",
      zIndex: 99999,
      pointerEvents: "none",
    }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: "#111827" }}>{formatDate(label)}</div>

      <TSection title="Logins" />
      <TRow label="Total Logins" value={logins} color="#111827" />
      <TRow label="Returning Users" value={map.returningUsers || 0} color="#9CA3AF"
        extra={`${percent(map.returningUsers, logins)} of logins`} />

      {fineTune > 0 && <><TSection title="Fine Tune" />
      <TRow label="Model Fine Tune" value={fineTune} color={NUMERIC_LINES.fineTune.color} extra={`${percent(fineTune, logins)} of logins`} /></>}

      {(productFinder > 0 || shadeFinder > 0 || boughtCoins > 0 || paymentPopupClose > 0) && <TSection title="Coins Funnel" />}
      {productFinder > 0 && <TRow label="Product Finder" value={productFinder} color={NUMERIC_LINES.productFinder.color} extra={`${percent(productFinder, logins)} of logins · ${percent(productFinder, fineTune)} of FT`} />}
      {shadeFinder > 0 && <TRow label="Shade Finder" value={shadeFinder} color={NUMERIC_LINES.shadeFinder.color} extra={`${percent(shadeFinder, logins)} of logins · ${percent(shadeFinder, fineTune)} of FT`} />}
      {boughtCoins > 0 && <TRow label="Bought Coins" value={boughtCoins} color={NUMERIC_LINES.boughtCoins.color} extra={`${percent(boughtCoins, logins)} of logins`} />}
      {paymentPopupClose > 0 && <TRow label="Payment Popup Close" value={paymentPopupClose} color={NUMERIC_LINES.paymentPopupClose.color} extra={`${percent(paymentPopupClose, logins)} of logins`} />}

      {(shadeGuide > 0 || boughtShadeGuide > 0) && <TSection title="Shade Guide" />}
      {shadeGuide > 0 && <TRow label="Shade Guide Quiz" value={shadeGuide} color={NUMERIC_LINES.shadeGuide.color} extra={`${percent(shadeGuide, logins)} of logins · ${percent(shadeGuide, fineTune)} of FT`} />}
      {boughtShadeGuide > 0 && <TRow label="Bought Shade Guide" value={boughtShadeGuide} color={NUMERIC_LINES.boughtShadeGuide.color} extra={`${percent(boughtShadeGuide, shadeGuide)} of SG · ${percent(boughtShadeGuide, logins)} of logins`} />}

      {(theEditOpen > 0 || theEditArticleOpen > 0) && <TSection title="The Edit" />}
      {theEditOpen > 0 && <TRow label="The Edit Open" value={theEditOpen} color={NUMERIC_LINES.theEditOpen.color} extra={`${percent(theEditOpen, logins)} of logins`} />}
      {theEditArticleOpen > 0 && <TRow label="Article Open" value={theEditArticleOpen} color={NUMERIC_LINES.theEditArticleOpen.color} extra={`${percent(theEditArticleOpen, theEditOpen)} of Edit opens`} />}

      {(tryOnceForFreeProduct > 0 || tryOnceForFreeShade > 0) && <TSection title="Try Once Free" />}
      {tryOnceForFreeProduct > 0 && <TRow label="Try Once Free (Product)" value={tryOnceForFreeProduct} color={NUMERIC_LINES.tryOnceForFreeProduct.color} extra={`${percent(tryOnceForFreeProduct, logins)} of logins`} />}
      {tryOnceForFreeShade > 0 && <TRow label="Try Once Free (Shade)" value={tryOnceForFreeShade} color={NUMERIC_LINES.tryOnceForFreeShade.color} extra={`${percent(tryOnceForFreeShade, logins)} of logins`} />}

      {boughtPremium > 0 && <><TSection title="Premium" />
      <TRow label="Bought Premium" value={boughtPremium} color={NUMERIC_LINES.boughtPremium.color} extra={`${percent(boughtPremium, logins)} of logins · ${percent(boughtPremium, fineTune)} of FT`} /></>}

      {(passSelected1day > 0 || passSelected1month > 0 || passSelected1year > 0) && <TSection title="Pass Selection" />}
      {passSelected1day > 0 && <TRow label="Pass Selected 1 Day" value={passSelected1day} color={NUMERIC_LINES.passSelected1day.color} extra={`${percent(passSelected1day, logins)} of logins`} />}
      {passSelected1month > 0 && <TRow label="Pass Selected 1 Month" value={passSelected1month} color={NUMERIC_LINES.passSelected1month.color} extra={`${percent(passSelected1month, logins)} of logins`} />}
      {passSelected1year > 0 && <TRow label="Pass Selected 1 Year" value={passSelected1year} color={NUMERIC_LINES.passSelected1year.color} extra={`${percent(passSelected1year, logins)} of logins`} />}

      {(ctaClicked1day > 0 || ctaClicked1month > 0 || ctaClicked1year > 0) && <TSection title="CTA Clicks" />}
      {ctaClicked1day > 0 && <TRow label="CTA Clicked 1 Day" value={ctaClicked1day} color={NUMERIC_LINES.ctaClicked1day.color} extra={`${percent(ctaClicked1day, passSelected1day)} of 1d selections`} />}
      {ctaClicked1month > 0 && <TRow label="CTA Clicked 1 Month" value={ctaClicked1month} color={NUMERIC_LINES.ctaClicked1month.color} extra={`${percent(ctaClicked1month, passSelected1month)} of 1m selections`} />}
      {ctaClicked1year > 0 && <TRow label="CTA Clicked 1 Year" value={ctaClicked1year} color={NUMERIC_LINES.ctaClicked1year.color} extra={`${percent(ctaClicked1year, passSelected1year)} of 1y selections`} />}
      {(ritualPageLoaded > 0 || ritualBeginTapped > 0 || ritualQuiz1Done > 0 || ritualQuiz2Done > 0 || ritualCheckinDone > 0 || ritualPaywallCtaTapped > 0) && <TSection title="Ritual Funnel" />}
      {ritualPageLoaded > 0 && <TRow label="Page Loaded" value={ritualPageLoaded} color={NUMERIC_LINES.ritualPageLoaded.color} />}
      {ritualBeginTapped > 0 && <TRow label="Begin Tapped" value={ritualBeginTapped} color={NUMERIC_LINES.ritualBeginTapped.color} extra={`${percent(ritualBeginTapped, ritualPageLoaded)} of loaded`} />}
      {ritualQuiz1Done > 0 && <TRow label="Quiz 1 Done" value={ritualQuiz1Done} color={NUMERIC_LINES.ritualQuiz1Done.color} extra={`${percent(ritualQuiz1Done, ritualBeginTapped)} of begun`} />}
      {ritualPreviewNext > 0 && <TRow label="Preview Next" value={ritualPreviewNext} color={NUMERIC_LINES.ritualPreviewNext.color} extra={`${percent(ritualPreviewNext, ritualQuiz1Done)} of Q1`} />}
      {ritualTimelineNext > 0 && <TRow label="Timeline Next" value={ritualTimelineNext} color={NUMERIC_LINES.ritualTimelineNext.color} extra={`${percent(ritualTimelineNext, ritualPreviewNext)} of preview`} />}
      {ritualQuiz2Done > 0 && <TRow label="Quiz 2 Done" value={ritualQuiz2Done} color={NUMERIC_LINES.ritualQuiz2Done.color} extra={`${percent(ritualQuiz2Done, ritualTimelineNext)} of timeline`} />}
      {ritualCheckinDone > 0 && <TRow label="Checkin Done" value={ritualCheckinDone} color={NUMERIC_LINES.ritualCheckinDone.color} extra={`${percent(ritualCheckinDone, ritualQuiz2Done)} of Q2`} />}
      {ritualPaywallCtaTapped > 0 && <TRow label="Paywall CTA Tapped" value={ritualPaywallCtaTapped} color={NUMERIC_LINES.ritualPaywallCtaTapped.color} extra={`${percent(ritualPaywallCtaTapped, ritualPageLoaded)} of loaded`} />}

      
    </div>,
    document.body
  );
};

const AlphaCustomTooltip = ({ active, payload, label, coordinate, viewBox, allData, visibleLines = {} }) => {
  if (!active || !payload?.length || typeof window === "undefined") return null;
  const dayEntry = (allData || []).find(d => d.date === label) || {};
  const map = {};
  Object.keys(dayEntry).forEach(k => {
    if (k === "date" || k === "logins" || k === "returningUsers") { map[k] = dayEntry[k]; return; }
    map[k] = visibleLines[k] !== false ? (dayEntry[k] ?? 0) : 0;
  });
  payload.forEach((p) => (map[p.dataKey] = p.value ?? 0));

  const logins = map.logins || 0;
  const funnelGuestLogin = map.funnelGuestLogin || 0;
  const funnelQuiz = map.funnelQuiz || 0;
  const submitPhoto = map.submitPhoto || 0;
  const funnelTwinStart = map.funnelTwinStart || 0;
  const modelSelect = map.modelSelect || 0;
  const shadeGuidePaywallOpen = map.shadeGuidePaywallOpen || 0;
  const shadeGuidePaywallCta = map.shadeGuidePaywallCta || 0;
  const paymentSuccess249 = map.paymentSuccess249 || 0;
  const paymentSuccess199 = map.paymentSuccess199 || 0;

  const margin = 16;
  const tooltipWidth = Math.min(340, window.innerWidth - margin * 2);
  const tooltipHeight = 420;

  const barX = (viewBox?.left ?? 0) + (coordinate?.x ?? 0);
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  let left = barX + 20;
  if (left + tooltipWidth > screenW - margin) left = barX - tooltipWidth - 20;
  left = Math.max(margin, Math.min(left, screenW - tooltipWidth - margin)); // keep it on screen

  const rawTop = (coordinate?.y ?? 100) - 40;
  let top = rawTop;
  if (top + tooltipHeight > screenH - margin) top = screenH - tooltipHeight - margin;
  if (top < margin) top = margin;

  return createPortal(
    <div style={{
      position: "fixed", left, top, background: "#ffffff", borderRadius: 18,
      padding: "20px 24px", boxShadow: "0 24px 48px rgba(0,0,0,0.16)",
      border: "1px solid rgba(0,0,0,0.06)", fontSize: 13, width: tooltipWidth,
      maxHeight: `calc(100vh - ${margin * 2}px)`, overflowY: "auto", zIndex: 99999, pointerEvents: "none",
    }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4, color: "#111827" }}>{formatDate(label)}</div>

      <TSection title="Logins" />
      <TRow label="Total Logins" value={logins} color="#111827" />
      <TRow label="Returning Users" value={map.returningUsers || 0} color="#9CA3AF"
        extra={`${percent(map.returningUsers, logins)} of logins`} />

      {(funnelGuestLogin > 0 || funnelQuiz > 0 || submitPhoto > 0 || funnelTwinStart > 0 || modelSelect > 0) && <TSection title="Onboarding Funnel" />}
      {funnelGuestLogin > 0 && <TRow label="Guest Login" value={funnelGuestLogin} color={ALPHA_LINES.funnelGuestLogin.color} extra={`${percent(funnelGuestLogin, logins)} of logins`} />}
      {funnelQuiz > 0 && <TRow label="Funnel Quiz" value={funnelQuiz} color={ALPHA_LINES.funnelQuiz.color} extra={`${percent(funnelQuiz, funnelGuestLogin)} of guest logins`} />}
      {submitPhoto > 0 && <TRow label="Submit Photo" value={submitPhoto} color={ALPHA_LINES.submitPhoto.color} extra={`${percent(submitPhoto, logins)} of logins`} />}
      {funnelTwinStart > 0 && <TRow label="Twin Start" value={funnelTwinStart} color={ALPHA_LINES.funnelTwinStart.color} extra={`${percent(funnelTwinStart, submitPhoto)} of photos`} />}
      {modelSelect > 0 && <TRow label="Model Select" value={modelSelect} color={ALPHA_LINES.modelSelect.color} extra={`${percent(modelSelect, funnelTwinStart)} of twin starts`} />}

      {(shadeGuidePaywallOpen > 0 || shadeGuidePaywallCta > 0) && <TSection title="Paywall" />}
      {shadeGuidePaywallOpen > 0 && <TRow label="Paywall Open" value={shadeGuidePaywallOpen} color={ALPHA_LINES.shadeGuidePaywallOpen.color} extra={`${percent(shadeGuidePaywallOpen, logins)} of logins`} />}
      {shadeGuidePaywallCta > 0 && <TRow label="Paywall CTA" value={shadeGuidePaywallCta} color={ALPHA_LINES.shadeGuidePaywallCta.color} extra={`${percent(shadeGuidePaywallCta, shadeGuidePaywallOpen)} of opens`} />}

      {(paymentSuccess249 > 0 || paymentSuccess199 > 0) && <TSection title="Purchases" />}
      {paymentSuccess249 > 0 && <TRow label="Payment Success (₹249)" value={paymentSuccess249} color={ALPHA_LINES.paymentSuccess249.color} extra={`${percent(paymentSuccess249, logins)} of logins`} />}
      {paymentSuccess199 > 0 && <TRow label="Payment Success (₹199)" value={paymentSuccess199} color={ALPHA_LINES.paymentSuccess199.color} extra={`${percent(paymentSuccess199, logins)} of logins`} />}
    </div>,
    document.body
  );
};

export default function StepsAnalyticsGraph({ data, userType = "numeric" }) {
  const LINES = userType === "alpha" ? ALPHA_LINES : NUMERIC_LINES;
  const sortedData = useMemo(() => {
    return Object.entries(data)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([date, metrics]) => ({ date, ...metrics }));
  }, [data]);

  const latestDate = sortedData.length ? new Date(sortedData[sortedData.length - 1].date) : new Date();
  const { monday: defaultWeekStart } = getWeekRange(latestDate);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  const weeklyData = useMemo(() => {
    const result = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const existing = sortedData.find((e) => e.date === key);
      const emptyNumericDay = {
        date: key, logins: 0, returningUsers: 0, fineTune: 0, shadeFinder: 0,
        productFinder: 0, shadeGuide: 0, boughtCoins: 0, boughtPremium: 0,
        paymentPopupClose: 0, theEditOpen: 0, tryOnceForFreeProduct: 0, tryOnceForFreeShade: 0, theEditArticleOpen: 0,
        passSelected1day: 0, passSelected1month: 0, passSelected1year: 0,
        ctaClicked1day: 0, ctaClicked1month: 0, ctaClicked1year: 0,
        loginPlatformIos: 0, loginPlatformAndroid: 0,
        ritualPageLoaded: 0, ritualBeginTapped: 0,
        ritualQuiz1Done: 0, ritualPreviewNext: 0,
        ritualTimelineNext: 0, ritualQuiz2Done: 0,
        ritualCheckinDone: 0, ritualPaywallCtaTapped: 0,
      };
      const emptyAlphaDay = {
        date: key, logins: 0, returningUsers: 0,
        funnelGuestLogin: 0, funnelQuiz: 0, submitPhoto: 0, funnelTwinStart: 0, modelSelect: 0,
        shadeGuidePaywallOpen: 0, shadeGuidePaywallCta: 0,
        paymentSuccess249: 0, paymentSuccess199: 0,
      };
      result.push(existing || (userType === "alpha" ? emptyAlphaDay : emptyNumericDay));
    }
    return result;
  }, [sortedData, weekStart]);

  const [visibleLines, setVisibleLines] = useState(
    Object.fromEntries(Object.keys(LINES).map((k) => [k, true]))
  );

  useEffect(() => {
    setVisibleLines(Object.fromEntries(Object.keys(LINES).map((k) => [k, true])));
  }, [userType]);

  const toggleLine = (key) => setVisibleLines((prev) => ({ ...prev, [key]: !prev[key] }));

  const goPrevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); };
  const goNextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); };

  // Group toggles by category
  const GROUPS = [
    { label: "Core", keys: ["fineTune"] },
    { label: "Product & Shade", keys: ["productFinder", "shadeFinder"] },
    { label: "Coin Events", keys: ["useCoinsProductFinder", "useCoinsShadeFinder", "boughtCoins"] },
    { label: "Shade Guide", keys: ["shadeGuide", "boughtShadeGuide"] },
    { label: "Premium", keys: ["boughtPremium"] },
  ];

  return (
    <div style={{ width: "100%", fontFamily: "'Inter', sans-serif", overflow: "visible" }}>

      {/* Week navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 24 }}>
        <button onClick={goPrevWeek} style={{ background: "rgba(171,31,16,0.08)", border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 14, fontWeight: 600, color: "#ab1f10", cursor: "pointer" }}>
          ← Prev
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#1a0a09" }}>
          {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button onClick={goNextWeek} style={{ background: "rgba(171,31,16,0.08)", border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 14, fontWeight: 600, color: "#ab1f10", cursor: "pointer" }}>
          Next →
        </button>
      </div>

      {/* Toggle groups */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24, padding: "16px 20px", background: "rgba(255,255,255,0.5)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.08)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#7b241c", letterSpacing: "0.07em", textTransform: "uppercase", width: "100%", marginBottom: 6 }}>Show metrics</div>
        {/* Logins always on */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(17,24,39,0.07)", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, color: "#111827" }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#111827" }} />
          Logins (always on)
        </div>
        {Object.entries(LINES).map(([key, info]) => {
          const on = visibleLines[key];
          return (
            <button key={key} onClick={() => toggleLine(key)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: on ? `${info.color}15` : "rgba(0,0,0,0.04)", border: `1.5px solid ${on ? info.color : "transparent"}`, borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, color: on ? info.color : "#9CA3AF", cursor: "pointer", transition: "all 0.15s" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: on ? info.color : "#D1D5DB" }} />
              {info.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="m-chart-tall" style={{ height: 560 }}>
      <ResponsiveContainer width="100%" height="100%" style={{ overflow: "visible" }}>
        <BarChart data={weeklyData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatShort} stroke="#9CA3AF" tick={{ fontSize: 12, fontWeight: 500 }} />
          <YAxis stroke="#9CA3AF" tick={{ fontSize: 12 }} width={36} />
          <Tooltip content={(props) => (userType === "alpha"
            ? <AlphaCustomTooltip {...props} allData={weeklyData} visibleLines={visibleLines} />
            : <CustomTooltip {...props} allData={weeklyData} visibleLines={visibleLines} />
          )} cursor={{ fill: "rgba(171,31,16,0.04)" }} wrapperStyle={{ zIndex: 9999 }} isAnimationActive={false} position={{ x: 0, y: 0 }} />

          {/* Logins bar — always shown */}
          <Bar dataKey="logins" fill="#1F2937" opacity={0.85} name="Logins" radius={[6, 6, 0, 0]} maxBarSize={56} />
          <Bar dataKey="returningUsers" fill="#9CA3AF" name="Returning Users" radius={[6, 6, 0, 0]} maxBarSize={56} />

          {/* Lines for all other metrics */}
          {Object.entries(LINES).map(([key, info]) =>
            visibleLines[key] ? (
              <Line key={key} type="monotone" strokeWidth={2.5} dot={{ r: 5, strokeWidth: 2, fill: "#fff", stroke: info.color }}
                activeDot={{ r: 7 }} dataKey={key} stroke={info.color} name={info.label} />
            ) : null
          )}
        </BarChart>
      </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 18, padding: "14px 18px", background: "rgba(255,255,255,0.4)", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#374151" }}>
          <div style={{ width: 28, height: 10, borderRadius: 3, background: "#1F2937" }} /> Logins (bar)
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#374151" }}>
          <div style={{ width: 28, height: 10, borderRadius: 3, background: "#9CA3AF" }} /> Returning Users (bar)
        </div>
        {Object.entries(LINES).map(([key, info]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: visibleLines[key] ? "#374151" : "#D1D5DB" }}>
            <div style={{ width: 28, height: 2.5, background: info.color, opacity: visibleLines[key] ? 1 : 0.3 }} />
            {info.label}
          </div>
        ))}
      </div>

      {userType !== "alpha" && <PlatformBreakdownChart sortedData={sortedData} />}
    </div>
  );
}