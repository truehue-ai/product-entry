"use client";

import { useEffect, useMemo, useState } from "react";
import StepsAnalyticsGraph from "../analytics/stepsAnalyticsGraph";
import { useRouter } from "next/navigation";

const GL = {
  card: {
    background: "rgba(255,255,255,0.58)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1.5px solid rgba(255,255,255,0.8)",
    borderRadius: 18,
    boxShadow: "0 4px 24px rgba(171,31,16,0.07)",
  },
  input: {
    background: "rgba(255,255,255,0.7)",
    border: "1.5px solid rgba(171,31,16,0.15)",
    borderRadius: 11,
    padding: "13px 15px",
    fontSize: 15,
    fontFamily: "'Inter', sans-serif",
    color: "#1a0a09",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#7b241c",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    marginBottom: 7,
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 11,
    padding: "11px 20px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(171,31,16,0.22)",
    transition: "opacity 0.15s, transform 0.15s",
    whiteSpace: "nowrap",
  },
  btnOutline: {
    background: "rgba(255,255,255,0.7)",
    color: "#ab1f10",
    border: "1.5px solid rgba(171,31,16,0.3)",
    borderRadius: 11,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    transition: "background 0.15s",
    whiteSpace: "nowrap",
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 700,
    color: "#7b241c",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 16,
  },
};

const AI_SECTIONS = [
  { key: "SECTION_1", label: "Popular Flows", emoji: "🔥" },
  { key: "SECTION_2", label: "Drop-off & Friction", emoji: "⚠️" },
  { key: "SECTION_3", label: "Engagement Highlights", emoji: "⚡" },
  { key: "SECTION_4", label: "Why People Aren't Buying", emoji: "💳" },
];

function renderInline(text) {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 700, color: "#1a0a09" }}>{part.slice(2, -2)}</strong>;
    }
    // inline code: `text`
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith("`") && cp.endsWith("`")) {
        return <code key={j} style={{ background: "rgba(171,31,16,0.08)", borderRadius: 5, padding: "1px 6px", fontSize: 12, fontFamily: "monospace", color: "#ab1f10" }}>{cp.slice(1, -1)}</code>;
      }
      return <span key={j}>{cp}</span>;
    });
  });
}

