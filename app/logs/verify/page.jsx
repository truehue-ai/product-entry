"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BRANDS_INDIA from "../../shade-capture/brands-india.json";
import BRANDS_USA from "../../shade-capture/brands-usa.json";
import { useActionPassword } from "../../components/useActionPassword";

// Verification queue: every saved product, unverified first, ordered by brand popularity.

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
    padding: "10px 13px",
    fontSize: 14,
    color: "#1a0a09",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 11,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(171,31,16,0.25)",
    whiteSpace: "nowrap",
  },
  btnOutline: {
    background: "rgba(255,255,255,0.7)",
    color: "#ab1f10",
    border: "1.5px solid rgba(171,31,16,0.3)",
    borderRadius: 11,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.03em",
    padding: "3px 9px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
  sectionHeader: { fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase" },
};
const VERIFIED = { fg: "#1d4ed8", bg: "rgba(37,99,235,0.1)", bar: "#2563eb" };
const UNVERIFIED = { fg: "#b45309", bg: "rgba(217,119,6,0.12)", bar: "#d97706" };
const LIVE = { fg: "#15803d", bg: "rgba(22,163,74,0.1)" };

const MARKETS = {
  india: { label: "India", flag: "🇮🇳", usa: false, editor: "/color-picker", brands: BRANDS_INDIA },
  usa: { label: "USA", flag: "🇺🇸", usa: true, editor: "/color-picker-usa", brands: BRANDS_USA },
};

const CATEGORIES = [
  ["matte-lipstick", "Matte Lipstick"], ["satin-lipstick", "Satin Lipstick"], ["lip-gloss", "Lip Gloss / Lip Oil"],
  ["lip-tint", "Lip Tint / Lip Stain"], ["lip-balm", "Lip Balm"], ["foundation", "Foundation"], ["concealer", "Concealer"],
  ["skin-tint", "Skin Tint"], ["contour", "Contour"], ["cream-blush", "Cream / Liquid Blush"], ["powder-blush", "Powder Blush"],
  ["cream-eyeshadow", "Cream Eyeshadow"], ["powder-eyeshadow", "Powder Eyeshadow"],
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
const CATEGORY_ORDER = Object.fromEntries(CATEGORIES.map(([k], i) => [k, i]));
const categoryLabel = (c) => CATEGORY_LABEL[c] || (c ? c.replace(/-/g, " ") : "Uncategorised");
const BASE_CATEGORIES = new Set(["foundation", "concealer", "contour", "skin-tint"]);

const normKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const itemKey = (p) => `${p.brand}:::${p.product}`;
const UNRANKED = 1e9;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyQueue />
    </Suspense>
  );
}

