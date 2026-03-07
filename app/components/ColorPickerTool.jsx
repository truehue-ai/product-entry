'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";

import SBPickerPanel from "./SBPickerPanel";
import { rgbToHsb } from "./SBPickerPanel";

const LIP_CATEGORIES = [
  "matte-lipstick",
  "satin-lipstick",
  "lip-gloss",
  "lip-tint",
  "lip-balm",
];

const isLipCategory = (c) => LIP_CATEGORIES.includes(c);

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function hexToRgb(hex) {
  if (!hex) return null;
  let clean = hex.trim().replace("#", "");
  if (clean.length === 3) clean = clean.split("").map((ch) => ch + ch).join("");
  if (clean.length !== 6) return null;
  const num = parseInt(clean, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function classifySkinToneFromSB(s, b) {
  if ((b >= 90 && s <= 50) || (b >= 87 && s <= 40)) return "F";
  if ((b >= 85 && s >= 50 && s < 60) || (b >= 80 && s <= 45) || (b >= 70 && s <= 40)) return "FM";
  if ((b >= 78 && s >= 40 && s < 68) || (b >= 70 && s <= 50 && s >= 40) || (b >= 60 && s <= 40)) return "MD";
  if ((b >= 68 && s >= 55 && s < 68) || (s >= 45 && s <= 50 && b >= 50)) return "D1";
  if (b >= 50) return "D2";
  if (b <= 50) return "VD";
  return "";
}

function classifyUndertoneFromHue(h, s, b) {
  if (Number.isNaN(h)) return "";
  if (b > 90) {
    if (h >= 0 && h <= 25) return "C";
    if (h > 25 && h <= 28) return "N";
    return "W";
  }
  if (s <= 45 && b < 90) {
    if (h >= 0 && h <= 25) return "C";
    return "N";
  }
  if (h >= 0 && h < 20) return "C";
  if (h >= 20 && h < 24) return "N";
  if (h >= 24) return "W";
  return "";
}

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
    padding: "15px 22px",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(171,31,16,0.25)",
    transition: "opacity 0.15s, transform 0.15s",
    width: "100%",
  },
  btnOutline: {
    background: "rgba(255,255,255,0.7)",
    color: "#ab1f10",
    border: "1.5px solid rgba(171,31,16,0.3)",
    borderRadius: 11,
    padding: "14px 22px",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    width: "100%",
  },
};

