"use client";

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
} from "recharts";

/* -----------------------------------------------------------------------
   Helper: Get start & end of a week (Mon–Sun)
------------------------------------------------------------------------ */
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

/* -----------------------------------------------------------------------
   Funnel Order
------------------------------------------------------------------------ */
const funnelOrder = [
  "logins",
  "fineTune",
  "productFinder",
  "useCoinsProductFinder",
  "shadeFinder",
  "useCoinsShadeFinder",
  "shadeGuide",
  "boughtCoins",
  "boughtShadeGuide",
  "boughtPremium",
];

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const percent = (a, b) => {
  if (!b || b === 0) return "0%";
  return ((a / b) * 100).toFixed(1) + "%";
};

const Section = ({ title, children }) => (
  <div
    style={{
      marginBottom: 24,
      paddingBottom: 18,
      borderBottom: "1px solid rgba(0,0,0,0.06)",
    }}
  >
    <div
      style={{
        fontSize: 12,
        letterSpacing: 2,
        fontWeight: 800,
        color: "#111827",
        marginBottom: 12,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const Row = ({ label, value, extra }) => (
  <div style={{ marginBottom: 14, display: "flex", flexDirection: "column" }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>
        {value}
      </span>
    </div>

    {extra && (
      <div style={{ marginTop: 4, fontSize: 12, color: "#4B5563" }}>
        {extra}
      </div>
    )}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  const map = {};
  payload.forEach((p) => (map[p.dataKey] = p.value ?? 0));

  const logins = map.logins || 0;
  const fineTune = map.fineTune || 0;
  const productFinder = map.productFinder || 0;
  const useCoinsPF = map.useCoinsProductFinder || 0;
  const shadeFinder = map.shadeFinder || 0;
  const useCoinsSF = map.useCoinsShadeFinder || 0;
  const boughtCoins = map.boughtCoins || 0;
  const shadeGuide = map.shadeGuide || 0;
  const boughtShadeGuide = map.boughtShadeGuide || 0;
  const boughtPremium = map.boughtPremium || 0;

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 22,
        padding: 26,
        boxShadow: "0 30px 60px rgba(0,0,0,0.18)",
        border: "1px solid rgba(0,0,0,0.06)",
        fontSize: 14,
        minWidth: 360,
      }}
    >
      <div
        style={{
          fontWeight: 900,
          fontSize: 16,
          marginBottom: 28,
          color: "#111827",
        }}
      >
        {formatDate(label)}
      </div>

      <Section title="LOGINS">
        <Row label="Logins" value={logins} />
      </Section>

      <Row
        label="Returning Users"
        value={map.returningUsers || 0}
        extra={`${percent(map.returningUsers, map.logins)} of Logins`}
        />


      <Section title="FINE TUNE">
        <Row
          label="Model Fine Tune"
          value={fineTune}
          extra={`${percent(fineTune, logins)} of Logins`}
        />
      </Section>

      <Section title="COINS FUNNEL">
        <Row
          label="Product Finder"
          value={productFinder}
          extra={`${percent(productFinder, logins)} of Logins | ${percent(
            productFinder,
            fineTune
          )} of Fine-Tune`}
        />

        <Row
          label="Use Coins (Product)"
          value={useCoinsPF}
          extra={`${percent(useCoinsPF, productFinder)} of PF | ${percent(
            useCoinsPF,
            fineTune
          )} of FT | ${percent(useCoinsPF, logins)} of Login`}
        />

        <div style={{ height: 8 }} />

        <Row
          label="Shade Finder"
          value={shadeFinder}
          extra={`${percent(shadeFinder, logins)} of Login | ${percent(
            shadeFinder,
            fineTune
          )} of FT`}
        />

        <Row
          label="Use Coins (Shade)"
          value={useCoinsSF}
          extra={`${percent(useCoinsSF, shadeFinder)} of SF | ${percent(
            useCoinsSF,
            fineTune
          )} of FT | ${percent(useCoinsSF, logins)} of Login`}
        />

        <Row
          label="Bought Coins"
          value={boughtCoins}
          extra={`${percent(boughtCoins, logins)} of Login | ${percent(
            boughtCoins,
            fineTune
          )} of FT | ${percent(boughtCoins, useCoinsPF)} of UCPF | ${percent(
            boughtCoins,
            useCoinsSF
          )} of UCSF`}
        />
      </Section>

      <Section title="SHADE GUIDE">
        <Row
          label="Shade Guide Quiz"
          value={shadeGuide}
          extra={`${percent(shadeGuide, logins)} of Login | ${percent(
            shadeGuide,
            fineTune
          )} of FT`}
        />

        <Row
          label="Bought Shade Guide"
          value={boughtShadeGuide}
          extra={`${percent(boughtShadeGuide, shadeGuide)} of SG | ${percent(
            boughtShadeGuide,
            fineTune
          )} of FT | ${percent(
            boughtShadeGuide,
            logins
          )} of Login`}
        />
      </Section>

      <Section title="BOUGHT PREMIUM">
        <Row
          label="Premium"
          value={boughtPremium}
          extra={`${percent(boughtPremium, fineTune)} of FT | ${percent(
            boughtPremium,
            logins
          )} of Login`}
        />
      </Section>
    </div>
  );
};

export default function StepsAnalyticsGraph({ data }) {
  /* FIX 1 — removed Feb 1 filter */
  const sortedData = useMemo(() => {
    return Object.entries(data)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([date, metrics]) => ({ date, ...metrics }));
  }, [data]);

  const latestDate = sortedData.length
    ? new Date(sortedData[sortedData.length - 1].date)
    : new Date();

  const { monday: defaultWeekStart } = getWeekRange(latestDate);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  /* FIX 2 — use local YYYY-MM-DD (NO UTC SHIFT) */
  const weeklyData = useMemo(() => {
    const result = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);

      const key =
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;

      const existing = sortedData.find((e) => e.date === key);

      result.push(
        existing || {
          date: key,
          logins: 0,
          fineTune: 0,
          shadeFinder: 0,
          productFinder: 0,
          shadeGuide: 0,
          useCoinsShadeFinder: 0,
          useCoinsProductFinder: 0,
          boughtCoins: 0,
          boughtPremium: 0,
          boughtShadeGuide: 0,
        }
      );
    }

    return result;
  }, [sortedData, weekStart]);

  const LINES = {
    fineTune: { label: "Model Fine Tune", color: "#1E3A8A" },
    productFinder: { label: "Product Finder", color: "#047857" },
    useCoinsProductFinder: { label: "Use Coins (Product Finder)", color: "#D97706" },
    shadeFinder: { label: "Shade Finder", color: "#DC2626" },
    useCoinsShadeFinder: { label: "Use Coins (Shade Finder)", color: "#F59E0B" },
    shadeGuide: { label: "Shade Guide", color: "#7C3AED" },
    boughtCoins: { label: "Bought Coins", color: "#059669" },
    boughtShadeGuide: { label: "Bought Shade Guide", color: "#9333EA" },
    boughtPremium: { label: "Bought Premium", color: "#0EA5E9" },
  };

  const [visibleLines, setVisibleLines] = useState(
    Object.fromEntries(Object.keys(LINES).map((k) => [k, true]))
  );

  const goPrevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const goNextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  return (
    <div
      style={{
        width: "100%",
        marginTop: 30,
        padding: 30,
        borderRadius: 24,
        background: "rgba(255,255,255,0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.3)",
        boxShadow: "0 20px 40px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 24,
          marginBottom: 30,
          fontWeight: 600,
          color: "#111827",
        }}
      >
        <button onClick={goPrevWeek}>◀ Previous</button>
        <strong>
          {weekStart.toDateString()} → {weekEnd.toDateString()}
        </strong>
        <button onClick={goNextWeek}>Next ▶</button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 30,
        }}
      >
        <span style={{ fontWeight: 600, width: "100%" }}>
          Show metrics:
        </span>

        <label>
          <input type="checkbox" checked disabled /> Logins
        </label>

        {Object.entries(LINES).map(([key, info]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={visibleLines[key]}
              onChange={() =>
                setVisibleLines((prev) => ({
                  ...prev,
                  [key]: !prev[key],
                }))
              }
              style={{ accentColor: info.color }}
            />{" "}
            <span style={{ color: info.color }}>{info.label}</span>
          </label>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={650}>
        <BarChart data={weeklyData}>
          <CartesianGrid stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="date" stroke="#6B7280" />
          <YAxis stroke="#6B7280" />
          <Tooltip content={<CustomTooltip />} />

          <Bar
            dataKey="logins"
            fill="#111827"
            opacity={0.9}
            name="Logins"
            radius={[8, 8, 0, 0]}
          />

          <Bar
            dataKey="returningUsers"
            fill="#9CA3AF"     // light grey layer
            stackId="logins"   // STACKS on the same bar
            name="Returning Users"
            radius={[8, 8, 0, 0]}
            />


          {Object.entries(LINES).map(([key, info]) =>
            visibleLines[key] ? (
              <Line
                key={key}
                type="monotone"
                strokeWidth={2.5}
                dot={{ r: 4 }}
                dataKey={key}
                stroke={info.color}
                name={info.label}
              />
            ) : null
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
