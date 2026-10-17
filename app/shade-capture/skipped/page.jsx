"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BRANDS_INDIA from "../brands-india.json";
import BRANDS_USA from "../brands-usa.json";

// Products skipped from the Shade Capture queue (skipped/skipped-<market>.json), with a way to put them back.

const GL = {
  card: {
    background: "rgba(255,255,255,0.58)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    border: "1.5px solid rgba(255,255,255,0.8)", borderRadius: 18, boxShadow: "0 4px 24px rgba(171,31,16,0.07)",
  },
  input: {
    background: "rgba(255,255,255,0.7)", border: "1.5px solid rgba(171,31,16,0.15)", borderRadius: 11, padding: "10px 13px",
    fontSize: 14, color: "#1a0a09", outline: "none", width: "100%", boxSizing: "border-box",
  },
  btnOutline: {
    background: "rgba(255,255,255,0.7)", color: "#ab1f10", border: "1.5px solid rgba(171,31,16,0.3)", borderRadius: 10,
    padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  pill: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" },
};

const MARKETS = {
  india: { label: "India", flag: "🇮🇳", editor: "/color-picker", brands: BRANDS_INDIA },
  usa: { label: "USA", flag: "🇺🇸", editor: "/color-picker-usa", brands: BRANDS_USA },
};
const REASONS = {
  "already-added": { label: "Already added", icon: "✓", fg: "#15803d", bg: "rgba(22,163,74,0.1)" },
  "website-not-found": { label: "Couldn't find website", icon: "🔍", fg: "#b45309", bg: "rgba(217,119,6,0.12)" },
  "discontinued": { label: "Product discontinued", icon: "⛔", fg: "#b91c1c", bg: "rgba(220,38,38,0.09)" },
  "out-of-stock": { label: "All shades out of stock", icon: "📦", fg: "#6d28d9", bg: "rgba(124,58,237,0.1)" },
};
const normKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const prettyType = (t) => (t ? t.replace(/-/g, " ") : "uncategorised");
const keyOf = (it) => it.id || `${it.brand}:::${it.product}`;

export default function SkippedPage() {
  return (
    <Suspense fallback={null}>
      <Skipped />
    </Suspense>
  );
}

function Skipped() {
  const router = useRouter();
  const sp = useSearchParams();
  const market = sp.get("market") === "usa" ? "usa" : "india";
  const M = MARKETS[market];

  const [lists, setLists] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async (mk) => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/shade-capture/skipped?market=${mk}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setLists((prev) => ({ ...prev, [mk]: j.items || [] }));
    } catch (e) {
      setError(e?.message || "Failed to load skipped products");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (!lists[market]) load(market); }, [market, lists, load]);
  useEffect(() => { setReason(""); setSearch(""); }, [market]);

  const brandName = useMemo(() => {
    const names = new Map(M.brands.map((b) => [normKey(b.slug), b.name]));
    return (b) => names.get(normKey(b)) || b || "No brand";
  }, [M.brands]);

  const items = lists[market] || [];
  const counts = useMemo(() => {
    const c = { "": items.length };
    items.forEach((it) => { c[it.reason] = (c[it.reason] || 0) + 1; });
    return c;
  }, [items]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((it) => (!reason || it.reason === reason) &&
        (!q || String(it.brand).toLowerCase().includes(q) || String(it.product).toLowerCase().includes(q) || brandName(it.brand).toLowerCase().includes(q)))
      .sort((a, b) => String(b.skippedAt).localeCompare(String(a.skippedAt)));
  }, [items, reason, search, brandName]);

  const restore = async (it) => {
    const r = await fetch("/api/shade-capture/skipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market, action: "restore", id: it.id, brand: it.brand, product: it.product }),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || "Could not restore");
    setLists((prev) => ({ ...prev, [market]: j.skipped || [] }));
  };

  // "Already added" opens the saved product it duplicates; others open the skipped product itself
  const openEditor = (it) => {
    const target = it.duplicateOf || it;
    const params = new URLSearchParams({ brand: target.brand || "", product: target.product || "" });
    window.open(`${M.editor}?${params.toString()}`, "_blank");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-ghost:hover, .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .chip { border: 1.5px solid rgba(171,31,16,0.14); background: rgba(255,255,255,0.7); color: #7b241c; border-radius: 999px;
          padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
        .chip.active { background: #ab1f10; border-color: #ab1f10; color: #fff; }
        .chip .n { font-weight: 500; opacity: 0.7; font-size: 12px; }
        .s-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 11px 16px; border-top: 1px solid rgba(171,31,16,0.05); }
        .s-row:hover { background: rgba(255,255,255,0.55); }
        @media (max-width: 720px) { .s-row { grid-template-columns: minmax(0, 1fr); } }
      `}</style>

      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "14px 28px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <button className="th-btn-ghost" onClick={() => router.push(`/shade-capture${market === "usa" ? "?market=usa" : ""}`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#ab1f10", padding: "8px 12px", borderRadius: 9 }}>
          ← Shade Capture
        </button>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Skipped products</span>
        <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 11, padding: 3, gap: 3 }}>
          {Object.entries(MARKETS).map(([k, m]) => (
            <button key={k} onClick={() => router.replace(`/shade-capture/skipped${k === "usa" ? "?market=usa" : ""}`, { scroll: false })} style={{
              border: "none", cursor: "pointer", borderRadius: 8, padding: "7px 13px", fontSize: 13, fontWeight: 600,
              background: k === market ? "#fff" : "transparent", color: k === market ? "#ab1f10" : "#9b4a42",
              boxShadow: k === market ? "0 2px 8px rgba(171,31,16,0.15)" : "none",
            }}>{m.flag} {m.label}</button>
          ))}
        </div>
      </div>

      <div className="m-pad" style={{ padding: "24px 28px", maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...GL.card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#9b4a42" }}>
            Products skipped from the {M.label} Up next queue. <b>Restore</b> puts a product back on the to-do list.
          </div>
          <div className="chips">
            <button className={`chip ${!reason ? "active" : ""}`} onClick={() => setReason("")}>All <span className="n">{counts[""] || 0}</span></button>
            {Object.entries(REASONS).map(([k, r]) => (
              <button key={k} className={`chip ${reason === k ? "active" : ""}`} onClick={() => setReason(k)}>
                {r.icon} {r.label} <span className="n">{counts[k] || 0}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input className="th-input" style={{ ...GL.input, flex: 1 }} placeholder="Search brand or product…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="th-btn-ghost" onClick={() => load(market)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "8px 10px", borderRadius: 8 }}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}

        <div style={{ ...GL.card, overflow: "hidden" }}>
          {!lists[market] && <div style={{ padding: 28, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>{loading ? "Loading…" : ""}</div>}
          {lists[market] && shown.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>
              {items.length ? "Nothing matches." : `Nothing skipped in ${M.label} yet.`}
            </div>
          )}
          {shown.map((it) => <SkippedRow key={keyOf(it)} it={it} brandName={brandName} onRestore={() => restore(it)} onOpen={() => openEditor(it)} />)}
        </div>
      </div>
    </div>
  );
}

function SkippedRow({ it, brandName, onRestore, onOpen }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const r = REASONS[it.reason] || { label: it.reason || "Skipped", icon: "⏭", fg: "#7b6b6b", bg: "rgba(0,0,0,0.05)" };
  const restore = async () => {
    setBusy(true); setErr("");
    try { await onRestore(); } catch (e) { setErr(e?.message || "Could not restore"); setBusy(false); }
  };
  return (
    <div className="s-row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {String(it.product || "").replace(/-/g, " ")}
        </div>
        <div style={{ fontSize: 12, color: "#9b4a42", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span>{brandName(it.brand)} · <span style={{ textTransform: "capitalize" }}>{prettyType(it.category)}</span></span>
          <span>· skipped {it.skippedBy ? `by ${it.skippedBy} ` : ""}{it.skippedAt ? new Date(it.skippedAt).toLocaleDateString() : ""}</span>
          {it.links?.length > 0 && (
            <button onClick={() => setShowLinks((v) => !v)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ab1f10", textDecoration: "underline" }}>
              {showLinks ? "Hide" : "Show"} {it.links.length} link{it.links.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {it.duplicateOf && (
          <div style={{ marginTop: 6, fontSize: 12, padding: "6px 9px", borderRadius: 8, background: "rgba(22,163,74,0.07)", color: "#14532d" }}>
            Already added as <b>{brandName(it.duplicateOf.brand)}</b> · <b>{it.duplicateOf.product}</b>
            {it.duplicateOf.link && (
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <a href={it.duplicateOf.link} target="_blank" rel="noreferrer" style={{ color: "#15803d" }}>{it.duplicateOf.link}</a>
              </div>
            )}
          </div>
        )}
        {showLinks && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
            {it.links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#7b241c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</a>
            ))}
          </div>
        )}
        {err && <div style={{ fontSize: 12, fontWeight: 600, color: "#c0392b", marginTop: 4 }}>{err}</div>}
      </div>
      <span style={{ ...GL.pill, background: r.bg, color: r.fg }}>{r.icon} {r.label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="th-btn-outline" style={GL.btnOutline} onClick={onOpen}
          title={it.duplicateOf ? "Opens the saved product it duplicates" : "Opens this product in Shade Capture"}>Open ↗</button>
        <button className="th-btn-outline" style={GL.btnOutline} onClick={restore} disabled={busy}>{busy ? "Restoring…" : "↩ Restore"}</button>
      </div>
    </div>
  );
}