function AiAnalysisView({ text }) {
  if (!text) return null;

  // Parse into sections
  const sectionMap = {};
  let current = null;
  for (const line of text.split("\n")) {
    const match = line.match(/SECTION_(\d+)/);
    if (match) {
      current = `SECTION_${match[1]}`;
      sectionMap[current] = [];
    } else if (current) {
      sectionMap[current].push(line);
    }
  }

  const hasSections = Object.keys(sectionMap).length > 0;
  if (!hasSections) {
    return (
      <div style={{ background: "rgba(255,255,255,0.65)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.09)", padding: "20px 22px", fontSize: 14, color: "#1a0a09", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
        {text}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {AI_SECTIONS.map(({ key, label, emoji }) => {
        const lines = (sectionMap[key] || []);
        if (!lines.filter(l => l.trim()).length) return null;
        const isConversion = key === "SECTION_4";

        // Parse lines into blocks
        const blocks = [];
        let i = 0;
        while (i < lines.length) {
          const raw = lines[i];
          const trimmed = raw.trim();

          if (!trimmed || trimmed === "---") { i++; continue; }

          // Numbered header like "1. **Heading:**" or "1. Heading"
          const numberedMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*:?\s*(.*)$/);
          if (numberedMatch) {
            blocks.push({ type: "numbered-header", num: numberedMatch[1], heading: numberedMatch[2], rest: numberedMatch[3] });
            i++; continue;
          }

          // ### heading
          if (trimmed.startsWith("###")) {
            blocks.push({ type: "h3", text: trimmed.replace(/^###\s*/, "") });
            i++; continue;
          }

          // ## heading
          if (trimmed.startsWith("##")) {
            blocks.push({ type: "h2", text: trimmed.replace(/^##\s*/, "") });
            i++; continue;
          }

          // Bold-only line (subheading): **text** or **text:**
          if (trimmed.match(/^\*\*[^*]+\*\*:?$/)) {
            blocks.push({ type: "subheading", text: trimmed.replace(/\*\*/g, "").replace(/:$/, "") });
            i++; continue;
          }

          // Bullet: - text or • text
          if (trimmed.match(/^[-•]\s+/)) {
            const content = trimmed.replace(/^[-•]\s+/, "");
            // Indent check
            const indent = raw.match(/^\s+/) ? raw.match(/^\s+/)[0].length : 0;
            blocks.push({ type: "bullet", text: content, indent: indent > 2 });
            i++; continue;
          }

          // Table row: | col | col |
          if (trimmed.startsWith("|")) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith("|")) {
              tableLines.push(lines[i].trim());
              i++;
            }
            blocks.push({ type: "table", rows: tableLines });
            continue;
          }

          // Plain text
          blocks.push({ type: "text", text: trimmed });
          i++;
        }

        return (
          <div key={key} style={{
            background: isConversion ? "rgba(171,31,16,0.03)" : "rgba(255,255,255,0.65)",
            borderRadius: 16,
            border: isConversion ? "1.5px solid rgba(171,31,16,0.18)" : "1px solid rgba(171,31,16,0.09)",
            overflow: "hidden",
          }}>
            {/* Section header */}
            <div style={{
              padding: "16px 22px",
              borderBottom: "1px solid rgba(171,31,16,0.08)",
              display: "flex", alignItems: "center", gap: 10,
              background: isConversion ? "rgba(171,31,16,0.06)" : "rgba(255,255,255,0.5)",
            }}>
              <span style={{ fontSize: 18 }}>{emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#ab1f10", letterSpacing: "0.07em", textTransform: "uppercase" }}>{label}</span>
            </div>

            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
              {blocks.map((block, bi) => {
                if (block.type === "h2" || block.type === "h3") {
                  return (
                    <div key={bi} style={{ fontSize: 13, fontWeight: 700, color: "#7b241c", marginTop: bi > 0 ? 10 : 0, marginBottom: 2 }}>
                      {renderInline(block.text)}
                    </div>
                  );
                }

                if (block.type === "subheading") {
                  return (
                    <div key={bi} style={{ fontSize: 13, fontWeight: 700, color: "#7b241c", marginTop: bi > 0 ? 12 : 0, marginBottom: 2, paddingBottom: 6, borderBottom: "1px solid rgba(171,31,16,0.07)" }}>
                      {block.text}
                    </div>
                  );
                }

                if (block.type === "numbered-header") {
                  return (
                    <div key={bi} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginTop: bi > 0 ? 10 : 0 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(171,31,16,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#ab1f10", flexShrink: 0, marginTop: 1 }}>
                        {block.num}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", lineHeight: 1.5 }}>
                        {renderInline(block.heading)}
                        {block.rest && <span style={{ fontWeight: 400, color: "#4a2020" }}> — {renderInline(block.rest)}</span>}
                      </div>
                    </div>
                  );
                }

                if (block.type === "bullet") {
                  return (
                    <div key={bi} style={{
                      display: "flex", gap: 10, alignItems: "flex-start",
                      background: block.indent ? "transparent" : "rgba(255,255,255,0.55)",
                      borderRadius: 9,
                      padding: block.indent ? "3px 14px 3px 28px" : "9px 14px",
                      border: block.indent ? "none" : "1px solid rgba(171,31,16,0.05)",
                    }}>
                      <span style={{ color: "#ab1f10", fontWeight: 700, flexShrink: 0, marginTop: 2, fontSize: block.indent ? 11 : 14 }}>
                        {block.indent ? "·" : "·"}
                      </span>
                      <span style={{ fontSize: 14, color: "#1a0a09", lineHeight: 1.6 }}>{renderInline(block.text)}</span>
                    </div>
                  );
                }

                if (block.type === "table") {
                  const rows = block.rows
                    .map(r => r.split("|").map(c => c.trim()).filter(Boolean))
                    .filter(r => !r.every(c => c.match(/^[-:]+$/)));
                  if (!rows.length) return null;
                  const [header, ...body] = rows;
                  return (
                    <div key={bi} style={{ overflowX: "auto", marginTop: 6, borderRadius: 10, border: "1px solid rgba(171,31,16,0.1)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: "rgba(171,31,16,0.07)" }}>
                            {header.map((h, hi) => (
                              <th key={hi} style={{ padding: "9px 14px", textAlign: "left", fontWeight: 700, color: "#7b241c", letterSpacing: "0.04em", borderBottom: "1px solid rgba(171,31,16,0.1)" }}>
                                {renderInline(h)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {body.map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.3)" }}>
                              {row.map((cell, ci) => (
                                <td key={ci} style={{ padding: "9px 14px", color: "#1a0a09", lineHeight: 1.5, borderBottom: ri < body.length - 1 ? "1px solid rgba(171,31,16,0.05)" : "none" }}>
                                  {renderInline(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                // plain text
                return (
                  <div key={bi} style={{ fontSize: 14, color: "#4a2020", lineHeight: 1.65 }}>
                    {renderInline(block.text)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function fmtDate(value) {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : isNaN(Date.parse(String(value))) ? null : Date.parse(String(value));
  if (!n) return "-";
  try { return new Date(n).toLocaleString(); } catch { return "-"; }
  
}

const isNumericId = (id) => /^\d+$/.test(String(id));

// Small stat card used in steps insights
function StatCard({ title, value, sub, children }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.72)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.08)", padding: "18px 20px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      {value !== undefined && <div style={{ fontSize: 28, fontWeight: 800, color: "#1a0a09", lineHeight: 1.1, marginBottom: 4 }}>{value}</div>}
      {sub && <div style={{ fontSize: 12, color: "#9b4a42", marginBottom: children ? 10 : 0 }}>{sub}</div>}
      {children}
    </div>
  );
}

// Small user ID pill list
function UserIdList({ ids }) {
  if (!ids?.length) return <div style={{ fontSize: 13, color: "#9b4a42" }}>None yet.</div>;
  return (
    <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
      {ids.map((num, i) => (
        <div key={i} style={{ background: "rgba(171,31,16,0.05)", borderRadius: 7, padding: "5px 10px", fontSize: 13, color: "#1a0a09", fontWeight: 500 }}>{num}</div>
      ))}
    </div>
  );
}

// Ranked list row (brands/products)
function RankRow({ left, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.65)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(171,31,16,0.06)" }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: "#1a0a09" }}>{left}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#ab1f10" }}>{right}</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();

  const [loadingList, setLoadingList] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [topViewedBrands, setTopViewedBrands] = useState([]);
  const [topViewedProducts, setTopViewedProducts] = useState([]);
  const [topPremiumBrands, setTopPremiumBrands] = useState([]);
  const [topPremiumProducts, setTopPremiumProducts] = useState([]);
  const [premiumUpdatedAt, setPremiumUpdatedAt] = useState(null);
  const [topPerfect5, setTopPerfect5] = useState([]);
  const [topPerfect24, setTopPerfect24] = useState([]);
  const [perfect5UpdatedAt, setPerfect5UpdatedAt] = useState(null);
  const [perfect24UpdatedAt, setPerfect24UpdatedAt] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showImages, setShowImages] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsInsights, setStepsInsights] = useState(null);
  const [activeTab, setActiveTab] = useState("views");
  const [graphData, setGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [usersWithPushTokens, setUsersWithPushTokens] = useState([]);
  const [buyers, setBuyers] = useState(null);       // null = not loaded yet
  const [buyersLoading, setBuyersLoading] = useState(false);
  const [buyersScanning, setBuyersScanning] = useState(false);
  const [boughtCoinsExpanded, setBoughtCoinsExpanded] = useState(false);
  const [boughtPremiumExpanded, setBoughtPremiumExpanded] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [aiDate, setAiDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [aiMessages, setAiMessages] = useState([]); // [{role: "user"|"assistant", content: "..."}]
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [userType, setUserType] = useState("numeric"); // "numeric" | "alpha"
  const [grantingPremium, setGrantingPremium] = useState(false);
const [grantPremiumResult, setGrantPremiumResult] = useState(null);
const [imgOptFolderSummary, setImgOptFolderSummary] = useState(null);
const [imgOptLoading, setImgOptLoading] = useState(false);
const [imgOptResult, setImgOptResult] = useState(null);
const [imgOptError, setImgOptError] = useState(null);
const [imgOptDryRun, setImgOptDryRun] = useState(true);
const [imgOptExpanded, setImgOptExpanded] = useState(false);
const [imgOptSelectedFolders, setImgOptSelectedFolders] = useState([]);

const ALL_IMG_FOLDERS = [
  "assets/drinks",
  "assets/snacks",
  "assets/sip-snack",
  "assets/memoji",
  "assets/preview",
  "assets/compare",
  "assets/helps",
  "assets/images",
];

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingList(true);
      try {
        const r = await fetch("/api/analytics/users", { cache: "no-store" });
        const j = await r.json();
        if (!active) return;
        setUsersList(j.users || []);
        setTopViewedBrands(j.topViewedBrands || []);
        setTopViewedProducts(j.topViewedProducts || []);
        setTopPremiumBrands(j.topPremiumBrands || []);
        setTopPremiumProducts(j.topPremiumProducts || []);
        setPremiumUpdatedAt(j.premiumUpdatedAt || null);
        setTopPerfect5(j.topPerfectProduct5Categories || []);
        setTopPerfect24(j.topPerfectProduct24Categories || []);
        setPerfect5UpdatedAt(j.perfectProduct5UpdatedAt || null);
        setPerfect24UpdatedAt(j.perfectProduct24UpdatedAt || null);
        setUsersWithPushTokens(j.usersWithPushTokens || []);
        // fetch buyers from S3 (read-only, no scan)
        try {
          const br = await fetch("/api/analytics/buyers", { cache: "no-store" });
          const bj = await br.json();
          if (bj.exists) setBuyers(bj);
        } catch { /* silent */ }
        } catch {
        if (!active) return;
      } finally {
        if (active) setLoadingList(false);
      }
    })();

    return () => (active = false);
  }, []);

  // Refetch graph whenever user-type tab changes
  useEffect(() => {
    let active = true;
    (async () => {
      setGraphLoading(true);
      try {
        const g = await fetch(`/api/analytics/steps-graph?type=${userType}`, { cache: "no-store" });
        const gjson = await g.json();
        if (active) setGraphData(gjson.graph || null);
      } catch {
        if (active) setGraphData(null);
      } finally {
        if (active) setGraphLoading(false);
      }
    })();
    return () => { active = false; };
  }, [userType]);

  // Clear stale analysis when switching tabs
  useEffect(() => {
    setStepsInsights(null);
    setAiAnalysis(null);
    setAiMessages([]);
    setAiError(null);
    setSelectedId(null);
  }, [userType]);


  useEffect(() => { setShowImages(false); }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    (async () => {
      setLoadingDetail(true);
      try {
        const r = await fetch(`/api/analytics/users?id=${encodeURIComponent(selectedId)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setDetail(j.user || null);
      } catch {
        if (active) setDetail(null);
      } finally {
        if (active) setLoadingDetail(false);
      }
    })();
    return () => { active = false; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = usersList || [];
    arr = arr.filter((u) => (userType === "numeric" ? isNumericId(u.id) : !isNumericId(u.id)));
    if (q) arr = arr.filter((u) => [String(u.id ?? ""), u.name ?? "", u.number ?? ""].join(" ").toLowerCase().includes(q));
    const getTs = (u) => {
      const v = u?.lastLogin ?? u?.createdAt;
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : isNaN(Date.parse(String(v))) ? null : Date.parse(String(v));
      return n && !Number.isNaN(n) ? n : null;
    };
    return [...arr].sort((a, b) => {
      const ta = getTs(a), tb = getTs(b);
      if (ta != null && tb == null) return -1;
      if (ta == null && tb != null) return 1;
      if (ta != null && tb != null && ta !== tb) return tb - ta;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [usersList, query, userType]);

  async function runAiAnalysis() {
  setAiLoading(true);
  setAiAnalysis(null);
  setAiError(null);
  setAiMessages([]);
  try {
    const r = await fetch(`/api/analytics/steps?date=${encodeURIComponent(aiDate)}&type=${userType}`, { cache: "no-store" });
    const j = await r.json();
    const BLACKLIST = new Set(["7383231612", "7862917606"]);
    const users = (j.users || []).filter((u) => !BLACKLIST.has(String(u.id)));

    if (!users.length) {
      setAiError("No users found with activity on this date.");
      setAiLoading(false);
      return;
    }

    const lines = users.map((u) => {
      const seq = u.steps.map((s) => s.step).join(" → ");
      return `User ${u.id}: ${seq}`;
    });
    const systemPrompt = `You are a product and conversion analyst for TrueHue, an AI-powered makeup shade-matching app.

Your job is NOT just to explain why users buy.

Your job is to understand EVERYTHING:

* What makes users purchase
* What stops users from purchasing
* Where users drop off
* Where users get confused
* What errors or bugs occurred
* Which features users love
* Which features users ignore
* Whether the paywall is shown at the right moment
* Whether users close the paywall immediately or spend time on it
* Whether users return after dismissing the paywall
* Which onboarding steps cause friction
* What should be improved in product, UX, copy, or pricing

Think like a combination of:

1. Product Manager
2. Growth Analyst
3. UX Researcher
4. Conversion Optimizer

Always be brutally honest and point out both strengths and weaknesses.

---

APP CONTEXT

PURCHASE MODEL:

TrueHue has TWO paid options:

✨ Lifetime Access — ₹99
Users pay once and unlock all premium features forever.

⏱️ One-Day Access — ₹39
Users unlock all premium features for 24 hours.

There are:

* No subscriptions
* No auto-renewal
* No coins
* No pass packs
* No premium tiers
* No free trials

Conversion events:

bought-premium = purchased premium access (Lifetime ₹99 OR One-Day ₹39) ✓ CONVERSION
bought-coins = purchased one day - rs 39 ✓ CONVERSION
cta-clicked-1-year = user tapped the LIFETIME (₹99) option's CTA on the paywall (note: the event is named "1-year" but it refers to Lifetime)
cta-clicked-1-day = user tapped the ONE-DAY (₹39) option's CTA on the paywall

---

FREE EXPERIENCE

Users can:

✓ Complete onboarding

✓ Shade Finder

* See all shades on models
* Compare shades on models
* Browse every shade

✓ Product Finder

* Full browsing experience
* Browse all brands and products
* On the MODEL: everything is fully visible (all shades)
* "On you": only 4 out of 8 shades are visible; the rest are locked
* Similar shades list: brand names are visible, but product names are blocked/locked

✓ Shade Guide

* Read the entire shade guide
* Browse all sections

However:

* "See it on you" is locked
* Exact shade recommendations are locked
* Shade Guide product recommendations are locked

Locked features show a CTA to purchase Lifetime Access.

---

PREMIUM EXPERIENCE

Lifetime Access unlocks:

✓ See all shades on YOU

✓ Exact shade recommendations

✓ Full Shade Guide experience

* Personalized recommendations
* Recommended products

✓ Compare shades on YOU

✓ All future premium features

Premium is designed as:

"Pay Once. Use Forever."

Price:

₹99

Subtext:

"All premium features unlocked forever."

CTA:

"Get Lifetime Access"

---

ANALYSIS FRAMEWORK

When analyzing sessions, focus on:

ONBOARDING

* Where users abandon onboarding
* Which screens are skipped quickly
* Which screens are revisited
* Whether onboarding is too long
* Whether users understand the value proposition

FEATURE DISCOVERY

* Which features users try first
* Which features they never use
* Which features keep them engaged
* Which features appear confusing

PAYWALL

* How many times the paywall opens
* Time spent before opening paywall
* Time spent on paywall
* Whether users scroll
* Whether users immediately close it
* Whether users reopen later
* Which action triggered the paywall
* Whether the paywall timing feels natural or aggressive
* Whether the pricing seems to create friction

CONVERSION

* What sequence of actions leads to purchase
* Which features are strongest purchase triggers
* Which users are most likely to buy
* What objections likely prevented purchase
* What changes could improve conversion

DROPOFF

* Exact point where users leave
* Patterns among dropoffs
* Possible confusion or bugs
* Missing information
* Friction in the experience

ERRORS

* Any crashes
* Broken events
* Failed API calls
* Missing images
* Invalid states
* UI inconsistencies
* Unexpected behavior

Always point out:

1. What's working
2. What's not working
3. Biggest opportunities
4. Biggest risks
5. Specific recommendations

---

STEP GLOSSARY

login

submit-photo

skintone-result-next

undertone-result-next

lip-pigmentation-selected

model_select

model-fine-tune

disclaimer

home-page

shade-finder
= opened Shade Finder

product-finder
= opened Product Finder

shade-guide
= visited Shade Guide

locked-shade-clicked
= user tapped a locked shade

on-you-toggle-clicked
= user attempted "See it on you"

recommended-shade-clicked-your_shade

recommended-shade-clicked-lighter

recommended-shade-clicked-darker

compare-shades

payment-popup-open

payment-popup-close
= paywall closed

cta-clicked-1-year
= tapped the Lifetime (₹99) CTA on the paywall (event name says "1-year" but it means Lifetime)

cta-clicked-1-day
= tapped the One-Day (₹39) CTA on the paywall

bought-premium
= purchased premium access (Lifetime ₹99 or One-Day ₹39) ✓ CONVERSION`;


  const firstUserMessage = `Analyse ${aiDate}. ${users.length} user(s) were active.

Step sequences (→ = next action):

${lines.join("\n")}

Respond in EXACTLY this structure:

SECTION_1: EXECUTIVE SUMMARY

* Total active users
* Number who opened the paywall
* Number who purchased (bought-premium)
* Paywall conversion rate
* Biggest success in the funnel
* Biggest dropoff in the funnel
* Most surprising user behaviour

---

SECTION_2: CONVERSION ANALYSIS

For every user who purchased (bought-premium):

* What were their last 5 actions before purchase?
* What feature triggered the paywall?
* How much of the app had they explored?
* Did they use Shade Finder, Product Finder and Shade Guide?
* Were they exploring multiple shades or a single shade?
* Did they hesitate after the paywall or buy immediately?
* What behavioural patterns are common across purchasers?

Then summarize:

* Top reasons users buy
* Strongest purchase triggers
* Which feature creates the most value

---

SECTION_3: PAYWALL ANALYSIS

For every user who opened the paywall:

* What action triggered the paywall?
* How long had they been using the app before opening it?
* Did they close immediately or stay for some time?
* Did they reopen it later?
* Did they continue exploring after closing?
* Did they eventually purchase?

Then summarize:

* Is the paywall shown at the right moment?
* Does the paywall appear too early or too late?
* What friction likely exists on the paywall?
* What should be changed first?

---

SECTION_4: CONVERSION LOSSES

For every user who opened the paywall but never purchased:

* What were their last 5 actions before opening it?
* How much had they explored?
* Were they in the middle of a task?
* What were they trying to do?
* Did they leave immediately after closing?
* Did they come back later?

Then summarize:

* Most likely reasons they did not buy
* Common behavioural patterns
* Product or UX improvements that may help

---

SECTION_5: DROP OFFS

Find users who:

* Left during onboarding
* Never opened Shade Finder
* Never opened Product Finder
* Never opened Shade Guide
* Opened features but stopped quickly
* Reached premium walls and disappeared

For each major dropoff:

* Exact step where it happened
* What the user was trying to do
* Possible reason for leaving
* Confidence level (High / Medium / Low)

Then summarize:

* Biggest funnel leak
* Most concerning behaviour
* Fastest improvement opportunity

---

SECTION_6: FEATURE ENGAGEMENT

Compare:

Purchasers vs Non-purchasers

Answer:

* Which features are most used?
* Which features are ignored?
* Which features correlate with purchase?
* Are converters more likely to compare shades?
* Are converters more likely to visit Shade Guide?
* Are converters more likely to use Product Finder?

Then rank:

1. Highest value feature
2. Highest engagement feature
3. Most underutilized feature
4. Feature most likely to drive conversion if improved

---

SECTION_7: ERRORS & SUSPICIOUS PATTERNS

Look for:

* Missing events
* Broken funnels
* Users stuck repeating actions
* Unexpected jumps
* Users abandoning immediately after a step
* Possible bugs
* Inconsistent event sequences

For every issue:

* Describe the issue
* Which users experienced it
* Severity (Low / Medium / High)
* Suggested fix

---

SECTION_8: WHAT TO FIX THIS WEEK

Give:

1 Primary Fix

* Exact step
* Problem
* Why it matters
* Exact implementation suggestion

2 Supporting Fixes

* Exact implementation suggestions

Prioritize changes by expected impact on:

1. Purchases
2. Retention
3. User experience`;

    const initialMessages = [{ role: "user", content: firstUserMessage }];

    const resp = await fetch("/api/analytics/ai-analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: firstUserMessage, system: systemPrompt }),
    });
    const data = await resp.json();
    const text = data.text || "";

    const newMessages = [
      { role: "user", content: firstUserMessage },
      { role: "assistant", content: text },
    ];
    setAiMessages(newMessages);
    setAiAnalysis({ date: aiDate, userCount: users.length, text, systemPrompt, rawMessages: newMessages });
  } catch (e) {
    setAiError(e.message || "Analysis failed");
  } finally {
    setAiLoading(false);
  }
}

async function sendAiChat() {
  if (!aiChatInput.trim() || !aiAnalysis) return;
  const userMsg = aiChatInput.trim();
  setAiChatInput("");
  setAiChatLoading(true);

  const updatedMessages = [...aiMessages, { role: "user", content: userMsg }];
  setAiMessages(updatedMessages);

  try {
    const resp = await fetch("/api/analytics/ai-analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: aiAnalysis.systemPrompt,
        messages: updatedMessages,
      }),
    });
    const data = await resp.json();
    const text = data.text || "";
    const finalMessages = [...updatedMessages, { role: "assistant", content: text }];
    setAiMessages(finalMessages);
    setAiAnalysis((prev) => prev ? { ...prev, text, rawMessages: finalMessages } : prev);
  } catch (e) {
    setAiMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
  } finally {
    setAiChatLoading(false);
  }
}

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .th-btn-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .list-item:hover { background: rgba(171,31,16,0.04) !important; }
        .list-item.selected { background: rgba(171,31,16,0.08) !important; border-left: 4px solid #ab1f10 !important; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
        .tab-btn { background: none; border: none; border-bottom: 3px solid transparent; padding: 10px 18px; font-size: 14px; font-weight: 600; color: #9b4a42; cursor: pointer; transition: all 0.15s; }
        .tab-btn:hover { color: #ab1f10; }
        .tab-btn.active { border-bottom-color: #ab1f10; color: #ab1f10; }
      `}</style>

      {/* ── Top Nav ── */}
      <div style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)", borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "16px 36px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="th-btn-ghost" onClick={() => router.push('/')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#ab1f10", padding: "8px 14px", borderRadius: 9 }}>← Home</button>
          <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
          <button className="th-btn-ghost" onClick={() => router.push('/logs')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>Logs</button>
          <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
          <button className="th-btn-ghost" onClick={() => router.push('/audit')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>Audit</button>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>User Analytics</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="th-btn-outline" style={GL.btnOutline}
            onClick={async () => {
              setStepsLoading(true);
              try { const r = await fetch(`/api/analytics/steps?type=${userType}`, { cache: "no-store" }); const j = await r.json(); setStepsInsights(j.insights || null); }
              catch { setStepsInsights(null); } finally { setStepsLoading(false); }
            }}>
            {stepsLoading ? "Analysing…" : "Analyse Steps"}
          </button>
          <button className="th-btn-outline" style={{ ...GL.btnOutline, opacity: buyersScanning ? 0.6 : 1 }}
            disabled={buyersScanning}
            onClick={async () => {
              if (!confirm("This will scan all users and save purchase_data.json to S3. Continue?")) return;
              setBuyersScanning(true);
              try {
                const r = await fetch("/api/analytics/buyers", { method: "POST", cache: "no-store" });
                const j = await r.json();
                if (j.ok) setBuyers(j);
              } catch { /* silent */ } finally { setBuyersScanning(false); }
            }}>
            {buyersScanning ? "Scanning…" : "💳 List Buyers"}
          </button>
          <button className="th-btn-outline" style={GL.btnOutline}
            onClick={async () => {
              setLoadingList(true);
              try { const r = await fetch("/api/analytics/users?mode=full", { cache: "no-store" }); const j = await r.json(); setUsersList(j.users || []); }
              catch (e) { console.error(e); } finally { setLoadingList(false); }
            }}>
            Sort by Activity
          </button>
          <button className="th-btn-outline" style={{ ...GL.btnOutline, opacity: backfilling ? 0.6 : 1 }}
            disabled={backfilling}
            onClick={async () => {
              if (!confirm("This will scan all users and overwrite daily_graph.json. Continue?")) return;
              setBackfilling(true);
              setBackfillResult(null);
              try {
                const r = await fetch(`/api/analytics/backfill-graph?type=${userType}`, { method: "POST", cache: "no-store" });
                const j = await r.json();
                if (j.ok) {
                  setBackfillResult(`✓ Backfill done — ${j.days} days written`);
                  // refresh graph display
                  const g = await fetch(`/api/analytics/steps-graph?type=${userType}&t=${Date.now()}`, { cache: "no-store" });
                  const gjson = await g.json();
                  setGraphData(gjson.graph || null);
                } else {
                  setBackfillResult(`✗ Error: ${j.error}`);
                }
              } catch (e) {
                setBackfillResult(`✗ ${e.message}`);
              } finally {
                setBackfilling(false);
              }
            }}>
            {backfilling ? "Backfilling…" : "Backfill Graph"}
          </button>
          <button className="th-btn-primary" style={GL.btnPrimary}
            onClick={async () => {
              try {
                const r = await fetch("/api/analytics/users?export=meta", { cache: "no-store" });
                const j = await r.json();
                if (j.rows && j.rows.length > 0) {
                  const headers = "phone,fn,country";
                  const rows = j.rows.map(row => 
                    `${row.phone},${row.fn},${row.country}`
                  );
                  const csv = headers + "\n" + rows.join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `truehue-meta-audience-${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  alert(`✓ Downloaded ${j.rows.length} users for Meta audience`);
                } else {
                  alert("No user data found");
                }
              } catch (e) {
                alert(`Error: ${e.message}`);
              }
            }}>
            📱 Export Meta Audience
          </button>
        </div>
      </div>

      <div style={{ padding: "28px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── User Type Tabs ── */}
        <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.58)", backdropFilter: "blur(20px)", borderRadius: 14, padding: 6, border: "1.5px solid rgba(255,255,255,0.8)", width: "fit-content", boxShadow: "0 4px 24px rgba(171,31,16,0.07)" }}>
          {[
            { id: "numeric", label: "🔢 Number Users" },
            { id: "alpha", label: "🔤 Alphanumeric Users" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setUserType(t.id)}
              style={{
                background: userType === t.id ? "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)" : "transparent",
                color: userType === t.id ? "#fff" : "#7b241c",
                border: "none", borderRadius: 10, padding: "10px 22px",
                fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.15s",
                boxShadow: userType === t.id ? "0 4px 12px rgba(171,31,16,0.25)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {grantPremiumResult && (
          <div style={{ background: grantPremiumResult.startsWith("✓") ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)", border: `1px solid ${grantPremiumResult.startsWith("✓") ? "rgba(22,163,74,0.3)" : "rgba(220,38,38,0.3)"}`, borderRadius: 12, padding: "14px 20px", fontSize: 14, fontWeight: 600, color: grantPremiumResult.startsWith("✓") ? "#15803d" : "#dc2626", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {grantPremiumResult}
            <button onClick={() => setGrantPremiumResult(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "inherit", opacity: 0.6 }}>✕</button>
          </div>
        )}
        {backfillResult && (
          <div style={{ background: backfillResult.startsWith("✓") ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)", border: `1px solid ${backfillResult.startsWith("✓") ? "rgba(22,163,74,0.3)" : "rgba(220,38,38,0.3)"}`, borderRadius: 12, padding: "14px 20px", fontSize: 14, fontWeight: 600, color: backfillResult.startsWith("✓") ? "#15803d" : "#dc2626", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {backfillResult}
            <button onClick={() => setBackfillResult(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "inherit", opacity: 0.6 }}>✕</button>
          </div>
        )}

        {/* ── Grant Premium ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={GL.sectionHeader}>Grant Premium Access</div>
            <span style={{ fontSize: 13, color: "#9b4a42", flex: 1 }}>
              Grants 1-year premium to all users with more than 2 coins who are not already subscribed.
            </span>
            <button
              className="th-btn-primary"
              style={{ ...GL.btnPrimary, opacity: grantingPremium ? 0.6 : 1 }}
              disabled={grantingPremium}
              onClick={async () => {
                if (!confirm("Grant 1yr premium to all users with >2 coins who aren't already subscribed?")) return;
                setGrantingPremium(true);
                setGrantPremiumResult(null);
                try {
                  const r = await fetch("/api/analytics/grant-premium-bulk", { method: "POST", cache: "no-store" });
                  const j = await r.json();
                  if (j.ok) {
                    setGrantPremiumResult(`✓ Granted to ${j.granted?.length ?? 0} users (${j.failed?.length ?? 0} failed)`);
                  } else {
                    setGrantPremiumResult(`✗ Error: ${j.error}`);
                  }
                } catch (e) {
                  setGrantPremiumResult(`✗ ${e.message}`);
                } finally {
                  setGrantingPremium(false);
                }
              }}
            >
              {grantingPremium ? "Granting…" : "🎁 Grant Premium (>2 coins)"}
            </button>
          </div>
        </div>

        {/* ── Image Optimizer ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", cursor: "pointer" }}
            onClick={() => {
              setImgOptExpanded((v) => !v);
              if (!imgOptFolderSummary && !imgOptLoading) {
                setImgOptLoading(true);
                fetch("/api/analytics/optimize-images")
                  .then((r) => r.json())
                  .then((j) => { setImgOptFolderSummary(j.folders || null); })
                  .catch(() => {})
                  .finally(() => setImgOptLoading(false));
              }
            }}
          >
            <div style={GL.sectionHeader}>🖼️ Image Optimizer</div>
            <span style={{ fontSize: 13, color: "#9b4a42", flex: 1 }}>
              Resize all CDN images to 600px · convert to WebP · ~90% smaller
            </span>
            <span style={{ fontSize: 13, color: "#ab1f10", fontWeight: 600 }}>
              {imgOptExpanded ? "▲ Hide" : "▼ Show"}
            </span>
          </div>

          {imgOptExpanded && (
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>

              {imgOptFolderSummary && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                  {imgOptFolderSummary.map((f) => {
                    const folderKey = f.folder.replace(/\/$/, "");
                    const isSelected = imgOptSelectedFolders.includes(folderKey);
                    return (
                      <div
                        key={f.folder}
                        onClick={(e) => {
                          e.stopPropagation();
                          setImgOptSelectedFolders((prev) =>
                            prev.includes(folderKey)
                              ? prev.filter((x) => x !== folderKey)
                              : [...prev, folderKey]
                          );
                        }}
                        style={{
                          background: isSelected ? "rgba(171,31,16,0.07)" : "rgba(255,255,255,0.65)",
                          border: `1.5px solid ${isSelected ? "#ab1f10" : "rgba(171,31,16,0.1)"}`,
                          borderRadius: 12,
                          padding: "12px 16px",
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a0a09", marginBottom: 4 }}>
                          {f.folder.replace("assets/", "").replace("/", "")}
                          {isSelected && <span style={{ marginLeft: 6, color: "#ab1f10" }}>✓</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "#9b4a42" }}>
                          {f.fileCount} files · {f.totalMB} MB
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {imgOptLoading && !imgOptResult && (
                <div style={{ fontSize: 14, color: "#9b4a42" }}>Loading folder info…</div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#7b241c" }}>
                  <div
                    onClick={(e) => { e.stopPropagation(); setImgOptDryRun((v) => !v); }}
                    style={{
                      width: 40, height: 22, borderRadius: 11,
                      background: imgOptDryRun ? "#ab1f10" : "rgba(171,31,16,0.2)",
                      position: "relative", transition: "background 0.2s", cursor: "pointer",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 3, left: imgOptDryRun ? 20 : 3,
                      width: 16, height: 16, borderRadius: 8, background: "#fff",
                      transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                    }} />
                  </div>
                  {imgOptDryRun ? "Dry run (preview only)" : "Live (will overwrite S3)"}
                </label>

                <span style={{ fontSize: 13, color: "#9b4a42" }}>
                  {imgOptSelectedFolders.length === 0
                    ? "All folders will be processed"
                    : `${imgOptSelectedFolders.length} folder${imgOptSelectedFolders.length > 1 ? "s" : ""} selected`}
                </span>

                {imgOptSelectedFolders.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setImgOptSelectedFolders([]); }}
                    style={{ background: "none", border: "none", fontSize: 13, color: "#ab1f10", cursor: "pointer", fontWeight: 600 }}
                  >
                    Clear selection
                  </button>
                )}

                <button
                  className="th-btn-primary"
                  style={{
                    ...GL.btnPrimary,
                    opacity: imgOptLoading ? 0.6 : 1,
                    background: imgOptDryRun
                      ? "linear-gradient(135deg, #7b7b7b 0%, #555 100%)"
                      : "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)",
                  }}
                  disabled={imgOptLoading}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!imgOptDryRun && !confirm(
                      `This will permanently overwrite images in S3 with compressed WebP versions.\n\nFolders: ${imgOptSelectedFolders.length > 0 ? imgOptSelectedFolders.join(", ") : "ALL"}\n\nContinue?`
                    )) return;

                    setImgOptLoading(true);
                    setImgOptResult(null);
                    setImgOptError(null);

                    try {
                      const r = await fetch("/api/analytics/optimize-images", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          dryRun: imgOptDryRun,
                          folders: imgOptSelectedFolders.length > 0 ? imgOptSelectedFolders : undefined,
                        }),
                      });
                      const j = await r.json();
                      if (j.ok) setImgOptResult(j);
                      else setImgOptError(j.error || "Failed");
                    } catch (e) {
                      setImgOptError(e.message);
                    } finally {
                      setImgOptLoading(false);
                    }
                  }}
                >
                  {imgOptLoading ? "Processing…" : imgOptDryRun ? "🔍 Preview savings" : "⚡ Optimize & save"}
                </button>
              </div>

              {imgOptError && (
                <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, padding: "12px 16px", fontSize: 14, color: "#dc2626" }}>
                  {imgOptError}
                </div>
              )}

              {imgOptResult && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                    {[
                      { label: "Processed", value: imgOptResult.summary.processed, color: "#1a0a09" },
                      { label: "Skipped", value: imgOptResult.summary.skipped, color: "#9b4a42" },
                      { label: "Failed", value: imgOptResult.summary.failed, color: "#dc2626" },
                      { label: "Original", value: `${imgOptResult.summary.originalMB} MB`, color: "#1a0a09" },
                      { label: imgOptResult.dryRun ? "Would be" : "Now", value: `${imgOptResult.summary.optimizedMB} MB`, color: "#15803d" },
                      { label: "Saved", value: `${imgOptResult.summary.savingPct}%`, color: "#ab1f10" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: "rgba(255,255,255,0.72)", borderRadius: 12, border: "1px solid rgba(171,31,16,0.08)", padding: "14px 16px" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.07)", overflow: "hidden" }}>
                    <div style={{ maxHeight: 340, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead style={{ position: "sticky", top: 0, background: "rgba(255,255,255,0.95)", zIndex: 1 }}>
                          <tr style={{ borderBottom: "1px solid rgba(171,31,16,0.1)" }}>
                            {["File", "Status", "Before", "After", "Saving"].map((h) => (
                              <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#7b241c", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {imgOptResult.results.map((row, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid rgba(171,31,16,0.04)", background: i % 2 === 0 ? "rgba(255,255,255,0.5)" : "transparent" }}>
                              <td style={{ padding: "8px 14px", color: "#1a0a09", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                <div style={{ fontSize: 12, color: "#9b4a42", marginBottom: 2 }}>from: {row.key.replace("assets/", "")}</div>
                                <div style={{ fontSize: 12, color: "#15803d" }}>to: {row.outputKey?.replace("assets_optimised/", "") || "—"}</div>
                              </td>
                              <td style={{ padding: "8px 14px" }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                                  background: row.status === "optimized" ? "rgba(22,163,74,0.1)" : row.status === "dry-run" ? "rgba(171,31,16,0.08)" : row.status === "failed" ? "rgba(220,38,38,0.1)" : "rgba(0,0,0,0.05)",
                                  color: row.status === "optimized" ? "#15803d" : row.status === "dry-run" ? "#ab1f10" : row.status === "failed" ? "#dc2626" : "#9b4a42",
                                }}>
                                  {row.status}
                                </span>
                              </td>
                              <td style={{ padding: "8px 14px", color: "#9b4a42" }}>{row.originalKB ? `${row.originalKB} KB` : "—"}</td>
                              <td style={{ padding: "8px 14px", color: "#15803d", fontWeight: 600 }}>{row.optimizedKB ? `${row.optimizedKB} KB` : "—"}</td>
                              <td style={{ padding: "8px 14px", color: "#ab1f10", fontWeight: 700 }}>{row.savingPct != null ? `${row.savingPct}%` : row.reason || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {!imgOptResult.dryRun && (
                    <div style={{ background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.2)", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#15803d", fontWeight: 600 }}>
                      ✓ Images saved to S3. CloudFront will serve fresh versions within ~60s.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── AI Daily Analysis ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: aiAnalysis || aiError ? 20 : 0 }}>
            <div style={GL.sectionHeader}>AI Daily Step Analysis</div>
            <input
              type="date"
              className="th-input"
              style={{ ...GL.input, width: "auto", fontSize: 14, padding: "9px 13px" }}
              value={aiDate}
              onChange={(e) => setAiDate(e.target.value)}
            />
            <button
              className="th-btn-primary"
              style={{ ...GL.btnPrimary, opacity: aiLoading ? 0.6 : 1 }}
              disabled={aiLoading}
              onClick={runAiAnalysis}
            >
              {aiLoading ? "Analysing…" : "✦ Analyse with AI"}
            </button>
          </div>

          {aiError && (
            <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, padding: "12px 16px", fontSize: 14, color: "#dc2626" }}>
              {aiError}
            </div>
          )}

          {aiAnalysis && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div style={{ fontSize: 13, color: "#9b4a42" }}>
                  {aiAnalysis.userCount} active user{aiAnalysis.userCount !== 1 ? "s" : ""} on {aiAnalysis.date}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="th-btn-outline" style={GL.btnOutline}
                    onClick={() => {
                      navigator.clipboard.writeText(aiAnalysis.text);
                    }}>
                    ⎘ Copy
                  </button>
                  {["pdf", "docx"].map((fmt) => (
                    <button key={fmt} className="th-btn-outline" style={GL.btnOutline}
                      onClick={async () => { 
                        try {
                          const r = await fetch("/api/analytics/export-report", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ text: aiAnalysis.text, date: aiAnalysis.date, userCount: aiAnalysis.userCount, format: fmt }),
                          });
                          if (!r.ok) throw new Error(await r.text());
                          const blob = await r.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `truehue-analysis-${aiAnalysis.date}.${fmt}`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          alert(`Export failed: ${e.message}`);
                        }
                      }}>
                      ↓ {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <AiAnalysisView text={aiAnalysis?.text} />

              {/* ── Chat thread ── */}
              {aiMessages.length > 2 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                  {aiMessages.slice(2).map((msg, i) => (
                    <div key={i} style={{
                      alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "90%",
                      background: msg.role === "user" ? "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)" : "rgba(255,255,255,0.72)",
                      color: msg.role === "user" ? "#fff" : "#1a0a09",
                      borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                      padding: "12px 16px",
                      fontSize: 14,
                      lineHeight: 1.6,
                      border: msg.role === "assistant" ? "1px solid rgba(171,31,16,0.1)" : "none",
                      boxShadow: "0 2px 8px rgba(171,31,16,0.08)",
                    }}>
                      {msg.role === "assistant" ? <AiAnalysisView text={msg.content} /> : msg.content}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Chat input ── */}
              <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end" }}>
                <textarea
                  className="th-input"
                  style={{ ...GL.input, resize: "none", minHeight: 44, maxHeight: 120, lineHeight: 1.5, flex: 1, fontSize: 14 }}
                  placeholder="Correct something, add context, or ask a follow-up…"
                  value={aiChatInput}
                  rows={2}
                  onChange={(e) => setAiChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiChat(); }
                  }}
                />
                <button
                  className="th-btn-primary"
                  style={{ ...GL.btnPrimary, opacity: (aiChatLoading || !aiChatInput.trim()) ? 0.6 : 1, height: 44, paddingLeft: 20, paddingRight: 20 }}
                  disabled={aiChatLoading || !aiChatInput.trim()}
                  onClick={sendAiChat}
                >
                  {aiChatLoading ? "…" : "Send"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Funnel Graph ── */}
        <div style={{ ...GL.card, padding: 28, overflow: "visible" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={GL.sectionHeader}>Daily User Funnel & Coin Actions</div>
            {graphLoading && <span style={{ fontSize: 13, color: "#9b4a42" }}>Loading…</span>}
          </div>
          {graphData
            ? <StepsAnalyticsGraph data={graphData} userType={userType} />
            : !graphLoading && <div style={{ fontSize: 14, color: "#9b4a42", padding: "20px 0" }}>No graph data available.</div>}
        </div>

        {/* ── Steps Insights (expanded when loaded) ── */}
        {stepsInsights && (
          <div style={{ ...GL.card, padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={GL.sectionHeader}>Steps Insights</div>
              <span style={{ fontSize: 13, color: "#9b4a42" }}>
                {stepsInsights.usersWithSteps} users · {stepsInsights.timedUsers ? `${stepsInsights.timedUsers} timed` : ""}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
              <StatCard title="Returning Users" value={stepsInsights.retention?.returningUsers}
                sub={`${stepsInsights.retention?.returningRate}% logged in on multiple days`} />

              <StatCard title="Use-Coins Users" value={stepsInsights.useCoins?.totalUsers}
                sub={`${stepsInsights.useCoins?.totalEvents || 0} total actions`} />

              <StatCard title="Most Common Coin Actions">
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                  {(stepsInsights.useCoins?.topTypes || []).slice(0, 5).map((t, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "rgba(171,31,16,0.05)", borderRadius: 7, padding: "5px 10px", fontSize: 13 }}>
                      <span style={{ fontWeight: 500, color: "#1a0a09" }}>{t.type}</span>
                      <span style={{ fontWeight: 700, color: "#ab1f10" }}>{t.count}</span>
                    </div>
                  ))}
                </div>
              </StatCard>

              <StatCard title="Model Fine-Tune" value={stepsInsights.modelFineTune?.totalUsersReached}
                sub={`${stepsInsights.modelFineTune?.totalEvents || 0} total fine-tune actions`} />

              <StatCard title="Shade Guide Scrolls" value={stepsInsights.shadeGuideActions?.scroll?.totalUsers}
                sub={`${stepsInsights.shadeGuideActions?.scroll?.totalEvents || 0} total scroll events`} />

              <StatCard title="Shade Guide Clicks" value={stepsInsights.shadeGuideActions?.clicked?.totalUsers}
                sub={`${stepsInsights.shadeGuideActions?.clicked?.totalEvents || 0} total click events`}>
                <UserIdList ids={stepsInsights.shadeGuideActions?.clicked?.userIds} />
              </StatCard>

              <StatCard title="Subscribers" value={stepsInsights.subscribers?.total}
                sub="Users subscribed to TrueHue">
                <UserIdList ids={stepsInsights.subscribers?.userIds} />
              </StatCard>

              <StatCard title="Users With Coins" value={stepsInsights.usersWithCoins?.total}
                sub="More than 0 coins">
                <UserIdList ids={stepsInsights.usersWithCoins?.userIds} />
              </StatCard>

              <StatCard title="Shade Guide Purchases" value={stepsInsights.usersWithShadeGuide?.total}>
                <UserIdList ids={stepsInsights.usersWithShadeGuide?.userIds} />
              </StatCard>
            </div>
          </div>
        )}

        {/* ── Users + Detail ── */}
        <div style={{ ...GL.card, padding: 0, overflow: "hidden" }}>
          {/* Search + header */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(171,31,16,0.08)", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
              Users <span style={{ fontWeight: 400, color: "#b08080" }}>({filtered.length})</span>
            </div>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15 }}>🔎</span>
              <input className="th-input" style={{ ...GL.input, paddingLeft: 36, fontSize: 14 }}
                placeholder="Search by name, number, or ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", minHeight: 500 }}>

            {/* User list */}
            <div style={{ borderRight: "1px solid rgba(171,31,16,0.08)", overflowY: "auto", maxHeight: "70vh" }}>
              {loadingList && filtered.length === 0 && (
                <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 14, color: "#9b4a42" }}>Loading…</div>
              )}
              {!loadingList && filtered.length === 0 && (
                <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 14, color: "#9b4a42" }}>No matching users.</div>
              )}
              {filtered.map((u) => {
                const isSel = selectedId === u.id;
                return (
                  <div key={u.id}
                    className={`list-item ${isSel ? "selected" : ""}`}
                    onClick={() => setSelectedId(u.id)}
                    style={{ padding: "13px 20px 13px 20px", cursor: "pointer", borderLeft: "4px solid transparent", borderBottom: "1px solid rgba(171,31,16,0.05)", transition: "background 0.12s" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{u.number}</div>
                    {u.name && <div style={{ fontSize: 12, color: "#7b241c", marginTop: 1 }}>{u.name}</div>}
                  </div>
                );
              })}
            </div>

            {/* User detail */}
            <div style={{ padding: 28, overflowY: "auto", maxHeight: "70vh" }}>
              {!selectedId && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 12 }}>
                  <div style={{ fontSize: 32 }}>👈</div>
                  <div style={{ fontSize: 15, color: "#9b4a42", fontWeight: 500 }}>Select a user to view analytics</div>
                </div>
              )}
              {selectedId && loadingDetail && (
                <div style={{ fontSize: 14, color: "#9b4a42", padding: "40px 0", textAlign: "center" }}>Loading details…</div>
              )}
              {selectedId && !loadingDetail && !detail && (
                <div style={{ fontSize: 14, color: "#9b4a42", padding: "40px 0", textAlign: "center" }}>No details available.</div>
              )}
              {selectedId && detail && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                  {/* User header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#1a0a09", marginBottom: 3 }}>{detail.info?.name || "Unnamed User"}</div>
                      <div style={{ fontSize: 14, color: "#7b241c", marginBottom: 2 }}>{detail.info?.number || detail.info?.id || detail.id || "-"}</div>
                      <div style={{ fontSize: 13, color: "#9b4a42" }}>
                        {detail.info?.email || "-"}{detail.info?.phone ? ` · ${detail.info.phone}` : ""}
                      </div>
                      <div style={{ fontSize: 12, color: "#b08080", marginTop: 3 }}>
                        Joined {fmtDate(detail.info?.createdAt)}
                        {detail.info?.lastLogin ? ` · Last login ${fmtDate(detail.info.lastLogin)}` : ""}
                      </div>
                      {(detail.info?.skinTone || detail.info?.undertone) && (
                        <div style={{ fontSize: 12, color: "#7b241c", marginTop: 3 }}>
                          {detail.info.skinTone ? `Skin Tone: ${detail.info.skinTone}` : ""}
                          {detail.info.undertone ? ` · Undertone: ${detail.info.undertone}` : ""}
                        </div>
                      )}
                      <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: "#ab1f10" }}>
                        {detail.wallet?.coins ?? 0} coins{detail.wallet?.subscriber ? " · Subscriber ✓" : ""}
                      </div>
                    </div>
                    <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setShowImages((v) => !v)}>
                      {showImages ? "Hide Images" : "View Images"}
                    </button>
                  </div>

                  {/* Images */}
                  {showImages && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      {[
                        { label: "User Image", src: detail.info?.number && detail.info?.latestVersion ? `https://d2bsc5jetkp62c.cloudfront.net/permanent/shopify/${detail.info.number}/${detail.info.latestVersion}/high_quality_image` : null },
                        { label: "Model Image", src: detail.info?.modelPath ? `https://d2bsc5jetkp62c.cloudfront.net/full_model_pics_jpg/${detail.info.modelPath}` : null },
                      ].map(({ label, src }) => (
                        <div key={label} style={{ background: "rgba(255,255,255,0.6)", borderRadius: 12, border: "1px solid rgba(171,31,16,0.08)", padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                          {src ? <img src={src} alt={label} style={{ width: "100%", maxWidth: 240, borderRadius: 10, objectFit: "cover" }} />
                            : <div style={{ fontSize: 13, color: "#9b4a42" }}>Not available.</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Steps */}
                  <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.07)", padding: 20 }}>
                    <div style={{ ...GL.sectionHeader }}>Steps Taken ({detail.steps?.count || 0})</div>
                    {!(detail.steps?.items?.length) ? (
                      <div style={{ fontSize: 14, color: "#9b4a42" }}>No steps recorded.</div>
                    ) : (
                      <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                        {detail.steps.items.map((s, idx) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.7)", borderRadius: 9, padding: "9px 14px" }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{s.step}</span>
                            <span style={{ fontSize: 12, color: "#9b4a42" }}>{fmtDate(s.at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Premium products */}
                  <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.07)", padding: 20 }}>
                    <div style={GL.sectionHeader}>Premium Products ({detail.premium?.count || 0})</div>
                    {!(detail.premium?.products?.length) ? (
                      <div style={{ fontSize: 14, color: "#9b4a42" }}>No premium purchases.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {detail.premium.products.map((p, idx) => (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "center", background: "rgba(255,255,255,0.7)", borderRadius: 9, padding: "10px 14px" }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{p.product}</span>
                            <span style={{ fontSize: 13, color: "#7b241c" }}>{p.brand}</span>
                            <span style={{ fontSize: 12, color: "#9b4a42" }}>{fmtDate(p.purchasedAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Favourites */}
                  <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.07)", padding: 20 }}>
                    <div style={GL.sectionHeader}>Favourites ({detail.favourites?.count || 0})</div>
                    {!(detail.favourites?.items?.length) ? (
                      <div style={{ fontSize: 14, color: "#9b4a42" }}>No favourites yet.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {/* Header row */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 80px 1fr auto", gap: 12, padding: "0 14px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          <span>Name / Brand</span><span></span><span>Hex</span><span>Link</span><span>Price</span>
                        </div>
                        {detail.favourites.items.map((f, idx) => (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 40px 80px 1fr auto", gap: 12, alignItems: "center", background: "rgba(255,255,255,0.7)", borderRadius: 9, padding: "10px 14px" }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{f.name || f.product || "—"}</div>
                              <div style={{ fontSize: 12, color: "#7b241c" }}>{f.brand || "-"}</div>
                            </div>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: f.hex || "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.12)" }} title={f.hex || ""} />
                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "#7b241c" }}>{f.hex || "-"}</span>
                            <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.link ? <a href={f.link} target="_blank" rel="noreferrer" style={{ color: "#ab1f10", textDecoration: "underline" }}>Link ↗</a> : <span style={{ color: "#c0b0b0" }}>—</span>}
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{typeof f.price === "number" ? `₹${f.price}` : "—"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Buyers ── */}
        {buyers && (
          <div style={{ ...GL.card, padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
              <div style={GL.sectionHeader}>
                💳 Buyers
                <span style={{ fontWeight: 400, color: "#b08080", marginLeft: 10 }}>
                  {buyers.combined?.length ?? 0} total
                </span>
              </div>
              <span style={{ fontSize: 12, color: "#9b4a42" }}>
                {buyers.generatedAt ? `Last scanned ${new Date(buyers.generatedAt).toLocaleString()}` : ""}
              </span>
            </div>
            <p style={{ fontSize: 13, color: "#7b241c", marginBottom: 20, opacity: 0.8 }}>
              Loaded from <code style={{ background: "rgba(171,31,16,0.07)", borderRadius: 5, padding: "2px 6px" }}>purchase_data.json</code>.
              Premium counted from 15 Jun 2026 onwards. Hit <strong>List Buyers</strong> to rescan and overwrite.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Bought Coins */}
              <div>
                <div
                  onClick={() => setBoughtCoinsExpanded((v) => !v)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#ab1f10", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: boughtCoinsExpanded ? 12 : 0 }}
                >
                  <span>Bought Coins — {buyers.boughtCoins?.length ?? 0}</span>
                  <span style={{ fontSize: 12 }}>{boughtCoinsExpanded ? "▲ Hide" : "▼ Show"}</span>
                </div>
                {boughtCoinsExpanded && (
                  !buyers.boughtCoins?.length ? (
                    <div style={{ fontSize: 14, color: "#9b4a42" }}>None yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr", gap: 12, padding: "0 14px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        <span>Phone</span><span>Purchases</span><span>First Buy</span>
                      </div>
                      {buyers.boughtCoins.map((u, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr", gap: 12, alignItems: "center", background: "rgba(255,255,255,0.65)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(171,31,16,0.06)" }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", fontFamily: "monospace" }}>{u.id}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#ab1f10" }}>×{u.count}</span>
                          <span style={{ fontSize: 13, color: "#9b4a42" }}>{u.firstAt ? new Date(u.firstAt).toLocaleString() : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Bought Premium */}
              <div>
                <div
                  onClick={() => setBoughtPremiumExpanded((v) => !v)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: boughtPremiumExpanded ? 12 : 0 }}
                >
                  <span>Bought Premium (≥ 15 Jun 2026) — {buyers.boughtPremium?.length ?? 0}</span>
                  <span style={{ fontSize: 12 }}>{boughtPremiumExpanded ? "▲ Hide" : "▼ Show"}</span>
                </div>
                {boughtPremiumExpanded && (
                  !buyers.boughtPremium?.length ? (
                    <div style={{ fontSize: 14, color: "#9b4a42" }}>None yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 14px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        <span>Phone</span><span>Purchased At</span>
                      </div>
                      {buyers.boughtPremium.map((u, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center", background: "rgba(255,255,255,0.65)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(171,31,16,0.06)" }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", fontFamily: "monospace" }}>{u.id}</span>
                          <span style={{ fontSize: 13, color: "#9b4a42" }}>{u.firstAt ? new Date(u.firstAt).toLocaleString() : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

            </div>
          </div>
        )}

        {/* ── Push Notifications ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div style={{ ...GL.sectionHeader, marginBottom: 18 }}>Push Notification Tokens</div>
          <p style={{ fontSize: 14, color: "#7b241c", marginBottom: 20, marginTop: -10, opacity: 0.8 }}>
            Users who have a <code style={{ background: "rgba(171,31,16,0.07)", borderRadius: 5, padding: "2px 6px", fontSize: 13 }}>push_token.json</code> file — eligible for push notifications.
            <span style={{ marginLeft: 10, fontWeight: 700, color: "#ab1f10" }}>{usersWithPushTokens.length} user{usersWithPushTokens.length !== 1 ? "s" : ""}</span>
          </p>
          {usersWithPushTokens.length === 0 ? (
            <div style={{ fontSize: 14, color: "#9b4a42" }}>No users with push tokens found.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 14, padding: "0 14px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                <span>User</span>
                <span>Token</span>
              </div>
              {usersWithPushTokens.map((u, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 14, alignItems: "center", background: "rgba(255,255,255,0.65)", borderRadius: 11, padding: "12px 16px", border: "1px solid rgba(171,31,16,0.06)" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{u.number}</span>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "#7b241c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.token || <span style={{ color: "#c0b0b0", fontStyle: "italic" }}>file exists, token not parsed</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Bottom Analytics Tabs ── */}
        <div style={{ ...GL.card, padding: 28, overflow: "visible" }}>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1.5px solid rgba(171,31,16,0.1)", marginBottom: 24, gap: 4 }}>
            {[{ id: "views", label: "Views" }, { id: "premium", label: "Premium Products" }, { id: "perfect", label: "Perfect Product Premium" }].map((tab) => (
              <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Views Tab */}
          {activeTab === "views" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              <div>
                <div style={GL.sectionHeader}>Top Viewed Brands</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {(topViewedBrands || []).length > 0
                    ? topViewedBrands.map((b, idx) => <RankRow key={idx} left={b.brand} right={b.views} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
              <div>
                <div style={GL.sectionHeader}>Top Viewed Products</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {(topViewedProducts || []).length > 0
                    ? topViewedProducts.map((row, idx) => <RankRow key={idx} left={`${row.brand} — ${row.product}`} right={row.views} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
            </div>
          )}

          {/* Premium Tab */}
          {activeTab === "premium" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={GL.sectionHeader}>Top Premium Brands (grants)</div>
                  {premiumUpdatedAt && <span style={{ fontSize: 12, color: "#9b4a42" }}>Updated {fmtDate(premiumUpdatedAt)}</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {(topPremiumBrands || []).length > 0
                    ? topPremiumBrands.map((b, idx) => <RankRow key={idx} left={b.brand} right={b.count} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
              <div>
                <div style={GL.sectionHeader}>Top Premium Products (grants)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {(topPremiumProducts || []).length > 0
                    ? topPremiumProducts.map((row, idx) => <RankRow key={idx} left={`${row.brand} — ${row.product}`} right={row.count} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
            </div>
          )}

          {/* Perfect Tab */}
          {activeTab === "perfect" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {[
                { label: "Perfect Product Premium (1-hour)", data: topPerfect5, updatedAt: perfect5UpdatedAt, key: "category" },
                { label: "Perfect Product Premium (24-hour)", data: topPerfect24, updatedAt: perfect24UpdatedAt, key: "category" },
              ].map(({ label, data, updatedAt }) => (
                <div key={label}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={GL.sectionHeader}>{label}</div>
                    {updatedAt && <span style={{ fontSize: 12, color: "#9b4a42" }}>Updated {fmtDate(updatedAt)}</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                    {(data || []).length > 0
                      ? data.map((row, idx) => <RankRow key={idx} left={row.category || "Unknown"} right={row.count} />)
                      : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}