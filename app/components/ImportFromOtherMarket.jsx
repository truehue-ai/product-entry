"use client";

// "Import from India / USA database": copy a product's shades (names, hex, skin tone, undertone) and category
// from the other market's saved data, so a product already captured there doesn't have to be redone.
// Links and prices are NOT copied — they come from different shops in each market.
// Uses direct S3 lookups (/api/logs/lookup): one check for the product, one listing per brand you open.

import { useEffect, useState } from "react";

const LABEL = { india: "🇮🇳 India", usa: "🇺🇸 USA" };

const box = { borderRadius: 12, background: "rgba(255,255,255,0.75)", border: "1px solid rgba(171,31,16,0.12)", padding: "12px 12px 10px" };
const input = {
  background: "rgba(255,255,255,0.8)", border: "1.5px solid rgba(171,31,16,0.15)", borderRadius: 10, padding: "8px 11px",
  fontSize: 13, color: "#1a0a09", outline: "none", width: "100%", boxSizing: "border-box",
};
const btn = (primary) => ({
  border: primary ? "none" : "1.5px solid rgba(171,31,16,0.3)", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 600,
  cursor: "pointer", whiteSpace: "nowrap",
  background: primary ? "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)" : "rgba(255,255,255,0.7)", color: primary ? "#fff" : "#ab1f10",
});

