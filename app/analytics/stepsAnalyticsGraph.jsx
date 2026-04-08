"use client";

import { createPortal } from "react-dom";

import React, { useState, useMemo } from "react";
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

const percent = (a, b) => {
  if (!b || b === 0) return "0%";
  return ((a / b) * 100).toFixed(1) + "%";
};

// ── Distinct, readable colour palette ──
const LINES = {
  fineTune:               { label: "Model Fine Tune",           color: "#1e92a9" }, // blue
  productFinder:          { label: "Product Finder",            color: "#da5439" }, // green
  shadeFinder:            { label: "Shade Finder",              color: "#fe9525" }, // red
  shadeGuide:             { label: "Shade Guide",               color: "#9464e7" }, // purple
  boughtCoins:            { label: "Bought Coins",              color: "#579b56" }, // cyan
  boughtShadeGuide:       { label: "Bought Shade Guide",        color: "#41a22e" }, // pink
  boughtPremium:          { label: "Bought Premium",            color: "#43d400" }, // dark green
  paymentPopupOpen:        { label: "Payment Popup Open",        color: "#ffd736" }, // violet
  useCoinsLastRemaining:   { label: "Use Coins (Last Remaining)", color: "#ff85c2" }, // amber-600
  usingCustomerCoins:      { label: "Using Customer Coins",      color: "#bb3463" }, // teal
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

const CustomTooltip = ({ active, payload, label, coordinate, viewBox }) => {
  if (!active || !payload?.length || typeof window === "undefined") return null;
  const map = {};
  payload.forEach((p) => (map[p.dataKey] = p.value ?? 0));

  const logins = map.logins || 0;
  const fineTune = map.fineTune || 0;
  const productFinder = map.productFinder || 0;
  const shadeFinder = map.shadeFinder || 0;
  const boughtCoins = map.boughtCoins || 0;
  const shadeGuide = map.shadeGuide || 0;
  const boughtShadeGuide = map.boughtShadeGuide || 0;
  const boughtPremium = map.boughtPremium || 0;
  const paymentPopupOpen = map.paymentPopupOpen || 0;
  const useCoinsLastRemaining = map.useCoinsLastRemaining || 0;
  const usingCustomerCoins = map.usingCustomerCoins || 0;

  const tooltipWidth = 340;
  const tooltipHeight = 520; // approximate full height
  const margin = 16;

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

      <TSection title="Fine Tune" />
      <TRow label="Model Fine Tune" value={fineTune} color={LINES.fineTune.color}
        extra={`${percent(fineTune, logins)} of logins`} />

      <TSection title="Coins Funnel" />
      <TRow label="Product Finder" value={productFinder} color={LINES.productFinder.color}
        extra={`${percent(productFinder, logins)} of logins · ${percent(productFinder, fineTune)} of FT`} />
      <TRow label="Shade Finder" value={shadeFinder} color={LINES.shadeFinder.color}
        extra={`${percent(shadeFinder, logins)} of logins · ${percent(shadeFinder, fineTune)} of FT`} />
      <TRow label="Bought Coins" value={boughtCoins} color={LINES.boughtCoins.color}
        extra={`${percent(boughtCoins, logins)} of logins`} />
      <TRow label="Payment Popup Open" value={paymentPopupOpen} color={LINES.paymentPopupOpen.color}
        extra={`${percent(paymentPopupOpen, logins)} of logins`} />
      <TRow label="Use Coins (Last Remaining)" value={useCoinsLastRemaining} color={LINES.useCoinsLastRemaining.color}
        extra={`${percent(useCoinsLastRemaining, logins)} of logins`} />
      <TRow label="Using Customer Coins" value={usingCustomerCoins} color={LINES.usingCustomerCoins.color}
        extra={`${percent(usingCustomerCoins, logins)} of logins`} />

      <TSection title="Shade Guide" />
      <TRow label="Shade Guide Quiz" value={shadeGuide} color={LINES.shadeGuide.color}
        extra={`${percent(shadeGuide, logins)} of logins · ${percent(shadeGuide, fineTune)} of FT`} />
      <TRow label="Bought Shade Guide" value={boughtShadeGuide} color={LINES.boughtShadeGuide.color}
        extra={`${percent(boughtShadeGuide, shadeGuide)} of SG · ${percent(boughtShadeGuide, logins)} of logins`} />

      <TSection title="Premium" />
      <TRow label="Bought Premium" value={boughtPremium} color={LINES.boughtPremium.color}
        extra={`${percent(boughtPremium, logins)} of logins · ${percent(boughtPremium, fineTune)} of FT`} />
    </div>,
    document.body
  );
};

export default function StepsAnalyticsGraph({ data }) {
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
      result.push(existing || {
        date: key, logins: 0, fineTune: 0, shadeFinder: 0, productFinder: 0,
        shadeGuide: 0, useCoinsShadeFinder: 0, useCoinsProductFinder: 0,
        boughtCoins: 0, boughtPremium: 0, boughtShadeGuide: 0, returningUsers: 0,
      });
    }
    return result;
  }, [sortedData, weekStart]);

  const [visibleLines, setVisibleLines] = useState(
    Object.fromEntries(Object.keys(LINES).map((k) => [k, true]))
  );

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
      <ResponsiveContainer width="100%" height={560} style={{ overflow: "visible" }}>
        <BarChart data={weeklyData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatShort} stroke="#9CA3AF" tick={{ fontSize: 12, fontWeight: 500 }} />
          <YAxis stroke="#9CA3AF" tick={{ fontSize: 12 }} width={36} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(171,31,16,0.04)" }} wrapperStyle={{ zIndex: 9999 }} isAnimationActive={false} position={{ x: 0, y: 0 }} />

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
    </div>
  );
}