export default function ColorPickerTool({ initialBrand = "", initialProduct = "" }) {
  const router = useRouter();

  const [brand, setBrand] = useState(initialBrand);
  const [product, setProduct] = useState(initialProduct);
  const [category, setCategory] = useState("matte-lipstick");
  const [shades, setShades] = useState([{ name: "", hex: "", skintone: "", undertone: "", link: "", price: "" }]);
  const [activeShadeIndex, setActiveShadeIndex] = useState(0);

  const [images, setImages] = useState([]);
  const canvasRefs = useRef([]);
  const imgRefs = useRef([]);
  const fileInputRef = useRef(null);
  const [isOver, setIsOver] = useState(false);
  const ACCEPT = ["image/png","image/jpeg","image/webp","image/gif","image/heic","image/heif"];
  const MAX_FILES = 50;

  const addFiles = useCallback(async (filesLike) => {
    const files = Array.from(filesLike || []);
    if (!files.length) return;
    const room = Math.max(0, MAX_FILES - images.length);
    const toAdd = files.slice(0, room).filter(f =>
      ACCEPT.includes(f.type) || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(f.name || "")
    );
    const dataUrls = await Promise.all(toAdd.map(fileToDataURL));
    const mapped = toAdd.map((f, idx) => ({
      id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      dataUrl: dataUrls[idx],
    }));
    setImages(prev => prev.concat(mapped));
  }, [images.length]);

  const onDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setIsOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onBrowse = useCallback(async (e) => {
    if (e.target.files?.length) await addFiles(e.target.files);
    e.target.value = "";
  }, [addFiles]);

  const removeImage = useCallback((id) => {
    setImages(prev => prev.filter(p => p.id !== id));
  }, []);

  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState("");
  const [lockedIndex, setLockedIndex] = useState(null);
  const [showSBPicker, setShowSBPicker] = useState(false);
  const [currentHue, setCurrentHue] = useState(null);
  const [coverage, setCoverage] = useState("");
  const [finish, setFinish] = useState("");

  useEffect(() => {
    images.forEach((imgObj, idx) => {
      const imgEl = imgRefs.current[idx];
      const canvasEl = canvasRefs.current[idx];
      if (!imgEl || !canvasEl || !imgObj?.dataUrl) return;
      const ctx = canvasEl.getContext("2d");
      imgEl.onload = () => {
        canvasEl.width = imgEl.naturalWidth;
        canvasEl.height = imgEl.naturalHeight;
        ctx.drawImage(imgEl, 0, 0);
      };
      imgEl.src = imgObj.dataUrl;
    });
  }, [images]);

  const handleMouseMove = (e, idx) => {
    const canvas = canvasRefs.current[idx];
    if (!canvas || lockedIndex === activeShadeIndex) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = Math.max(0, Math.min(canvas.width - 1, Math.floor((e.clientX - rect.left) * scaleX)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor((e.clientY - rect.top) * scaleY)));
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hex = `#${[pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    const newShades = [...shades];
    newShades[activeShadeIndex].hex = hex;
    setShades(newShades);
  };

  const handleClick = (e, idx) => {
    const canvas = canvasRefs.current[idx];
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = Math.max(0, Math.min(canvas.width - 1, Math.floor((e.clientX - rect.left) * scaleX)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor((e.clientY - rect.top) * scaleY)));
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const [r, g, b] = pixel;
    const [h] = rgbToHsb(r, g, b);
    setCurrentHue(h);
    setShowSBPicker(true);
    setLockedIndex(activeShadeIndex);
  };

  const handleSave = async () => {
    if (!brand || !product || !category) {
      alert("Brand, Product, and Category are required!");
      return;
    }
    const filteredShades = shades.filter(s => s.name && s.hex);
    let structuredShades;
    if (["foundation","contour","concealer","skin-tint"].includes(category)) {
      structuredShades = filteredShades.map(s => ({ name: s.name, hex: s.hex, skintone: s.skintone, undertone: s.undertone }));
    } else {
      structuredShades = filteredShades.map(s => ({ name: s.name, hex: s.hex }));
    }
    const res = await fetch('/api/upload-shades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, product, category, shades: structuredShades })
    });
    let result = {};
    try { result = await res.json(); } catch { alert("Upload failed: invalid response"); return; }

    const linkMap = {};
    filteredShades.forEach(s => { if (s.link) linkMap[s.name] = s.link; });
    if (Object.keys(linkMap).length > 0) {
      await fetch('/api/upload-links-json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, product, links: linkMap }) });
    }
    const priceMap = {};
    filteredShades.forEach(s => { if (s.price) priceMap[s.name] = s.price; });
    if (Object.keys(priceMap).length > 0) {
      await fetch('/api/upload-price-json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, product, price: priceMap }) });
    }
    const typeMap = {};
    filteredShades.forEach(s => { if (category) typeMap[s.name] = category; });
    if (Object.keys(typeMap).length > 0) {
      await fetch('/api/upload-type-json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, product, type: typeMap }) });
    }

    if (result.success) {
      alert("Shades uploaded to S3 successfully!");
      await fetch('/api/update-all-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, product, type: category }) });
    } else {
      alert("Upload failed: " + (result.error || "Unknown error"));
    }
  };

  const handleSendToShopify = async () => {
    if (!brand || !product || !productType || !tags) { alert("All fields are required!"); return; }
    const res = await fetch('/api/shopify-create-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: product, vendor: brand, productType, tags })
    });
    const result = await res.json();
    if (result.success) { alert("Product added to Shopify!"); }
    else { alert("Failed to add product: " + result.error); }
  };

  const logout = () => {
    document.cookie = 'th_auth=; Max-Age=0; Path=/; SameSite=Lax';
    localStorage.removeItem('th_user');
    router.push('/login');
  };

  const exportText = useMemo(() => {
    const headerLabel = product ? `// ${product}` : `// ${category?.replace(/-/g, " ") || "Shades"}`;
    const rows = shades.filter(s => s.name && s.hex).map(s => `    {name: "${s.name}",   hex: "${s.hex}"}`).join(",\n");
    return `var shades = [\n    ${headerLabel}\n${rows}\n];`;
  }, [shades, product, category]);

  const copyExportText = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      alert("Copied to clipboard!");
    } catch {
      const ta = document.getElementById("th-export-textarea");
      if (ta) { ta.focus(); ta.select(); }
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!initialBrand || !initialProduct) return;
      const r = await fetch(`/api/logs/get?brand=${encodeURIComponent(initialBrand)}&product=${encodeURIComponent(initialProduct)}`, { cache: "no-store" });
      const j = await r.json();
      if (j?.shades) {
        setBrand(j.brand); setProduct(j.product);
        const inferredType = j.productType || (j.shades.find((s) => !!s.type)?.type ?? "");
        if (inferredType) setCategory(inferredType);
        setShades(j.shades.map((s) => ({ name: s.name || "", hex: s.hex || "", skintone: s.skintone || "", undertone: s.undertone || "", link: s.link || "", price: s.price || "" })));
      }
    };
    load();
  }, [initialBrand, initialProduct]);

  const deleteShade = (index) => {
    setShades(prev => {
      if (prev.length === 1) { setActiveShadeIndex(0); setLockedIndex(null); return [{ name: "", hex: "", skintone: "", undertone: "", link: "", price: "" }]; }
      const next = [...prev];
      next.splice(index, 1);
      setActiveShadeIndex(curr => { if (curr === index) return Math.max(0, index - 1); if (curr > index) return curr - 1; return curr; });
      setLockedIndex(curr => { if (curr == null) return curr; if (curr === index) return null; if (curr > index) return curr - 1; return curr; });
      return next;
    });
  };

  const autoCategorizeFaceShades = () => {
    if (!["foundation","concealer"].includes(category)) { alert("Auto-categorize works only for foundation and concealer."); return; }
    setShades(prev => prev.map(shade => {
      if (!shade.hex) return shade;
      const rgb = hexToRgb(shade.hex);
      if (!rgb) return shade;
      const [h, s, b] = rgbToHsb(rgb.r, rgb.g, rgb.b);
      return { ...shade, skintone: classifySkinToneFromSB(s, b) || shade.skintone || "", undertone: classifyUndertoneFromHue(h, s, b) || shade.undertone || "" };
    }));
  };

  const isFaceCategory = ["foundation","contour","concealer","skin-tint"].includes(category);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .th-btn-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .shade-row { transition: background 0.15s; }
        .shade-row:hover { background: rgba(171,31,16,0.03); }
        .shade-row.active-row { background: rgba(171,31,16,0.06); border-left: 4px solid #ab1f10; }
        .del-btn:hover { background: rgba(192,57,43,0.1) !important; color: #ab1f10 !important; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
      `}</style>

      {/* ── Top Nav ── */}
      <div style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)", borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "16px 36px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="th-btn-ghost" onClick={() => router.push('/')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#ab1f10", padding: "8px 14px", borderRadius: 9 }}>← Home</button>
          <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
          <button className="th-btn-ghost" onClick={() => router.push('/logs')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>Logs</button>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Shade Capture</span>
        <button onClick={logout} style={{ background: "none", border: "1.5px solid rgba(171,31,16,0.3)", borderRadius: 9, padding: "8px 18px", fontSize: 14, fontWeight: 600, color: "#ab1f10", cursor: "pointer" }}>Logout</button>
      </div>

      <div style={{ padding: "28px 28px", display: "flex", gap: 24, alignItems: "flex-start" }}>

        {/* ── Left Panel ── */}
        <div style={{ width: 480, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Product Info */}
          <div style={{ ...GL.card, padding: 26 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 18 }}>Product Info</div>

            <div style={{ marginBottom: 16 }}>
              <label style={GL.label}>Category</label>
              <div style={{ position: "relative" }}>
                <select className="th-input" value={category} onChange={(e) => setCategory(e.target.value)}
                  style={{ ...GL.input, appearance: "none", paddingRight: 36, cursor: "pointer" }}>
                  <optgroup label="Lip">
                    <option value="matte-lipstick">Matte Lipstick</option>
                    <option value="satin-lipstick">Satin Lipstick</option>
                    <option value="lip-gloss">Lip Gloss / Lip Oil</option>
                    <option value="lip-tint">Lip Tint / Lip Stain</option>
                    <option value="lip-balm">Lip Balm</option>
                  </optgroup>
                  <optgroup label="Base">
                    <option value="foundation">Foundation</option>
                    <option value="concealer">Concealer</option>
                    <option value="skin-tint">Skin Tint</option>
                    <option value="contour">Contour</option>
                  </optgroup>
                  <optgroup label="Colour">
                    <option value="cream-blush">Cream / Liquid Blush</option>
                    <option value="powder-blush">Powder Blush</option>
                    <option value="cream-eyeshadow">Cream Eyeshadow</option>
                    <option value="powder-eyeshadow">Powder Eyeshadow</option>
                  </optgroup>
                </select>
                <span style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#ab1f10", fontSize: 12 }}>▾</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={GL.label}>Brand</label>
                <input className="th-input" style={GL.input} placeholder="e.g. NARS" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
              <div>
                <label style={GL.label}>Product</label>
                <input className="th-input" style={GL.input} placeholder="e.g. Sheer Glow" value={product} onChange={(e) => setProduct(e.target.value)} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={GL.label}>Type</label>
                <input className="th-input" style={GL.input} placeholder="Product type" value={productType} onChange={(e) => setProductType(e.target.value)} />
              </div>
              <div>
                <label style={GL.label}>Tags</label>
                <input className="th-input" style={GL.input} placeholder="tag1, tag2" value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
            </div>

            {["foundation","concealer","skin-tint"].includes(category) && (
              <div style={{ marginTop: 14 }}>
                <label style={GL.label}>Coverage</label>
                <div style={{ position: "relative" }}>
                  <select className="th-input" value={coverage} onChange={(e) => setCoverage(e.target.value)} style={{ ...GL.input, appearance: "none", paddingRight: 36, cursor: "pointer" }}>
                    <option value="">Select coverage…</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="full">Full</option>
                  </select>
                  <span style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#ab1f10", fontSize: 12 }}>▾</span>
                </div>
              </div>
            )}

            {category === "contour" && (
              <div style={{ marginTop: 14 }}>
                <label style={GL.label}>Finish</label>
                <div style={{ position: "relative" }}>
                  <select className="th-input" value={finish} onChange={(e) => setFinish(e.target.value)} style={{ ...GL.input, appearance: "none", paddingRight: 36, cursor: "pointer" }}>
                    <option value="">Select finish…</option>
                    <option value="cream">Cream</option>
                    <option value="powder">Powder</option>
                  </select>
                  <span style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#ab1f10", fontSize: 12 }}>▾</span>
                </div>
              </div>
            )}
          </div>

          {/* Shades */}
          <div style={{ ...GL.card, padding: 26 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Shades <span style={{ fontWeight: 400, color: "#b08080", marginLeft: 6 }}>({shades.filter(s => s.name).length})</span>
              </div>
              {["foundation","concealer"].includes(category) && (
                <button className="th-btn-ghost" onClick={autoCategorizeFaceShades} style={{ background: "rgba(171,31,16,0.06)", border: "none", borderRadius: 8, padding: "7px 13px", fontSize: 12, fontWeight: 600, color: "#ab1f10", cursor: "pointer" }}>
                  Auto-detect tones
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 560, overflowY: "auto", paddingRight: 4 }}>
              {shades.map((shade, i) => (
                <div
                  key={i}
                  className={`shade-row ${activeShadeIndex === i ? "active-row" : ""}`}
                  style={{ borderRadius: 11, padding: "12px 12px 12px 14px", borderLeft: "4px solid transparent", cursor: "pointer" }}
                  onClick={() => { setActiveShadeIndex(i); setLockedIndex(null); }}
                >
                  {/* Row 1: name + swatch + hex + delete */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      className="th-input"
                      style={{ ...GL.input, flex: 1, minWidth: 0, padding: "10px 12px", fontSize: 14 }}
                      placeholder="Shade name"
                      value={shade.name}
                      onChange={(e) => { const n = [...shades]; n[i].name = e.target.value; setShades(n); }}
                      onFocus={() => { setActiveShadeIndex(i); setLockedIndex(null); }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div style={{ width: 36, height: 36, borderRadius: 9, border: shade.hex ? "none" : "1.5px dashed rgba(171,31,16,0.25)", background: shade.hex || "transparent", flexShrink: 0, boxShadow: shade.hex ? "0 2px 6px rgba(0,0,0,0.15)" : "none" }} />
                    <span style={{ fontSize: 12, fontFamily: "monospace", color: "#7b241c", minWidth: 66, flexShrink: 0 }}>{shade.hex || "—"}</span>
                    <button
                      className="del-btn"
                      onClick={(e) => { e.stopPropagation(); deleteShade(i); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#c0b0b0", fontSize: 18, padding: "2px 6px", borderRadius: 6, lineHeight: 1, flexShrink: 0 }}
                      title="Delete shade"
                    >×</button>
                  </div>

                  {/* Row 2: link + price */}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input
                      className="th-input"
                      style={{ ...GL.input, flex: 2, minWidth: 0, padding: "9px 12px", fontSize: 13 }}
                      placeholder="Product link"
                      value={shade.link || ""}
                      onChange={(e) => { const n = [...shades]; n[i].link = e.target.value; setShades(n); }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <input
                      className="th-input"
                      style={{ ...GL.input, flex: 1, minWidth: 0, padding: "9px 12px", fontSize: 13 }}
                      placeholder="Price"
                      type="number"
                      value={shade.price || ""}
                      onChange={(e) => { const n = [...shades]; n[i].price = parseFloat(e.target.value); setShades(n); }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  {/* Row 3: skin tone + undertone (face categories) */}
                  {isFaceCategory && (
                    <div style={{ marginTop: 8 }}>
                      {!(shade.skintone && shade.undertone) ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <div style={{ position: "relative", flex: 1 }}>
                            <select className="th-input" value={shade.skintone || ""} onChange={(e) => { const n = [...shades]; n[i].skintone = e.target.value; setShades(n); }} onClick={(e) => e.stopPropagation()}
                              style={{ ...GL.input, appearance: "none", paddingRight: 28, fontSize: 13, padding: "9px 28px 9px 12px", cursor: "pointer" }}>
                              <option value="">Skin tone</option>
                              <option value="F">F</option><option value="FM">FM</option><option value="MD">MD</option>
                              <option value="D1">D1</option><option value="D2">D2</option><option value="VD">VD</option>
                            </select>
                            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#ab1f10", fontSize: 11 }}>▾</span>
                          </div>
                          <div style={{ position: "relative", flex: 1 }}>
                            <select className="th-input" value={shade.undertone || ""} onChange={(e) => { const n = [...shades]; n[i].undertone = e.target.value; setShades(n); }} onClick={(e) => e.stopPropagation()}
                              style={{ ...GL.input, appearance: "none", paddingRight: 28, fontSize: 13, padding: "9px 28px 9px 12px", cursor: "pointer" }}>
                              <option value="">Undertone</option>
                              <option value="W">W — Warm</option><option value="N">N — Neutral</option><option value="C">C — Cool</option>
                            </select>
                            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#ab1f10", fontSize: 11 }}>▾</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 13, color: "#7b241c", fontWeight: 500 }}>
                            Tone: <b>{shade.skintone}</b> · UT: <b>{shade.undertone}</b>
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); const n = [...shades]; n[i].skintone = ""; n[i].undertone = ""; setShades(n); }}
                            style={{ background: "none", border: "none", fontSize: 13, color: "#ab1f10", cursor: "pointer", textDecoration: "underline" }}>Edit</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button className="th-btn-outline" onClick={() => setShades([...shades, { name: "", hex: "", skintone: "", undertone: "", link: "", price: "" }])}
              style={{ ...GL.btnOutline, marginTop: 14 }}>
              + Add Shade
            </button>
          </div>

          {/* Actions */}
          <div style={{ ...GL.card, padding: 26, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Actions</div>

            <button className="th-btn-primary" onClick={handleSave} style={GL.btnPrimary}>
              Send to S3
            </button>
          </div>

          {/* Export — lip only */}
          {isLipCategory(category) && (
            <div style={{ ...GL.card, padding: 26 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Export JS Array</div>
              <textarea
                id="th-export-textarea"
                readOnly
                value={exportText}
                rows={Math.min(10, Math.max(5, shades.length + 3))}
                style={{ ...GL.input, resize: "none", fontFamily: "monospace !important", fontSize: 13, lineHeight: 1.6, background: "rgba(171,31,16,0.03)" }}
              />
              <button className="th-btn-primary" onClick={copyExportText} style={{ ...GL.btnPrimary, marginTop: 12 }}>
                Copy to clipboard
              </button>
            </div>
          )}
        </div>

        {/* ── Right Panel ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Active shade indicator */}
          {shades[activeShadeIndex] && (
            <div style={{ ...GL.card, padding: "18px 24px", display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ width: 52, height: 52, borderRadius: 13, background: shades[activeShadeIndex].hex || "rgba(171,31,16,0.1)", border: shades[activeShadeIndex].hex ? "none" : "1.5px dashed rgba(171,31,16,0.3)", boxShadow: shades[activeShadeIndex].hex ? "0 3px 10px rgba(0,0,0,0.18)" : "none", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1a0a09" }}>
                  {shades[activeShadeIndex].name || <span style={{ color: "#b08080", fontStyle: "italic" }}>Unnamed shade</span>}
                </div>
                <div style={{ fontSize: 13, color: "#7b241c", fontFamily: "monospace", marginTop: 2 }}>
                  Active · {shades[activeShadeIndex].hex || "hover image to pick colour"}
                </div>
              </div>
              {lockedIndex === activeShadeIndex && (
                <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#ab1f10", background: "rgba(171,31,16,0.08)", padding: "5px 13px", borderRadius: 20 }}>locked</div>
              )}
              {lockedIndex === activeShadeIndex && (
                <button onClick={() => setLockedIndex(null)} style={{ background: "none", border: "1.5px solid rgba(171,31,16,0.3)", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: "#ab1f10", cursor: "pointer" }}>Unlock</button>
              )}
            </div>
          )}

          {/* Dropzone */}
          <div
            onDragEnter={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsOver(false); }}
            onDrop={onDrop}
            style={{ ...GL.card, padding: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", border: isOver ? "2px dashed #ab1f10" : "2px dashed rgba(171,31,16,0.2)", background: isOver ? "rgba(171,31,16,0.04)" : "rgba(255,255,255,0.45)", transition: "all 0.2s", cursor: "pointer" }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🖼</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#ab1f10", marginBottom: 8 }}>Drop images here</div>
            <div style={{ fontSize: 14, color: "#9b4a42" }}>or click to browse · PNG, JPG, WEBP, HEIC</div>
            <div style={{ fontSize: 13, color: "#c0a0a0", marginTop: 8 }}>{images.length}/{MAX_FILES} images loaded</div>
            <input ref={fileInputRef} type="file" accept={ACCEPT.join(",")} multiple onChange={onBrowse} style={{ display: "none" }} />
          </div>

          {/* Canvases */}
          {images.map((img, idx) => (
            <div key={img.id} style={{ position: "relative", borderRadius: 18, overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.1)" }}>
              <canvas
                ref={(el) => (canvasRefs.current[idx] = el)}
                onMouseMove={(e) => handleMouseMove(e, idx)}
                onClick={(e) => handleClick(e, idx)}
                style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
              />
              <img
                ref={(el) => (imgRefs.current[idx] = el)}
                src={img.dataUrl}
                alt={img.name || `Uploaded ${idx + 1}`}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0, pointerEvents: "none" }}
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                style={{ position: "absolute", top: 14, right: 14, width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.92)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#ab1f10", boxShadow: "0 2px 10px rgba(0,0,0,0.18)" }}
              >×</button>
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.48)", backdropFilter: "blur(4px)", color: "#fff", fontSize: 13, padding: "8px 16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {img.name}
              </div>
            </div>
          ))}
        </div>
      </div>

      <SBPickerPanel
        show={showSBPicker}
        hue={currentHue}
        onClose={() => setShowSBPicker(false)}
        activeShadeIndex={activeShadeIndex}
        shades={shades}
        setShades={setShades}
        pickerSize={448}
        panelWidth={520}
        swatchSize={56}
      />
    </div>
  );
}