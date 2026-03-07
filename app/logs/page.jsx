"use client";

import { useEffect, useMemo, useState } from "react";
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
    fontFamily: "'Inter', sans-serif",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 11,
    padding: "12px 22px",
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
    padding: "11px 20px",
    fontSize: 14,
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
    marginBottom: 18,
  },
};

export default function LogsPage() {
  const [query, setQuery] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [currentUser, setCurrentUser] = useState("");
  const router = useRouter();

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

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_auth=([^;]+)/);
    if (m) setCurrentUser(decodeURIComponent(m[1]));
  }, []);

  useEffect(() => {
    let active = true;
    const fetchList = async () => {
      setLoadingList(true);
      try {
        const r = await fetch(`/api/logs/list?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setItems(j.items || []);
      } finally {
        if (active) setLoadingList(false);
      }
    };
    const t = setTimeout(fetchList, 250);
    return () => { active = false; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!selected) { setDetails(null); return; }
      setLoadingDetails(true);
      try {
        const r = await fetch(
          `/api/logs/get?brand=${encodeURIComponent(selected.brand)}&product=${encodeURIComponent(selected.product)}`,
          { cache: "no-store" }
        );
        const j = await r.json();
        if (active) setDetails(j);
      } finally {
        if (active) setLoadingDetails(false);
      }
    };
    run();
    return () => { active = false; };
  }, [selected]);

  const list = useMemo(() => items, [items]);

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
        .list-item:hover { background: rgba(171,31,16,0.04) !important; }
        .list-item.selected { background: rgba(171,31,16,0.08) !important; border-left: 4px solid #ab1f10 !important; }
        .shade-row:hover { background: rgba(171,31,16,0.03); }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
      `}</style>

      {/* ── Top Nav ── */}
      <div style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)",
        padding: "16px 36px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 40,
        boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="th-btn-ghost" onClick={() => router.push('/')}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#ab1f10", padding: "8px 14px", borderRadius: 9 }}>
            ← Home
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
          <button className="th-btn-ghost" onClick={() => router.push('/color-picker')}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>
            Shade Capture
          </button>
          {currentUser === "dhruvi" && (
            <>
              <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
              <button className="th-btn-ghost" onClick={() => router.push('/audit')}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>
                Audit
              </button>
              <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
              <button className="th-btn-ghost" onClick={() => router.push('/analytics')}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>
                Analytics
              </button>
            </>
          )}
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Product Logs</span>
        <div style={{ width: 120 }} />{/* spacer to center title */}
      </div>

      <div style={{ padding: "28px 28px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── Build Database Section (Dhruvi only) ── */}
        {currentUser === "dhruvi" && (
          <div style={{ ...GL.card, padding: 26 }}>
            <div style={GL.sectionHeader}>Build Product Database</div>
            <p style={{ fontSize: 14, color: "#7b241c", marginBottom: 18, marginTop: -10, opacity: 0.8 }}>
              Rebuild the categorised dictionary from S3 and download it locally.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 auto" }}>
                <label style={GL.label}>Category</label>
                <div style={{ position: "relative" }}>
                  <select
                    className="th-input"
                    value={buildCategory}
                    onChange={(e) => setBuildCategory(e.target.value)}
                    style={{ ...GL.input, width: "auto", minWidth: 220, appearance: "none", paddingRight: 36, cursor: "pointer" }}
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
                  <span style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#ab1f10", fontSize: 12 }}>▾</span>
                </div>
              </div>
              <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
                <button
                  className="th-btn-primary"
                  type="button"
                  onClick={handleBuildAndDownloadDict}
                  disabled={building}
                  style={{ ...GL.btnPrimary, opacity: building ? 0.6 : 1, cursor: building ? "not-allowed" : "pointer" }}
                >
                  {building ? "Building…" : "Build & Download"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Search + Main Content ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Search bar */}
          <div style={{ ...GL.card, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>🔎</span>
            <input
              className="th-input"
              style={{ ...GL.input, border: "none", background: "transparent", padding: "0", fontSize: 16, boxShadow: "none" }}
              placeholder="Search by brand or product…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loadingList && (
              <span style={{ fontSize: 13, color: "#9b4a42", flexShrink: 0 }}>Loading…</span>
            )}
          </div>

          {/* Two-column layout */}
          <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20, alignItems: "flex-start" }}>

            {/* ── Left: results list ── */}
            <div style={{ ...GL.card, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(171,31,16,0.08)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Results <span style={{ fontWeight: 400, color: "#b08080", marginLeft: 6 }}>({list.length})</span>
                </div>
              </div>
              <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
                {list.length === 0 && !loadingList && (
                  <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 14, color: "#9b4a42" }}>No matches.</div>
                )}
                {list.map((it) => {
                  const isSel = selected && it.brand === selected.brand && it.product === selected.product;
                  return (
                    <div
                      key={`${it.brand}:::${it.product}`}
                      className={`list-item ${isSel ? "selected" : ""}`}
                      onClick={() => setSelected(it)}
                      style={{
                        padding: "14px 20px 14px 20px",
                        cursor: "pointer",
                        borderLeft: "4px solid transparent",
                        borderBottom: "1px solid rgba(171,31,16,0.05)",
                        transition: "background 0.12s",
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a0a09", marginBottom: 2 }}>{it.product}</div>
                      <div style={{ fontSize: 13, color: "#7b241c" }}>{it.brand}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Right: details ── */}
            <div>
              {!selected && (
                <div style={{ ...GL.card, padding: 40, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>👈</div>
                  <div style={{ fontSize: 16, color: "#9b4a42", fontWeight: 500 }}>Select a product to view details</div>
                </div>
              )}

              {selected && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  {/* Product header card */}
                  <div style={{ ...GL.card, padding: 26, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#1a0a09", letterSpacing: "-0.3px", marginBottom: 4 }}>{selected.product}</div>
                      <div style={{ fontSize: 15, color: "#7b241c", marginBottom: 6 }}>{selected.brand}</div>
                      {details?.meta?.lastSavedBy && (
                        <div style={{ fontSize: 13, color: "#9b4a42" }}>
                          Saved by <span style={{ fontWeight: 600 }}>{details.meta.lastSavedBy}</span>
                          {details.meta.lastSavedAt ? ` · ${new Date(details.meta.lastSavedAt).toLocaleString()}` : ""}
                        </div>
                      )}
                      {details?.meta && (
                        <div style={{ fontSize: 13, color: "#9b4a42", marginTop: 6, display: "flex", gap: 14 }}>
                          <span style={{ color: details.meta.hasLinks ? "#16a34a" : "#c0b0b0" }}>
                            {details.meta.hasLinks ? "✓" : "—"} Links
                          </span>
                          <span style={{ color: details.meta.hasPrice ? "#16a34a" : "#c0b0b0" }}>
                            {details.meta.hasPrice ? "✓" : "—"} Prices
                          </span>
                          <span style={{ color: details.meta.hasType ? "#16a34a" : "#c0b0b0" }}>
                            {details.meta.hasType ? "✓" : "—"} Type
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      className="th-btn-primary"
                      style={GL.btnPrimary}
                      onClick={() => router.push(`/color-picker?brand=${encodeURIComponent(selected.brand)}&product=${encodeURIComponent(selected.product)}&from=logs`)}
                    >
                      Edit in Shade Capture →
                    </button>
                  </div>

                  {/* Shades list */}
                  <div style={{ ...GL.card, padding: 26 }}>
                    <div style={GL.sectionHeader}>
                      Shades {details?.shades ? `(${details.shades.length})` : ""}
                    </div>

                    {loadingDetails && (
                      <div style={{ fontSize: 14, color: "#9b4a42", padding: "20px 0" }}>Loading details…</div>
                    )}

                    {!loadingDetails && details && details.shades.length === 0 && (
                      <div style={{ fontSize: 14, color: "#9b4a42" }}>No shades found.</div>
                    )}

                    {!loadingDetails && details && details.shades.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {/* Table header */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 90px 120px 1fr 90px", gap: 12, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          <span>Name</span>
                          <span></span>
                          <span>Hex</span>
                          <span>Tone / UT</span>
                          <span>Link</span>
                          <span style={{ textAlign: "right" }}>Price</span>
                        </div>
                        {details.shades.map((s, idx) => (
                          <div
                            key={idx}
                            className="shade-row"
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 48px 90px 120px 1fr 90px",
                              gap: 12,
                              alignItems: "center",
                              background: "rgba(255,255,255,0.6)",
                              borderRadius: 11,
                              padding: "12px 14px",
                              border: "1px solid rgba(171,31,16,0.06)",
                            }}
                          >
                            <div style={{ fontSize: 15, fontWeight: 600, color: "#1a0a09" }}>{s.name}</div>
                            <div style={{ width: 36, height: 36, borderRadius: 9, background: s.hex, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", flexShrink: 0 }} />
                            <div style={{ fontSize: 12, fontFamily: "monospace", color: "#7b241c" }}>{s.hex}</div>
                            <div style={{ fontSize: 13, color: "#7b241c" }}>
                              {s.skintone ? <span><b>{s.skintone}</b>{s.undertone ? ` · ${s.undertone}` : ""}</span> : <span style={{ color: "#c0b0b0" }}>—</span>}
                            </div>
                            <div style={{ fontSize: 13, color: "#7b241c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.link
                                ? <a href={s.link} target="_blank" rel="noreferrer" style={{ color: "#ab1f10", textDecoration: "underline" }}>Link ↗</a>
                                : <span style={{ color: "#c0b0b0" }}>—</span>}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", textAlign: "right" }}>
                              {s.price ? `₹${s.price}` : <span style={{ color: "#c0b0b0", fontWeight: 400 }}>—</span>}
                            </div>
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
      </div>
    </div>
  );
}