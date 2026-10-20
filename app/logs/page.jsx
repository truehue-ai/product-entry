"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionPassword } from "../components/useActionPassword";

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
    padding: "11px 14px",
    fontSize: 14,
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
    fontFamily: "'Inter', sans-serif",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 11,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(171,31,16,0.25)",
    transition: "opacity 0.15s, transform 0.15s",
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
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    whiteSpace: "nowrap",
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 700,
    color: "#7b241c",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    padding: "3px 9px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
};

const MARKETS = {
  india: { label: "India", flag: "🇮🇳", usa: false, editor: "/color-picker", currency: "₹" },
  usa: { label: "USA", flag: "🇺🇸", usa: true, editor: "/color-picker-usa", currency: "₹" },
};

const BASE_CATEGORIES = ["foundation", "concealer", "contour", "skin-tint"];

// "M.A.C", "mac", "Lakmé" -> "mac", "lakme" — used to spot spelling variants
const normKey = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Generic words that make different brands look alike ("huda-beauty" vs "rufa-beauty")
const GENERIC_BRAND_WORDS = new Set(["beauty", "beaute", "cosmetics", "cosmetic", "makeup"]);
const brandCore = (s) => {
  const words = String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const core = words.filter((w) => !GENERIC_BRAND_WORDS.has(w));
  return (core.length ? core : words).join("");
};

const prettyType = (t) => (t ? t.replace(/-/g, " ") : "untyped");

function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// One entry per exact S3 brand folder — spelling variants stay separate so they can be spotted and fixed.
function groupBrands(items) {
  const map = new Map();
  for (const it of items) {
    if (!it.brand) continue;
    if (!map.has(it.brand)) map.set(it.brand, { key: it.brand, display: it.brand, norm: normKey(it.brand), core: brandCore(it.brand), products: [], similar: [] });
    map.get(it.brand).products.push(it);
  }
  const groups = [...map.values()];
  groups.forEach((g) => g.products.sort((a, b) => a.product.localeCompare(b.product)));
  groups.sort((a, b) => a.display.trim().localeCompare(b.display.trim(), undefined, { sensitivity: "base" }) || a.display.localeCompare(b.display));

  // Flag likely misspellings: same letters ignoring case/spaces/punctuation/accents ("MAC" vs "M.A.C"),
  // or a small typo in the distinctive part of the name ("earth-rythm" vs "earth-rhythm")
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i].core, b = groups[j].core;
      const len = Math.min(a.length, b.length);
      const limit = len >= 8 ? 2 : len >= 5 ? 1 : 0;
      if (groups[i].norm === groups[j].norm || a === b || (limit && levenshtein(a, b) <= limit)) {
        groups[i].similar.push(groups[j].key);
        groups[j].similar.push(groups[i].key);
      }
    }
  }
  return groups;
}

export default function LogsPage() {
  return (
    <Suspense fallback={null}>
      <LogsInner />
    </Suspense>
  );
}

function LogsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const market = sp.get("market") === "usa" ? "usa" : "india";
  const brandKey = sp.get("brand") || "";
  const M = MARKETS[market];

  const [currentUser, setCurrentUser] = useState("");
  const [itemsByMarket, setItemsByMarket] = useState({});
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");
  const [brandSearch, setBrandSearch] = useState("");

  const [products, setProducts] = useState(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productFilter, setProductFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [view, setView] = useState("swatches");
  const [reloadTick, setReloadTick] = useState(0);
  const productCache = useRef({});
  const [verifiedByMarket, setVerifiedByMarket] = useState({});
  const [liveByMarket, setLiveByMarket] = useState({});
  const { runWithPassword, passwordModal } = useActionPassword();

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_user=([^;]+)/);
    if (m) setCurrentUser(decodeURIComponent(m[1]));
  }, []);

  const setParams = useCallback((next) => {
    const params = new URLSearchParams();
    const mk = next.market ?? market;
    if (mk === "usa") params.set("market", "usa");
    const b = "brand" in next ? next.brand : brandKey;
    if (b) params.set("brand", b);
    const qs = params.toString();
    router.replace(`/logs${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, market, brandKey]);

  const loadList = useCallback(async (mk, refresh = false) => {
    setLoadingList(true);
    setListError("");
    try {
      const r = await fetch(`/api/logs/list?usa=${MARKETS[mk].usa ? "1" : "0"}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) setListError(j.error);
      setItemsByMarket((prev) => ({ ...prev, [mk]: j.items || [] }));
    } catch (e) {
      setListError(e?.message || "Failed to load brands");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (!itemsByMarket[market]) loadList(market);
  }, [market, itemsByMarket, loadList]);

  const groups = useMemo(() => groupBrands(itemsByMarket[market] || []), [itemsByMarket, market]);
  const groupByKey = useMemo(() => Object.fromEntries(groups.map((g) => [g.key, g])), [groups]);
  const selectedGroup = groupByKey[brandKey] || null;
  const totalProducts = (itemsByMarket[market] || []).length;

  const visibleGroups = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return groups.map((g) => ({ g, productHits: 0 }));
    return groups
      .map((g) => ({
        g,
        brandHit: g.display.toLowerCase().includes(q),
        productHits: g.products.filter((p) => p.product.toLowerCase().includes(q)).length,
      }))
      .filter((x) => x.brandHit || x.productHits > 0);
  }, [groups, brandSearch]);

  // Load all products (with shades) for the selected brand
  useEffect(() => {
    if (!selectedGroup) { setProducts(null); return; }
    const cacheKey = `${market}:${selectedGroup.key}`;
    if (productCache.current[cacheKey]) { setProducts(productCache.current[cacheKey]); return; }
    let active = true;
    setProducts(null);
    setLoadingProducts(true);
    (async () => {
      try {
        const r = await fetch("/api/logs/brand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usa: M.usa, items: selectedGroup.products }),
          cache: "no-store",
        });
        const j = await r.json();
        const list = j.products || [];
        productCache.current[cacheKey] = list;
        if (active) setProducts(list);
      } catch {
        if (active) setProducts([]);
      } finally {
        if (active) setLoadingProducts(false);
      }
    })();
    return () => { active = false; };
  }, [selectedGroup, market, M.usa, reloadTick]);

  useEffect(() => { setProductFilter(""); setTypeFilter(""); }, [brandKey, market]);

  const refreshAll = () => {
    productCache.current = {};
    setProducts(null);
    loadList(market, true);
  };

  const reloadBrand = () => {
    if (!selectedGroup) return;
    delete productCache.current[`${market}:${selectedGroup.key}`];
    setReloadTick((t) => t + 1);
  };

  // Verified list for this market: { brand: { product: { by, at } } }
  useEffect(() => {
    if (verifiedByMarket[market]) return;
    let active = true;
    fetch(`/api/shade-capture/verified?market=${market}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!active || !j.verified) return;
        setVerifiedByMarket((prev) => ({ ...prev, [market]: j.verified }));
        setLiveByMarket((prev) => ({ ...prev, [market]: j.live || {} }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [market, verifiedByMarket]);

  const toggleVerified = async (p, verified) => {
    const r = await runWithPassword((password) => fetch("/api/shade-capture/verified", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market, brand: p.brand, product: p.product, verified, password }),
    }));
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || "Could not update");
    setVerifiedByMarket((prev) => {
      const map = { ...(prev[market] || {}) };
      const forBrand = { ...(map[p.brand] || {}) };
      if (verified) forBrand[p.product] = j.entry; else delete forBrand[p.product];
      map[p.brand] = forBrand;
      return { ...prev, [market]: map };
    });
  };

  const openEditor = (p) => {
    window.open(`${M.editor}?brand=${encodeURIComponent(p.brand)}&product=${encodeURIComponent(p.product)}&from=logs`, "_blank");
  };

  const typeOptions = useMemo(() => {
    const s = new Set((products || []).map((p) => p.productType || ""));
    return [...s].sort();
  }, [products]);

  const productDupes = useMemo(() => {
    const counts = {};
    (products || []).forEach((p) => { const k = normKey(p.product); counts[k] = (counts[k] || 0) + 1; });
    return counts;
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    return (products || []).filter((p) =>
      (!q || p.product.toLowerCase().includes(q) || p.shades.some((s) => String(s.name).toLowerCase().includes(q))) &&
      (!typeFilter || (p.productType || "") === typeFilter)
    );
  }, [products, productFilter, typeFilter]);

  const brandShadeCount = (products || []).reduce((a, p) => a + p.shades.length, 0);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)",
      fontFamily: "'Inter', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .th-btn-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .brand-item:hover { background: rgba(171,31,16,0.04) !important; }
        .brand-item.selected { background: rgba(171,31,16,0.09) !important; border-left-color: #ab1f10 !important; }
        .shade-row:hover { background: rgba(171,31,16,0.03); }
        .swatch-tile:hover { border-color: rgba(171,31,16,0.25) !important; }
        .logs-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; align-items: start; }
        .brand-sidebar { position: sticky; top: 86px; }
        .swatch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
        .table-scroll { overflow-x: auto; }
        @media (max-width: 900px) {
          .logs-layout { grid-template-columns: 1fr; }
          .brand-sidebar { position: static; }
          .brand-list { max-height: 260px !important; }
        }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
      `}</style>

      {/* ── Top Nav ── */}
      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)",
        padding: "14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        position: "sticky", top: 0, zIndex: 40,
        boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <NavBtn onClick={() => router.push("/")} strong>← Home</NavBtn>
          <NavBtn onClick={() => router.push(`/shade-capture${market === "usa" ? "?market=usa" : ""}`)}>Shade Capture {M.flag}</NavBtn>
          <button className="th-btn-primary" onClick={() => router.push(`/logs/verify${market === "usa" ? "?market=usa" : ""}`)}
            style={{ ...GL.btnPrimary, padding: "8px 14px", fontSize: 13, background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)", boxShadow: "0 4px 14px rgba(37,99,235,0.25)" }}>
            ✓ Verify shades
          </button>
          {currentUser === "dhruvi" && (
            <>
              <NavBtn onClick={() => router.push("/audit")}>Audit</NavBtn>
              <NavBtn onClick={() => router.push("/analytics")}>Analytics</NavBtn>
            </>
          )}
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Product Logs</span>

        {/* Market switch */}
        <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 12, padding: 4, gap: 4 }}>
          {Object.entries(MARKETS).map(([k, m]) => {
            const active = k === market;
            const count = itemsByMarket[k]?.length;
            return (
              <button
                key={k}
                onClick={() => { if (!active) { setBrandSearch(""); setParams({ market: k, brand: "" }); } }}
                style={{
                  border: "none", cursor: "pointer", borderRadius: 9, padding: "8px 16px",
                  fontSize: 14, fontWeight: 700,
                  background: active ? "#fff" : "transparent",
                  color: active ? "#ab1f10" : "#9b4a42",
                  boxShadow: active ? "0 2px 8px rgba(171,31,16,0.15)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {m.flag} {m.label}
                {count != null && <span style={{ fontWeight: 500, opacity: 0.6, marginLeft: 6 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="m-pad" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20 }}>

        {passwordModal}
        {currentUser === "dhruvi" && <BuildDatabasePanel />}

        <div className="logs-layout">

          {/* ── Left: brands ── */}
          <aside className="brand-sidebar" style={{ ...GL.card, overflow: "hidden" }}>
            <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(171,31,16,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={GL.sectionHeader}>
                  {M.flag} Brands <span style={{ fontWeight: 400, color: "#b08080", marginLeft: 4 }}>({groups.length})</span>
                </div>
                <button
                  className="th-btn-ghost"
                  onClick={refreshAll}
                  title="Reload from S3"
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ab1f10", padding: "4px 8px", borderRadius: 7 }}
                >
                  {loadingList ? "Loading…" : "↻ Refresh"}
                </button>
              </div>
              <input
                className="th-input"
                style={GL.input}
                placeholder="Search brand or product…"
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
              />
            </div>
            <div className="brand-list" style={{ maxHeight: "calc(100vh - 230px)", overflowY: "auto" }}>
              {listError && (
                <div style={{ padding: "16px", fontSize: 13, color: "#c0392b" }}>{listError}</div>
              )}
              {!loadingList && visibleGroups.length === 0 && (
                <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 14, color: "#9b4a42" }}>No brands found.</div>
              )}
              {visibleGroups.map(({ g, productHits }) => {
                const isSel = g.key === brandKey;
                const flagged = g.similar.length > 0 || g.key !== g.key.trim();
                return (
                  <div
                    key={g.key}
                    className={`brand-item ${isSel ? "selected" : ""}`}
                    onClick={() => setParams({ brand: g.key })}
                    style={{
                      padding: "11px 16px",
                      cursor: "pointer",
                      borderLeft: "4px solid transparent",
                      borderBottom: "1px solid rgba(171,31,16,0.05)",
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <BrandName name={g.display} />
                        {flagged && <span title="Possible misspelling — similar brand names exist" style={{ marginLeft: 6, color: "#d97706" }}>⚠</span>}
                      </div>
                      {brandSearch && productHits > 0 && (
                        <div style={{ fontSize: 12, color: "#9b4a42" }}>{productHits} matching product{productHits > 1 ? "s" : ""}</div>
                      )}
                    </div>
                    <span style={{ ...GL.pill, background: "rgba(171,31,16,0.08)", color: "#7b241c" }}>{g.products.length}</span>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ── Right: brand detail ── */}
          <main style={{ minWidth: 0 }}>
            {!selectedGroup && (
              <div style={{ ...GL.card, padding: 48, textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 10 }}>{M.flag}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1a0a09", marginBottom: 6 }}>{M.label} catalogue</div>
                <div style={{ fontSize: 14, color: "#9b4a42" }}>
                  {loadingList && !itemsByMarket[market]
                    ? "Loading brands…"
                    : `${groups.length} brands · ${totalProducts} products — pick a brand to see its products and shades.`}
                </div>
              </div>
            )}

            {selectedGroup && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Brand header */}
                <div style={{ ...GL.card, padding: "22px 24px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                        {M.flag} {M.label}
                      </div>
                      <div style={{ fontSize: 26, fontWeight: 700, color: "#1a0a09", letterSpacing: "-0.4px" }}><BrandName name={selectedGroup.display} /></div>
                      <div style={{ fontSize: 14, color: "#7b241c", marginTop: 4 }}>
                        {selectedGroup.products.length} product{selectedGroup.products.length === 1 ? "" : "s"}
                        {products && ` · ${brandShadeCount} shades`}
                      </div>
                    </div>
                    <button className="th-btn-outline" style={GL.btnOutline} onClick={reloadBrand}>↻ Reload brand</button>
                  </div>

                  {selectedGroup.key !== selectedGroup.key.trim() && (
                    <Notice>This brand name has an extra space at the {selectedGroup.key.startsWith(" ") ? "start" : "end"} (shown as ␣).</Notice>
                  )}
                  {selectedGroup.similar.length > 0 && (
                    <Notice>
                      Possible misspelling — {selectedGroup.similar.length > 1 ? "these brands look" : "this brand looks"} like the same name:{" "}
                      {selectedGroup.similar.map((k, i) => groupByKey[k] && (
                        <span key={k}>
                          {i > 0 && ", "}
                          <a onClick={() => setParams({ brand: k })} style={{ color: "#ab1f10", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                            <BrandName name={groupByKey[k].display} />
                          </a> ({groupByKey[k].products.length})
                        </span>
                      ))}
                    </Notice>
                  )}
                </div>

                {/* Toolbar */}
                <div style={{ ...GL.card, padding: "12px 14px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    className="th-input"
                    style={{ ...GL.input, flex: "1 1 220px", width: "auto" }}
                    placeholder="Filter products or shades…"
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                  />
                  <select
                    className="th-input"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    style={{ ...GL.input, width: "auto", flex: "0 0 auto", cursor: "pointer", textTransform: "capitalize" }}
                  >
                    <option value="">All types</option>
                    {typeOptions.map((t) => <option key={t} value={t}>{prettyType(t)}</option>)}
                  </select>
                  <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 10, padding: 3, gap: 3 }}>
                    {[["swatches", "Swatches"], ["table", "Table"]].map(([k, label]) => (
                      <button key={k} onClick={() => setView(k)} style={{
                        border: "none", cursor: "pointer", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600,
                        background: view === k ? "#fff" : "transparent", color: view === k ? "#ab1f10" : "#9b4a42",
                      }}>{label}</button>
                    ))}
                  </div>
                </div>

                {loadingProducts && (
                  <div style={{ ...GL.card, padding: 32, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>
                    Loading {selectedGroup.products.length} products…
                  </div>
                )}

                {products && visibleProducts.length === 0 && (
                  <div style={{ ...GL.card, padding: 32, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>No products match.</div>
                )}

                {products && visibleProducts.map((p) => (
                  <ProductCard
                    key={`${p.brand}:::${p.product}`}
                    p={p}
                    view={view}
                    currency={M.currency}
                    isDupe={productDupes[normKey(p.product)] > 1}
                    shadeFilter={productFilter.trim().toLowerCase()}
                    onEdit={() => openEditor(p)}
                    verifiedEntry={verifiedByMarket[market]?.[p.brand]?.[p.product] || null}
                    verifiedLoaded={!!verifiedByMarket[market]}
                    live={liveByMarket[market] ? !!(liveByMarket[market][p.brand]?.[p.product] ?? liveByMarket[market][p.brand.trim()]?.[p.product]) : null}
                    onToggleVerified={(v) => toggleVerified(p, v)}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}


// Shows leading/trailing spaces as a visible ␣ so stray-space duplicates are obvious
function BrandName({ name }) {
  const lead = name.length - name.trimStart().length;
  const trail = name.length - name.trimEnd().length;
  const mark = (n) => n > 0 && <span style={{ color: "#d97706", fontWeight: 700 }}>{"␣".repeat(n)}</span>;
  return <>{mark(lead)}{name.trim()}{mark(trail)}</>;
}

function NavBtn({ children, onClick, strong }) {
  return (
    <button className="th-btn-ghost" onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: strong ? "#ab1f10" : "#7b241c", padding: "8px 12px", borderRadius: 9 }}>
      {children}
    </button>
  );
}

function Notice({ children }) {
  return (
    <div style={{
      marginTop: 14, fontSize: 13, lineHeight: 1.5, color: "#92400e",
      background: "rgba(251,191,36,0.12)", border: "1px solid rgba(217,119,6,0.25)",
      borderRadius: 10, padding: "10px 14px",
    }}>
      ⚠ {children}
    </div>
  );
}

function ProductCard({ p, view, currency, isDupe, shadeFilter, onEdit, verifiedEntry, verifiedLoaded, onToggleVerified, live }) {
  const n = p.shades.length;
  const withLinks = p.shades.filter((s) => s.link).length;
  const withPrice = p.shades.filter((s) => s.price !== "" && s.price != null).length;
  const isBase = BASE_CATEGORIES.includes(p.productType);
  const productMatches = !shadeFilter || p.product.toLowerCase().includes(shadeFilter);
  const shades = productMatches ? p.shades : p.shades.filter((s) => String(s.name).toLowerCase().includes(shadeFilter));

  const stat = (have, label) => {
    const full = n > 0 && have === n;
    const none = have === 0;
    return (
      <span style={{ ...GL.pill, background: full ? "rgba(22,163,74,0.1)" : none ? "rgba(0,0,0,0.05)" : "rgba(217,119,6,0.12)", color: full ? "#15803d" : none ? "#9a8a8a" : "#b45309" }}>
        {full ? "✓" : none ? "—" : "◐"} {label} {have}/{n}
      </span>
    );
  };

  return (
    <div style={{ ...GL.card, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: n ? 14 : 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#1a0a09" }}>{p.product}</span>
            <span style={{ ...GL.pill, background: "rgba(171,31,16,0.08)", color: "#ab1f10", textTransform: "capitalize" }}>{prettyType(p.productType)}</span>
            {isDupe && <span style={{ ...GL.pill, background: "rgba(251,191,36,0.18)", color: "#92400e" }}>⚠ possible duplicate</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <span style={{ ...GL.pill, background: "rgba(171,31,16,0.06)", color: "#7b241c" }}>{n} shade{n === 1 ? "" : "s"}</span>
            {stat(withLinks, "links")}
            {stat(withPrice, "prices")}
          </div>
          <div style={{ fontSize: 12, color: "#9b4a42", marginTop: 8 }}>
            {p.meta?.lastSavedBy
              ? <>Saved by <b>{p.meta.lastSavedBy}</b>{p.meta.lastSavedAt ? ` · ${new Date(p.meta.lastSavedAt).toLocaleString()}` : ""}</>
              : "No save history"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {live !== null && (
            <span
              title={live ? "In the app catalogue (all-data)" : "Saved, but not made live yet"}
              style={{ ...GL.pill, fontSize: 12, padding: "6px 11px",
                background: live ? "rgba(22,163,74,0.1)" : "rgba(0,0,0,0.05)", color: live ? "#15803d" : "#8a7a7a" }}
            >
              {live ? "● Live" : "○ Not live"}
            </span>
          )}
          {verifiedLoaded && <VerifiedToggle entry={verifiedEntry} onToggle={onToggleVerified} />}
          <button className="th-btn-primary" style={GL.btnPrimary} onClick={onEdit}>Edit shades →</button>
        </div>
      </div>

      {p.error && <div style={{ fontSize: 13, color: "#c0392b" }}>Failed to load: {p.error}</div>}
      {!p.error && n === 0 && <div style={{ fontSize: 13, color: "#9b4a42" }}>No shades saved.</div>}

      {n > 0 && view === "swatches" && (
        <div className="swatch-grid">
          {shades.map((s, i) => (
            <div key={i} className="swatch-tile" title={s.link || undefined} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              background: "rgba(255,255,255,0.65)", border: "1px solid rgba(171,31,16,0.07)", borderRadius: 10,
            }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: s.hex, flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }} />
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

      {n > 0 && view === "table" && (
        <div className="table-scroll">
          <div style={{ minWidth: 620, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 90px 100px 1fr 80px", gap: 12, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <span>Name</span><span></span><span>Hex</span><span>Tone / UT</span><span>Link</span><span style={{ textAlign: "right" }}>Price</span>
            </div>
            {shades.map((s, i) => (
              <div key={i} className="shade-row" style={{
                display: "grid", gridTemplateColumns: "1fr 40px 90px 100px 1fr 80px", gap: 12, alignItems: "center",
                background: "rgba(255,255,255,0.6)", borderRadius: 10, padding: "8px 12px", border: "1px solid rgba(171,31,16,0.06)",
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{s.name}</div>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: s.hex, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }} />
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "#7b241c" }}>{s.hex}</div>
                <div style={{ fontSize: 13, color: "#7b241c" }}>
                  {s.skintone ? <span><b>{s.skintone}</b>{s.undertone ? ` · ${s.undertone}` : ""}</span> : <span style={{ color: "#c0b0b0" }}>—</span>}
                </div>
                <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.link
                    ? <a href={s.link} target="_blank" rel="noreferrer" style={{ color: "#ab1f10", textDecoration: "underline" }}>Link ↗</a>
                    : <span style={{ color: "#c0b0b0" }}>—</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", textAlign: "right" }}>
                  {s.price !== "" && s.price != null ? `${currency}${s.price}` : <span style={{ color: "#c0b0b0", fontWeight: 400 }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// "✓ Verified" / "Mark verified" button
function VerifiedToggle({ entry, onToggle }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const verified = !!entry;
  const click = async () => {
    setBusy(true); setErr("");
    try { await onToggle(!verified); } catch (e) { setErr(e?.message || "Could not update"); } finally { setBusy(false); }
  };
  const when = entry?.at ? new Date(entry.at).toLocaleDateString() : "";
  return (
    <button
      onClick={click}
      disabled={busy}
      title={err || (verified ? `Verified${entry.by && entry.by !== "live-before-verification" ? ` by ${entry.by}` : ""}${when ? ` · ${when}` : ""} — click to unmark` : "Mark this product as checked and correct")}
      style={{
        border: `1.5px solid ${err ? "#c0392b" : verified ? "rgba(37,99,235,0.45)" : "rgba(171,31,16,0.3)"}`,
        background: verified ? "rgba(37,99,235,0.08)" : "rgba(255,255,255,0.7)",
        color: err ? "#c0392b" : verified ? "#1d4ed8" : "#7b241c",
        borderRadius: 11, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? "Saving…" : err ? "Retry" : verified ? "✓ Verified" : "Mark verified"}
    </button>
  );
}

function BuildDatabasePanel() {
  const [open, setOpen] = useState(false);
  const [buildCategory, setBuildCategory] = useState("lip-gloss");
  const [building, setBuilding] = useState(false);

  const handleBuildAndDownloadDict = async () => {
    if (!buildCategory) return;
    setBuilding(true);
    try {
      const res = await fetch("/api/build-product-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: buildCategory }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!data?.success) { alert(data?.error || "Build failed"); return; }
      const pretty = JSON.stringify(data.dict || {}, null, 2);
      const blob = new Blob([pretty], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename || `CategorisedLMD.${buildCategory}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.message || "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div style={{ ...GL.card, padding: open ? 22 : "12px 22px" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8, ...GL.sectionHeader }}
      >
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
        Build Product Database <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#b08080" }}>(India)</span>
      </button>
      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 14, color: "#7b241c", margin: "0 0 14px", opacity: 0.8 }}>
            Rebuild the categorised dictionary from S3 and download it locally.
          </p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
            <div>
              <label style={GL.label}>Category</label>
              <select
                className="th-input"
                value={buildCategory}
                onChange={(e) => setBuildCategory(e.target.value)}
                style={{ ...GL.input, width: "auto", minWidth: 220, cursor: "pointer" }}
              >
                <optgroup label="Lip">
                  <option value="matte-lipstick">Matte Lipstick</option>
                  <option value="satin-lipstick">Satin Lipstick</option>
                  <option value="lip-gloss">Lip Gloss / Lip Oil</option>
                  <option value="lip-tint">Lip Tint / Lip Stain</option>
                  <option value="lip-balm">Lip Balm</option>
                </optgroup>
                <optgroup label="Colour">
                  <option value="cream-blush">Cream / Liquid Blush</option>
                  <option value="powder-blush">Powder Blush</option>
                  <option value="contour">Contour</option>
                  <option value="cream-eyeshadow">Cream Eyeshadow</option>
                  <option value="powder-eyeshadow">Powder Eyeshadow</option>
                </optgroup>
                <optgroup label="Base">
                  <option value="foundation">Foundation</option>
                  <option value="concealer">Concealer</option>
                  <option value="skin-tint">Skin Tint</option>
                </optgroup>
              </select>
            </div>
            <button
              className="th-btn-primary"
              type="button"
              onClick={handleBuildAndDownloadDict}
              disabled={building}
              style={{ ...GL.btnPrimary, padding: "11px 20px", opacity: building ? 0.6 : 1, cursor: building ? "not-allowed" : "pointer" }}
            >
              {building ? "Building…" : "Build & Download"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