function VerifyQueue() {
  const router = useRouter();
  const sp = useSearchParams();
  const market = sp.get("market") === "usa" ? "usa" : "india";
  const M = MARKETS[market];

  const [data, setData] = useState({}); // market -> { products, ranking }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("");
  const [liveFilter, setLiveFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [skipped, setSkipped] = useState(() => new Set());
  const [shown, setShown] = useState({ unverified: 150, verified: 150 });
  const { runWithPassword, passwordModal } = useActionPassword();

  const load = useCallback(async (mk) => {
    setLoading(true);
    setError("");
    try {
      const [catalogRes, todoRes] = await Promise.all([
        fetch(`/api/shade-capture/catalog?usa=${MARKETS[mk].usa ? "1" : "0"}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/shade-capture/todo?market=${mk}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (catalogRes.error) setError(catalogRes.error);
      setData((prev) => ({ ...prev, [mk]: { products: catalogRes.products || [], ranking: todoRes.ranking || [] } }));
    } catch (e) {
      setError(e?.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!data[market]) load(market); }, [market, data, load]);
  useEffect(() => { setCat(""); setLiveFilter("all"); setSearch(""); setSkipped(new Set()); }, [market]);

  const brandName = useMemo(() => {
    const names = new Map((M.brands || []).map((b) => [normKey(b.slug), b.name]));
    return (brand) => names.get(normKey(brand)) || brand;
  }, [M.brands]);

  const rankOf = useMemo(() => {
    const rank = new Map((data[market]?.ranking || []).map((b, i) => [normKey(b), i + 1]));
    return (brand) => rank.get(normKey(brand)) || null;
  }, [data, market]);

  // All products, ordered: brand rank, then brand, then product
  const all = useMemo(() => {
    const list = (data[market]?.products || []).map((p) => ({ ...p, rank: rankOf(p.brand) }));
    list.sort((a, b) => (a.rank ?? UNRANKED) - (b.rank ?? UNRANKED) || a.brand.localeCompare(b.brand) || a.product.localeCompare(b.product));
    return list;
  }, [data, market, rankOf]);

  const cats = useMemo(() => {
    const counts = {};
    all.forEach((p) => { if (!p.verified) counts[p.type || ""] = (counts[p.type || ""] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => (CATEGORY_ORDER[a[0]] ?? 99) - (CATEGORY_ORDER[b[0]] ?? 99) || a[0].localeCompare(b[0]));
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((p) =>
      (!cat || (p.type || "") === cat) &&
      (liveFilter === "all" || (liveFilter === "live" ? p.live : !p.live)) &&
      (!q || p.brand.toLowerCase().includes(q) || p.product.toLowerCase().includes(q) || brandName(p.brand).toLowerCase().includes(q))
    );
  }, [all, cat, liveFilter, search, brandName]);

  const unverified = filtered.filter((p) => !p.verified);
  const verified = filtered.filter((p) => p.verified);
  const queue = unverified.filter((p) => !skipped.has(itemKey(p)));
  const next = queue[0] || null;
  const totalUnverified = all.filter((p) => !p.verified).length;
  const totalVerified = all.length - totalUnverified;

  const setVerified = async (p, value) => {
    const r = await runWithPassword((password) => fetch("/api/shade-capture/verified", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market, brand: p.brand, product: p.product, verified: value, password }),
    }));
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || "Could not update");
    setData((prev) => ({
      ...prev,
      [market]: { ...prev[market], products: prev[market].products.map((x) => (itemKey(x) === itemKey(p) ? { ...x, verified: value } : x)) },
    }));
  };

  const openEditor = (p) => {
    const params = new URLSearchParams({ brand: p.brand, product: p.product });
    window.open(`${M.editor}?${params.toString()}`, "_blank");
  };

  const setParams = (mk) => router.replace(`/logs/verify${mk === "usa" ? "?market=usa" : ""}`, { scroll: false });
  const loaded = !!data[market];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-primary:hover { opacity: 0.88; }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .th-btn-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .cat-chips { display: flex; gap: 6px; overflow-x: auto; padding: 2px 2px 6px; }
        .cat-chip { border: 1.5px solid rgba(171,31,16,0.14); background: rgba(255,255,255,0.7); color: #7b241c; border-radius: 999px;
          padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; }
        .cat-chip:hover { border-color: #ab1f10; }
        .cat-chip.active { background: #ab1f10; border-color: #ab1f10; color: #fff; }
        .cat-chip .n { font-weight: 500; opacity: 0.7; font-size: 12px; }
        .v-row { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 9px 14px; border-top: 1px solid rgba(171,31,16,0.05); }
        .v-row:hover { background: rgba(255,255,255,0.55); }
        .stats-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .swatch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
        @keyframes vIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .v-hero { animation: vIn 0.25s ease both; }
        @media (max-width: 720px) {
          .stats-grid { grid-template-columns: 1fr; }
          .v-row { grid-template-columns: 40px minmax(0, 1fr) auto; }
          .v-row .meta { display: none; }
        }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
      `}</style>

      {/* Top nav */}
      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 40,
        boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <NavBtn onClick={() => router.push(`/logs${market === "usa" ? "?market=usa" : ""}`)} strong>← Product Logs</NavBtn>
          <NavBtn onClick={() => router.push(`/shade-capture${market === "usa" ? "?market=usa" : ""}`)}>Shade Capture</NavBtn>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Verify shades</span>
        <Segmented value={market} onChange={setParams} options={Object.entries(MARKETS).map(([k, m]) => [k, `${m.flag} ${m.label}`])} />
      </div>

      {passwordModal}
      <div className="m-pad" style={{ padding: "24px 28px", maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Progress */}
        <div className="stats-grid">
          <Stat label="To verify" value={loaded ? totalUnverified : "—"} color={UNVERIFIED.fg} sub="saved products not checked yet" />
          <Stat label="Verified" value={loaded ? totalVerified : "—"} color={VERIFIED.fg} sub="checked and correct" />
          <div style={{ ...GL.card, padding: "18px 20px" }}>
            <div style={GL.sectionHeader}>{M.flag} {M.label} verified</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#1a0a09", margin: "6px 0 10px" }}>
              {loaded && all.length ? `${Math.round((totalVerified / all.length) * 100)}%` : "—"}
            </div>
            <div style={{ height: 8, borderRadius: 8, background: UNVERIFIED.bg, overflow: "hidden" }}>
              <div style={{ width: `${all.length ? (totalVerified / all.length) * 100 : 0}%`, height: "100%", background: VERIFIED.bar }} />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ ...GL.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {loaded && (
            <div className="cat-chips">
              <button className={`cat-chip ${!cat ? "active" : ""}`} onClick={() => setCat("")}>All <span className="n">{totalUnverified}</span></button>
              {cats.map(([c, n]) => (
                <button key={c || "none"} className={`cat-chip ${cat === c ? "active" : ""}`} onClick={() => setCat(c)}>
                  {categoryLabel(c)} <span className="n">{n}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input className="th-input" style={{ ...GL.input, flex: "1 1 220px", width: "auto" }} placeholder="Search brand or product…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <Segmented value={liveFilter} onChange={setLiveFilter} options={[["all", "All"], ["live", "Live"], ["notlive", "Not live"]]} />
            {skipped.size > 0 && (
              <button className="th-btn-ghost" onClick={() => setSkipped(new Set())}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "8px 10px", borderRadius: 8 }}>
                Un-skip {skipped.size}
              </button>
            )}
            <button className="th-btn-ghost" onClick={() => load(market)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "8px 10px", borderRadius: 8 }}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}

        {/* Up next */}
        {!loaded ? (
          <div style={{ ...GL.card, padding: 32, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>{loading ? "Loading products…" : ""}</div>
        ) : next ? (
          <UpNextVerify
            key={itemKey(next)}
            p={next}
            market={market}
            usa={M.usa}
            brandName={brandName}
            queueLeft={queue.length}
            later={queue.slice(1, 5)}
            onVerify={() => setVerified(next, true)}
            onSkip={() => setSkipped((prev) => new Set(prev).add(itemKey(next)))}
            onEdit={() => openEditor(next)}
          />
        ) : (
          <div style={{ ...GL.card, padding: "28px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>🎉</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a0a09" }}>
              {unverified.length ? "You've skipped the rest of this list" : "Nothing left to verify here"}
            </div>
            <div style={{ fontSize: 13, color: "#9b4a42", marginTop: 4 }}>
              {cat || liveFilter !== "all" || search ? "Change the filters to see more." : "Every saved product is verified."}
            </div>
          </div>
        )}

        {/* Lists */}
        {loaded && (
          <>
            <ListSection title="Unverified" tone={UNVERIFIED} items={unverified} limit={shown.unverified}
              onMore={() => setShown((s) => ({ ...s, unverified: s.unverified + 300 }))}
              brandName={brandName} onToggle={setVerified} onEdit={openEditor} skipped={skipped} />
            <ListSection title="Verified" tone={VERIFIED} items={verified} limit={shown.verified}
              onMore={() => setShown((s) => ({ ...s, verified: s.verified + 300 }))}
              brandName={brandName} onToggle={setVerified} onEdit={openEditor} skipped={skipped} />
          </>
        )}
      </div>
    </div>
  );
}

// The product to check now: its saved shades, plus verify / skip / edit
function UpNextVerify({ p, usa, brandName, queueLeft, later, onVerify, onSkip, onEdit }) {
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    setDetails(null);
    fetch(`/api/logs/get?brand=${encodeURIComponent(p.brand)}&product=${encodeURIComponent(p.product)}&usa=${usa ? "1" : "0"}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (active) setDetails(j); })
      .catch(() => { if (active) setDetails({ shades: [] }); });
    return () => { active = false; };
  }, [p.brand, p.product, usa]);

  const verify = async () => {
    setBusy(true); setErr("");
    try { await onVerify(); } catch (e) { setErr(e?.message || "Could not update"); setBusy(false); }
  };

  const shades = details?.shades || [];
  const isBase = BASE_CATEGORIES.has(p.type);
  const withLinks = shades.filter((s) => s.link).length;
  const withPrice = shades.filter((s) => s.price !== "" && s.price != null).length;

  return (
    <div style={{ ...GL.card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: "#1a0a09", letterSpacing: "-0.3px" }}>Up next</span>
        <span style={{ fontSize: 13, color: "#9b4a42" }}>{queueLeft} to verify with these filters</span>
      </div>

      <div className="v-hero" style={{
        position: "relative", overflow: "hidden", borderRadius: 16, padding: "20px 22px 18px",
        background: "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(239,246,255,0.92) 100%)",
        border: "1.5px solid rgba(37,99,235,0.18)", boxShadow: "0 8px 28px rgba(37,99,235,0.08)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ position: "absolute", inset: "0 auto 0 0", width: 5, background: "linear-gradient(180deg, #3b82f6, #1d4ed8)" }} />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {p.rank && <span style={{ ...GL.pill, background: "#ab1f10", color: "#fff" }}>#{p.rank} brand</span>}
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7b241c" }}>{brandName(p.brand)}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1a0a09", letterSpacing: "-0.4px", marginTop: 6, wordBreak: "break-word" }}>
              {p.product.replace(/-/g, " ")}
            </div>
            <div style={{ fontSize: 12, fontFamily: "monospace", color: "#b08080", marginTop: 3, wordBreak: "break-all" }}>{p.brand}/{p.product}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ ...GL.pill, background: "rgba(171,31,16,0.08)", color: "#ab1f10" }}>{categoryLabel(p.type)}</span>
              <span style={{ ...GL.pill, background: p.live ? LIVE.bg : "rgba(0,0,0,0.05)", color: p.live ? LIVE.fg : "#8a7a7a" }}>{p.live ? "Live" : "Not live"}</span>
              {details && <span style={{ ...GL.pill, background: "rgba(171,31,16,0.06)", color: "#7b241c" }}>{shades.length} shades</span>}
              {details && shades.length > 0 && <Completeness have={withLinks} n={shades.length} label="links" />}
              {details && shades.length > 0 && <Completeness have={withPrice} n={shades.length} label="prices" />}
              {p.updatedAt && <span style={{ fontSize: 12, color: "#9b4a42", alignSelf: "center" }}>saved {fmtDate(p.updatedAt)}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="th-btn-primary" onClick={verify} disabled={busy}
              style={{ ...GL.btnPrimary, background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)", boxShadow: "0 4px 16px rgba(37,99,235,0.25)", padding: "12px 22px", fontSize: 15, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Saving…" : "✓ Mark verified"}
            </button>
            <button className="th-btn-outline" style={GL.btnOutline} onClick={onEdit}>Edit shades ↗</button>
            <button className="th-btn-outline" style={GL.btnOutline} onClick={onSkip}>Skip</button>
          </div>
        </div>
        {err && <div style={{ fontSize: 13, color: "#c0392b", fontWeight: 600 }}>{err}</div>}

        {!details && <div style={{ fontSize: 13, color: "#9b4a42" }}>Loading shades…</div>}
        {details && shades.length === 0 && <div style={{ fontSize: 13, color: "#9b4a42" }}>No shades found for this product.</div>}
        {details && shades.length > 0 && (
          <div className="swatch-grid" style={{ maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
            {shades.map((s, i) => (
              <div key={i} title={s.link || undefined} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                background: "rgba(255,255,255,0.75)", border: "1px solid rgba(171,31,16,0.07)", borderRadius: 10,
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: s.hex, flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a0a09", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: "#9b4a42" }}>
                    {s.hex}{isBase && s.skintone ? ` · ${s.skintone}${s.undertone ? `/${s.undertone}` : ""}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {later.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13, color: "#9b4a42" }}>
          <span style={{ fontWeight: 600 }}>Then:</span>
          {later.map((x) => (
            <span key={itemKey(x)} style={{ ...GL.pill, fontWeight: 600, background: "rgba(255,255,255,0.7)", color: "#7b241c", border: "1px solid rgba(171,31,16,0.1)" }}>
              {brandName(x.brand)} · {x.product.replace(/-/g, " ")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ListSection({ title, tone, items, limit, onMore, brandName, onToggle, onEdit, skipped }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ ...GL.card, overflow: "hidden" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <span style={{ color: "#ab1f10", fontSize: 12, display: "inline-block", width: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: "#1a0a09" }}>{title}</span>
        <span style={{ ...GL.pill, background: tone.bg, color: tone.fg }}>{items.length}</span>
        <span style={{ fontSize: 12, color: "#b08080" }}>sorted by brand popularity</span>
      </div>
      {open && (
        <div>
          {items.length === 0 && <div style={{ padding: "18px", fontSize: 13, color: "#9b4a42", borderTop: "1px solid rgba(171,31,16,0.05)" }}>Nothing here with these filters.</div>}
          {items.slice(0, limit).map((p) => (
            <Row key={itemKey(p)} p={p} tone={tone} brandName={brandName} onToggle={onToggle} onEdit={onEdit} skipped={skipped.has(itemKey(p))} />
          ))}
          {items.length > limit && (
            <button className="th-btn-ghost" onClick={onMore}
              style={{ width: "100%", background: "none", border: "none", borderTop: "1px solid rgba(171,31,16,0.05)", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "12px" }}>
              Show more ({items.length - limit} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ p, tone, brandName, onToggle, onEdit, skipped }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toggle = async () => {
    setBusy(true); setErr("");
    try { await onToggle(p, !p.verified); } catch (e) { setErr(e?.message || "Could not update"); } finally { setBusy(false); }
  };
  return (
    <div className="v-row">
      <span style={{ fontSize: 12, fontWeight: 700, color: p.rank ? "#ab1f10" : "#c0b0b0", textAlign: "center" }}>{p.rank ? `#${p.rank}` : "—"}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.product}{skipped && <span style={{ ...GL.pill, marginLeft: 6, background: "rgba(0,0,0,0.05)", color: "#8a7a7a" }}>skipped</span>}
        </div>
        <div style={{ fontSize: 12, color: "#9b4a42", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {brandName(p.brand)} · {categoryLabel(p.type)}
        </div>
      </div>
      <div className="meta" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ ...GL.pill, background: p.live ? LIVE.bg : "rgba(0,0,0,0.05)", color: p.live ? LIVE.fg : "#8a7a7a" }}>{p.live ? "Live" : "Not live"}</span>
        <button onClick={() => onEdit(p)} className="th-btn-ghost"
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ab1f10", padding: "6px 8px", borderRadius: 8 }}>Edit ↗</button>
      </div>
      <button onClick={toggle} disabled={busy} title={err || undefined}
        style={{
          border: `1.5px solid ${err ? "#c0392b" : p.verified ? "rgba(37,99,235,0.45)" : "rgba(217,119,6,0.45)"}`,
          background: p.verified ? VERIFIED.bg : "rgba(255,255,255,0.75)", color: err ? "#c0392b" : p.verified ? VERIFIED.fg : UNVERIFIED.fg,
          borderRadius: 10, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1,
        }}>
        {busy ? "Saving…" : err ? "Retry" : p.verified ? "✓ Verified" : "Mark verified"}
      </button>
    </div>
  );
}

function Completeness({ have, n, label }) {
  const full = have === n, none = have === 0;
  return (
    <span style={{ ...GL.pill, background: full ? "rgba(22,163,74,0.1)" : none ? "rgba(0,0,0,0.05)" : "rgba(217,119,6,0.12)", color: full ? "#15803d" : none ? "#9a8a8a" : "#b45309" }}>
      {full ? "✓" : none ? "—" : "◐"} {label} {have}/{n}
    </span>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ ...GL.card, padding: "18px 20px" }}>
      <div style={GL.sectionHeader}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color, margin: "6px 0 2px" }}>{value}</div>
      <div style={{ fontSize: 13, color: "#9b4a42" }}>{sub}</div>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 11, padding: 3, gap: 3 }}>
      {options.map(([k, label]) => {
        const active = k === value;
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            border: "none", cursor: "pointer", borderRadius: 8, padding: "7px 13px", fontSize: 13, fontWeight: 600,
            background: active ? "#fff" : "transparent", color: active ? "#ab1f10" : "#9b4a42",
            boxShadow: active ? "0 2px 8px rgba(171,31,16,0.15)" : "none", whiteSpace: "nowrap",
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function NavBtn({ children, onClick, strong }) {
  return (
    <button className="th-btn-ghost" onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: strong ? "#ab1f10" : "#7b241c", padding: "8px 12px", borderRadius: 9 }}>
      {children}
    </button>
  );
}