export default function ImportFromOtherMarket({ fromMarket, brand, product, currentShadeCount, onImport }) {
  const usa = fromMarket === "usa" ? "1" : "0";
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState(null);         // { loading } | { found } | { found: null } | { error }
  const [browsing, setBrowsing] = useState(false);  // picking a differently named product
  const [brands, setBrands] = useState(null);
  const [pickBrand, setPickBrand] = useState("");
  const [brandProducts, setBrandProducts] = useState(null); // { loading } | { products }
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState(null);

  // Is this exact product in the other market? (one S3 check)
  useEffect(() => {
    if (!open) return;
    if (!brand || !product) { setCheck({ found: null, empty: true }); return; }
    let active = true;
    setCheck({ loading: true });
    fetch(`/api/logs/lookup?usa=${usa}&brand=${encodeURIComponent(brand)}&product=${encodeURIComponent(product)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (active) setCheck(j.error ? { error: j.error } : { found: j.found || null }); })
      .catch((e) => { if (active) setCheck({ error: e?.message || "Lookup failed" }); });
    return () => { active = false; };
  }, [open, brand, product, usa]);

  // Brand folders, only when browsing (one listing)
  useEffect(() => {
    if (!browsing || brands) return;
    setPickBrand((prev) => prev || brand || "");
    fetch(`/api/logs/lookup?usa=${usa}&brands=1`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setBrands(j.brands || []))
      .catch(() => setBrands([]));
  }, [browsing, brands, brand, usa]);

  // Product folders of the chosen brand (one listing per brand)
  useEffect(() => {
    if (!browsing || !pickBrand.trim()) { setBrandProducts(null); return; }
    let active = true;
    const t = setTimeout(() => {
      setBrandProducts({ loading: true });
      fetch(`/api/logs/lookup?usa=${usa}&brand=${encodeURIComponent(pickBrand.trim())}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (active) setBrandProducts({ brand: j.brand, products: j.products || [] }); })
        .catch(() => { if (active) setBrandProducts({ products: [] }); });
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [browsing, pickBrand, usa]);

  const loadPreview = async (it) => {
    setPreview({ loading: true, brand: it.brand, product: it.product });
    try {
      const r = await fetch(`/api/logs/get?brand=${encodeURIComponent(it.brand)}&product=${encodeURIComponent(it.product)}&usa=${usa}`, { cache: "no-store" });
      const j = await r.json();
      const shades = (j.shades || []).filter((s) => s.name && s.hex);
      setPreview({ brand: it.brand, product: it.product, productType: j.productType || "", shades });
    } catch (e) {
      setPreview({ error: e?.message || "Could not load that product", brand: it.brand, product: it.product });
    }
  };

  const doImport = () => {
    onImport({
      shades: preview.shades.map((s) => ({ name: s.name, hex: s.hex, skintone: s.skintone || "", undertone: s.undertone || "", link: "", price: "" })),
      category: preview.productType,
      source: { market: fromMarket, brand: preview.brand, product: preview.product },
    });
    close();
  };
  const close = () => { setOpen(false); setPreview(null); setBrowsing(false); setQ(""); };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...btn(false), width: "100%", marginTop: 14 }}>
        📥 Import from {LABEL[fromMarket]} database
      </button>
    );
  }

  const needle = q.trim().toLowerCase();
  const shownProducts = (brandProducts?.products || []).filter((p) => !needle || p.toLowerCase().includes(needle));

  return (
    <div style={{ ...box, marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1a0a09" }}>📥 Import from {LABEL[fromMarket]} database</span>
        <button type="button" onClick={close}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ab1f10" }}>Close ✕</button>
      </div>
      <div style={{ fontSize: 12, color: "#9b4a42" }}>
        Copies shade names, hex, skin tone, undertone and category. Links and prices aren't copied — add this market's links/prices before saving.
      </div>

      {!preview && (
        <>
          {check?.loading && <div style={{ fontSize: 13, color: "#9b4a42" }}>Checking {LABEL[fromMarket]} database…</div>}
          {check?.error && <div style={{ fontSize: 13, color: "#c0392b" }}>{check.error}</div>}
          {check?.found && (
            <div style={{ padding: "9px 11px", borderRadius: 10, background: "rgba(22,163,74,0.08)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "#14532d", flex: "1 1 200px" }}>
                Found in {LABEL[fromMarket]}: <b>{check.found.brand}</b> · <b>{check.found.product}</b>
              </span>
              <button type="button" style={btn(true)} onClick={() => loadPreview(check.found)}>Use this →</button>
            </div>
          )}
          {check && !check.loading && !check.error && !check.found && (
            <div style={{ padding: "9px 11px", borderRadius: 10, background: "rgba(217,119,6,0.1)", fontSize: 13, color: "#92400e" }}>
              {check.empty
                ? <>Fill in brand and product above to check the {LABEL[fromMarket]} database.</>
                : <>Not in {LABEL[fromMarket]} database: <b>{brand}</b> · <b>{product}</b>.</>}
            </div>
          )}

          {!browsing ? (
            <button type="button" onClick={() => setBrowsing(true)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ab1f10", textDecoration: "underline", alignSelf: "flex-start" }}>
              Saved there under a different name? Pick it
            </button>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ flex: "1 1 160px", fontSize: 11, fontWeight: 700, color: "#7b241c" }}>
                  BRAND IN {fromMarket.toUpperCase()}
                  <input list={`th-import-brands-${fromMarket}`} value={pickBrand} onChange={(e) => setPickBrand(e.target.value)} style={input}
                    placeholder={brands ? "Brand…" : "Loading brands…"} />
                  <datalist id={`th-import-brands-${fromMarket}`}>{(brands || []).map((b) => <option key={b} value={b} />)}</datalist>
                </label>
                <label style={{ flex: "1 1 160px", fontSize: 11, fontWeight: 700, color: "#7b241c" }}>
                  PRODUCT
                  <input value={q} onChange={(e) => setQ(e.target.value)} style={input} placeholder="Filter…" />
                </label>
              </div>
              {pickBrand.trim() && (
                <div style={{ maxHeight: 200, overflowY: "auto", borderRadius: 10, border: "1px solid rgba(171,31,16,0.08)" }}>
                  {brandProducts?.loading && <div style={{ padding: 10, fontSize: 13, color: "#9b4a42" }}>Loading…</div>}
                  {brandProducts && !brandProducts.loading && shownProducts.length === 0 && (
                    <div style={{ padding: 10, fontSize: 13, color: "#9b4a42" }}>
                      {brandProducts.products.length ? "No products match." : `Not in ${LABEL[fromMarket]} database: no saved products for this brand.`}
                    </div>
                  )}
                  {!brandProducts?.loading && shownProducts.map((p) => (
                    <div key={p} onClick={() => loadPreview({ brand: brandProducts.brand || pickBrand.trim(), product: p })}
                      style={{ padding: "8px 10px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid rgba(171,31,16,0.05)", color: "#1a0a09" }}>
                      {p}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, color: "#1a0a09" }}>
            <b>{preview.brand}</b> · <b>{preview.product}</b>
            {preview.productType ? <span style={{ color: "#9b4a42" }}> · {preview.productType.replace(/-/g, " ")}</span> : null}
          </div>
          {preview.loading && <div style={{ fontSize: 13, color: "#9b4a42" }}>Loading shades…</div>}
          {preview.error && <div style={{ fontSize: 13, color: "#c0392b" }}>{preview.error}</div>}
          {preview.shades && preview.shades.length === 0 && (
            <div style={{ fontSize: 13, color: "#92400e" }}>No shades saved for this product in {LABEL[fromMarket]}.</div>
          )}
          {preview.shades?.length > 0 && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 96, overflowY: "auto" }}>
                {preview.shades.map((s, i) => (
                  <span key={i} title={`${s.name} ${s.hex}${s.skintone ? ` · ${s.skintone}/${s.undertone}` : ""}`}
                    style={{ width: 22, height: 22, borderRadius: 6, background: s.hex, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)" }} />
                ))}
              </div>
              {currentShadeCount > 0 && (
                <div style={{ fontSize: 12, color: "#b45309", fontWeight: 600 }}>
                  This replaces the {currentShadeCount} shade{currentShadeCount === 1 ? "" : "s"} currently in the editor.
                </div>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={{ ...btn(true), opacity: preview.shades?.length ? 1 : 0.5 }} disabled={!preview.shades?.length} onClick={doImport}>
              Import {preview.shades?.length || 0} shade{preview.shades?.length === 1 ? "" : "s"}
            </button>
            <button type="button" style={btn(false)} onClick={() => setPreview(null)}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
