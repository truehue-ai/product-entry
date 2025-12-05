'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";

import SBPickerPanel from "./SBPickerPanel"; // adjust path if needed
import { rgbToHsb } from "./SBPickerPanel"; // optional if it's not already in same file

// Treat these as "lip" categories
const LIP_CATEGORIES = [
  "matte-lipstick",
  "satin-lipstick",
  "lip-gloss",
  "lip-tint",
  "lip-balm",
];

const isLipCategory = (c) => LIP_CATEGORIES.includes(c);

// Quick reader to DataURL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Convert #rrggbb or #rgb to {r,g,b}
function hexToRgb(hex) {
  if (!hex) return null;
  let clean = hex.trim().replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((ch) => ch + ch).join("");
  }
  if (clean.length !== 6) return null;

  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

// Decide skin tone from S,B (0–100)
// NOTE: I’m assuming Fair = brightest (B > 85 & low S). 
// Adjust thresholds if you want to tweak the bands.
function classifySkinToneFromSB(s, b) {
  // --- F ---
  // F: B > 85 AND S <= 50
  if (b > 90 && s <= 50) {
    return "F";
  }

  // --- FM ---
  // if B > 80 and S >= 50
  // otherwise B > 75 and S <= 60
  if ((b > 85 && s >= 50) || (b > 80 && s <= 45 && s >= 40)) {
    return "FM";
  }

  // --- MD ---
  // B > 70 and S >= 50
  // OR B < 70 and S <= 50 and S >= 40
  if ((b > 75 && s >= 40) || (b > 70 && s <= 45 && s >= 40)) {
    return "MD";
  }

  // --- D1 ---
  // B > 55 and S >= 50
  // OR if 45 <= S <= 50 then B < 55
  if ((b > 65 && s >= 55) || (s >= 45 && s <= 50 && b > 50)) {
    return "D1";
  }

  // --- D2 ---
  // 40 < B < 55   (unchanged because you only asked to adjust S)
  if (b >= 48) {
    return "D2";
  }

  // --- VD ---
  // B < 40
  if (b < 48) {
    return "VD";
  }

  return "";
}


// Decide undertone from H (0–360)
function classifyUndertoneFromHue(h, s, b) {
  if (Number.isNaN(h)) return "";

  // -------------------------------
  // CASE 1: Very bright shades
  // -------------------------------
  if (b > 90) {
    if (h >= 0 && h <= 25) return "C";       // Cool
    if (h > 25 && h <= 28) return "N";       // Neutral
    return "W";                              // Warm
  }

  // -------------------------------
  // CASE 2: Low saturation + not super bright
  // -------------------------------
  if (s <= 45 && b < 90) {
    if (h >= 0 && h <= 25) return "C";       // Cool
    return "N";                              // Everything else Neutral
  }

  // -------------------------------
  // CASE 3: Normal rule
  // -------------------------------
  if (h >= 0 && h < 20) return "C";          // Cool
  if (h >= 20 && h < 24) return "N";        // Neutral
  if (h >= 24) return "W";                    // Warm

  return "";
}



export default function ColorPickerTool({ initialBrand = "", initialProduct = "" }) {

  const router = useRouter();

  const [brand, setBrand] = useState(initialBrand);
  const [product, setProduct] = useState(initialProduct);
  const [category, setCategory] = useState("lip");
  const [shades, setShades] = useState([{ name: "", hex: "", skintone: "", undertone: "", link: "", price: "" }]);
  const [activeShadeIndex, setActiveShadeIndex] = useState(0);

  // ===== Images: drag & drop multi-upload =====
  const [images, setImages] = useState([]); // [{id, name, dataUrl}]
  const canvasRefs = useRef([]);            // array of canvas refs (by index)
  const imgRefs = useRef([]);               // array of hidden img refs (by index)
  const fileInputRef = useRef(null);
  const [isOver, setIsOver] = useState(false);
  const ACCEPT = ["image/png","image/jpeg","image/webp","image/gif","image/heic","image/heif"];
  const MAX_FILES = 50;

  // add files (FileList or array<File>)
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
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onBrowse = useCallback(async (e) => {
    if (e.target.files?.length) await addFiles(e.target.files);
    e.target.value = ""; // allow same file selection again
  }, [addFiles]);

  const removeImage = useCallback((id) => {
    setImages(prev => prev.filter(p => p.id !== id));
    // canvas/img refs will shift; safe due to index-based mapping below
  }, []);
  // ===== end drag & drop =====

  const [productType, setProductType] = useState("");
  const [tags, setTags] = useState("");  
  const [lockedIndex, setLockedIndex] = useState(null);
  const [showSBPicker, setShowSBPicker] = useState(false);
  const [currentHue, setCurrentHue] = useState(null);
  const [coverage, setCoverage] = useState("");
  const [finish, setFinish] = useState("");

  const canvasRef = useRef(); // (kept from original; unused in new multi-image flow)
  const imageRef = useRef();  // (kept from original; unused in new multi-image flow)

  // ===== Canvas drawing when images array updates =====
  useEffect(() => {
    images.forEach((imgObj, idx) => {
      const imgEl = imgRefs.current[idx];
      const canvasEl = canvasRefs.current[idx];
      if (!imgEl || !canvasEl || !imgObj?.dataUrl) return;

      const ctx = canvasEl.getContext("2d");
      imgEl.onload = () => {
        // Set canvas to natural size for accurate pixel sampling
        canvasEl.width = imgEl.naturalWidth;
        canvasEl.height = imgEl.naturalHeight;
        ctx.drawImage(imgEl, 0, 0);
      };
      imgEl.src = imgObj.dataUrl;
    });
  }, [images]);

  // ===== Color pick from canvas (hover to preview, click to lock & open SB panel) =====
  const handleMouseMove = (e, idx) => {
    const canvas = canvasRefs.current[idx];
    if (!canvas || lockedIndex === activeShadeIndex) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // clamp to integer pixel coords
    const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor(y)));

    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hex = `#${[pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    const newShades = [...shades];
    newShades[activeShadeIndex].hex = hex;
    setShades(newShades);
  };

  const handleClick = (e, idx) => {
    const canvas = canvasRefs.current[idx];
    if (!canvas) {
      console.warn("Canvas not ready");
      return;
    }
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // clamp to integer pixel coords
    const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor(y)));

    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const [r, g, b] = pixel;
    const [h] = rgbToHsb(r, g, b);
    setCurrentHue(h);
    setShowSBPicker(true);
    setLockedIndex(activeShadeIndex);
  };

  const handleSave = async () => {
    if (!brand || !product || !category ) {
      alert("Brand, Product, and Category are required!");
      return;
    }
  
    const filteredShades = shades.filter(s => s.name && s.hex);
  
    // Build shade structure for upload
    let structuredShades;
    if (category === "foundation" || category === "contour" || category === "concealer" || category === "skin-tint") {
      structuredShades = filteredShades.map(s => ({
        name: s.name,
        hex: s.hex,
        skintone: s.skintone,
        undertone: s.undertone
      }));
    } else {
      structuredShades = filteredShades.map(s => ({
        name: s.name,
        hex: s.hex
      }));
    }
  
    // Upload shades.json
    const res = await fetch('/api/upload-shades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand,
        product,
        category,
        shades: structuredShades
      })
    });
  
    let result = {};
    try {
      result = await res.json();
    } catch (err) {
      alert("Upload failed: invalid response");
      return;
    }
  
    // Upload links.json
    const linkMap = {};
    filteredShades.forEach(s => {
      if (s.link) linkMap[s.name] = s.link;
    });
  
    if (Object.keys(linkMap).length > 0) {
      await fetch('/api/upload-links-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          product,
          links: linkMap
        })
      });
    }

    // Upload price.json
    const priceMap = {};
    filteredShades.forEach(s => {
      if (s.price) priceMap[s.name] = s.price;
    });
  
    if (Object.keys(priceMap).length > 0) {
      await fetch('/api/upload-price-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          product,
          price: priceMap
        })
      });
    }

    // Upload types.json
    const typeMap = {};
    filteredShades.forEach(s => {
      if (category) typeMap[s.name] = category;
    });
  
    if (Object.keys(typeMap).length > 0) {
      await fetch('/api/upload-type-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          product,
          type: typeMap
        })
      });
    }
  
    if (result.success) {
      alert("Shades and links uploaded to S3 successfully!");
    
      // 👇 Add this
      await fetch('/api/update-all-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          product,
          type: category
        })
      });
    
    } else {
      alert("Upload failed: " + (result.error || "Unknown error"));
    }
    
  };

  const handleAddToProductDatabase = async () => {
    if (!brand || !product) {
      alert("Brand and Product name are required!");
      return;
    }
  
    const filteredShades = shades.filter(s => s.name && s.hex && s.price);
  
    // Base payload with all required fields
    const payload = filteredShades.map(s => {
      const base = {
        brand,
        product_name: product,
        shade_name: s.name,
        shade_hex_code: s.hex,
        price: s.price,
        link: s.link || "",
        type: s.category
      };
  
      if (["foundation", "concealer", "skin-tint"].includes(category)) {
        base.coverage = coverage;
        base.skintone = s.skintone;  // Needed for backend to determine L/M/D
      }

      if (["contour"].includes(category)) {
        base.finish = finish;
        base.skintone = s.skintone;  // Needed for backend to determine L/M/D
      }
  
      return base;
    });
  
    if (["foundation", "concealer", "skin-tint"].includes(category) && !coverage) {
      alert("Please select coverage (Low, Medium, Full) for this product.");
      return;
    }

    if (["contour"].includes(category) && !finish) {
      alert("Please select finish for this product.");
      return;
    }
  
    const res = await fetch('/api/add-to-product-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shades: payload,
        product_category: category,
      })
    });
  
    const result = await res.json();
    if (result.success) {
      alert("Shades successfully added to product database!");
    } else {
      alert("Failed to update product database.");
    }
  };

  const handleSendToShopify = async () => {
    if (!brand || !product || !productType || !tags) {
      alert("All fields are required!");
      return;
    }

    console.log("Sending to Shopify:", JSON.stringify({
      product: {
        title: product,
        vendor: brand,
        product_type: productType,
        tags,
        published: true,
      }
    }, null, 2));
    
    const res = await fetch('/api/shopify-create-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: product,
        vendor: brand,
        productType,
        tags
      })
    });
  
    const result = await res.json();
  
    if (result.success) {
      alert("Product added to Shopify!");
    } else {
      alert("Failed to add product: " + result.error);
    }
  };

  const handleTriggerPhotoshop = () => {
    console.log("Triggered Photoshop for:", { brand, product, category, shades });
    alert("Photoshop action triggered (placeholder).")
  };

  const logout = () => {
    // clear cookie by expiring it
    document.cookie = 'th_auth=; Max-Age=0; Path=/; SameSite=Lax';
    localStorage.removeItem('th_user');
    router.push('/login');
  };

  const exportText = useMemo(() => {
    const headerLabel = product
      ? `// ${product}`
      : `// ${category?.replace(/-/g, " ") || "Shades"}`;
    const rows = shades
      .filter(s => s.name && s.hex)
      .map(s => `    {name: "${s.name}",   hex: "${s.hex}"}`)
      .join(",\n");
  
    return `var shades = [\n    ${headerLabel}\n${rows}\n];`;
  }, [shades, product, category]);
  
  const copyExportText = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      alert("Copied to clipboard!");
    } catch (e) {
      const ta = document.getElementById("th-export-textarea");
      if (ta) {
        ta.focus();
        ta.select();
      }
    }
  };

  // Load existing (kept as-is)
  useEffect(() => {
    const load = async () => {
      if (!initialBrand || !initialProduct) return;
      const r = await fetch(`/api/logs/get?brand=${encodeURIComponent(initialBrand)}&product=${encodeURIComponent(initialProduct)}`, { cache: "no-store" });
      const j = await r.json();
      if (j?.shades) {
        setBrand(j.brand);
        setProduct(j.product);
      
        // NEW: prefer API-level productType; fallback to first shade's type
        const inferredType =
          j.productType ||
          (j.shades.find((s) => !!s.type)?.type ?? "");
      
        if (inferredType) setCategory(inferredType);
      
        setShades(
          j.shades.map((s) => ({
            name: s.name || "",
            hex: s.hex || "",
            skintone: s.skintone || "",
            undertone: s.undertone || "",
            link: s.link || "",
            price: s.price || "",
          }))
        );
      }
    };
    load();
  }, [initialBrand, initialProduct]);

  const deleteShade = (index) => {
    setShades(prev => {
      if (prev.length === 1) {
        // keep one empty row so the UI never goes blank
        setActiveShadeIndex(0);
        setLockedIndex(null);
        return [{ name: "", hex: "", skintone: "", undertone: "", link: "", price: "" }];
      }
  
      const next = [...prev];
      next.splice(index, 1);
  
      // fix active/locked indices
      setActiveShadeIndex(curr => {
        if (curr === index) return Math.max(0, index - 1);
        if (curr > index) return curr - 1;
        return curr;
      });
      setLockedIndex(curr => {
        if (curr == null) return curr;
        if (curr === index) return null;
        if (curr > index) return curr - 1;
        return curr;
      });
  
      return next;
    });
  };

    const autoCategorizeFaceShades = () => {
    // Only for foundation / concealer as you requested
    if (!["foundation", "concealer"].includes(category)) {
      alert("Auto-categorize works only for foundation and concealer.");
      return;
    }

    setShades((prevShades) =>
      prevShades.map((shade) => {
        if (!shade.hex) return shade;

        const rgb = hexToRgb(shade.hex);
        if (!rgb) return shade;

        const [h, s, b] = rgbToHsb(rgb.r, rgb.g, rgb.b); // s,b in 0–100
        const skintone = classifySkinToneFromSB(s, b);
        const undertone = classifyUndertoneFromHue(h, s, b);

        return {
          ...shade,
          // Only overwrite if we actually classified something
          skintone: skintone || shade.skintone || "",
          undertone: undertone || shade.undertone || "",
        };
      })
    );
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-rose-100 font-sans p-6">
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Roboto+Mono:wght@500&display=swap" rel="stylesheet" />
      <style>{`
        h1, h2 { font-family: 'Playfair Display', serif; }
        button { font-family: 'Roboto Mono', monospace; }
      `}</style>
      <div className="max-w-7xl mx-auto mb-4 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            className="px-4 py-2 bg-white text-[#ab1f10] border border-[#ab1f10] rounded hover:bg-rose-100"
            onClick={() => router.push('/logs')}
            type="button"
          >
            View Logs
          </button>
        </div>
        <button
          className="px-4 py-2 bg-[#ab1f10] text-white rounded hover:bg-red-700"
          onClick={logout}
          type="button"
        >
          Logout
        </button>
      </div>

      <div className="max-w-7xl mx-auto bg-white shadow-xl rounded-2xl overflow-hidden flex flex-col md:flex-row">
        {/* Left column: controls */}
        <div className="w-full md:w-1/3 p-6 space-y-4 bg-rose-50">
          <h1 className="text-2xl font-bold text-[#ab1f10] mb-4">TrueHue Shade Capture</h1>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-[#ab1f10]">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-2 border border-rose-200 rounded text-black"
            >
              <option value="matte-lipstick">Matte Lipstick</option>
              <option value="satin-lipstick">Satin Lipstick</option>
              <option value="lip-gloss">Lip Gloss / Lip Oil</option>
              <option value="lip-tint">Lip Tint / Lip Stain</option>
              <option value="lip-balm">Lip Balm</option>
              <option value="foundation">foundation</option>
              <option value="concealer">Concealer</option>
              <option value="skin-tint">Skin Tint</option>
              <option value="cream-blush">Cream Blush / Liquid Blush</option>
              <option value="powder-blush">Powder Blush</option>
              <option value="contour">Contour</option>
              <option value="cream-eyeshadow">Cream Eyeshadow</option>
              <option value="powder-eyeshadow">Powder Eyeshadow</option>
            </select>
          </div>

          <input
            className="w-full p-2 border border-rose-200 rounded text-black"
            placeholder="Brand Name"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
          <input
            className="w-full p-2 border border-rose-200 rounded text-black"
            placeholder="Product Name"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
          />

          <input
            className="w-full p-2 border border-rose-200 rounded text-black"
            placeholder="Type"
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
          />
          {["foundation", "concealer", "skin-tint"].includes(category) && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[#ab1f10]">Coverage</label>
              <select
                value={coverage}
                onChange={(e) => setCoverage(e.target.value)}
                className="w-full p-2 border border-rose-200 rounded text-black"
              >
                <option value="">Select Coverage</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="full">Full</option>
              </select>
            </div>
          )}

          {["contour"].includes(category) && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[#ab1f10]">Finish</label>
              <select
                value={finish}
                onChange={(e) => setFinish(e.target.value)}
                className="w-full p-2 border border-rose-200 rounded text-black"
              >
                <option value="">Select Finish</option>
                <option value="cream">Cream</option>
                <option value="powder">Powder</option>
              </select>
            </div>
          )}

          <input
            className="w-full p-2 border border-rose-200 rounded text-black"
            placeholder="Tags (comma separated)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />

          <h2 className="text-lg font-semibold mt-6 text-[#ab1f10]">Shades</h2>

          {["foundation", "concealer"].includes(category) && (
            <button
              type="button"
              onClick={autoCategorizeFaceShades}
              className="mb-3 w-full px-4 py-2 rounded border border-rose-300 bg-white text-sm font-medium text-[#ab1f10] hover:bg-rose-100"
            >
              Auto-detect skin tone & undertone from hex
            </button>
          )}


          {shades.map((shade, i) => (
            <div key={i} className="space-y-1">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    className="flex-grow p-2 border border-rose-200 rounded text-black placeholder:text-gray-400 min-w-0"
                    placeholder="Shade Name"
                    value={shade.name}
                    onChange={(e) => {
                      const newShades = [...shades];
                      newShades[i].name = e.target.value;
                      setShades(newShades);
                    }}
                    onFocus={() => {
                      setActiveShadeIndex(i);
                      setLockedIndex(null);
                    }}
                  />

                  <div
                    className="w-10 h-10 shrink-0 rounded border border-gray-300"
                    style={{ backgroundColor: shade.hex }}
                  />
                  <span className="w-[80px] text-sm font-mono text-black">{shade.hex}</span>

                  <input
                    className="flex-grow p-2 border border-rose-200 rounded text-black placeholder:text-gray-400 min-w-0"
                    placeholder="Product Link"
                    value={shade.link || ""}
                    onChange={(e) => {
                      const newShades = [...shades];
                      newShades[i].link = e.target.value;
                      setShades(newShades);
                    }}
                  />

                  <input
                    className="flex-grow p-2 border border-rose-200 rounded text-black placeholder:text-gray-400 min-w-0"
                    placeholder="Price (e.g. 1299.99)"
                    type="number"
                    value={shade.price || ""}
                    onChange={(e) => {
                      const newShades = [...shades];
                      newShades[i].price = parseFloat(e.target.value);
                      setShades(newShades);
                    }}
                  />

                  <button
                    type="button"
                    aria-label={`Delete shade ${shade.name || i + 1}`}
                    title="Delete shade"
                    onClick={() => deleteShade(i)}
                    className="shrink-0 px-3 py-2 rounded border border-rose-200 text-rose-700 hover:bg-rose-100"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {(category === "foundation" || category === "contour" || category === "concealer" || category === "skin-tint")  && (
                <div className="flex flex-col gap-2 pt-1">
                  {!(shade.skintone && shade.undertone) ? (
                    <>
                      <select
                        className="p-2 border border-rose-200 rounded text-black"
                        value={shade.skintone || ""}
                        onChange={(e) => {
                          const newShades = [...shades];
                          newShades[i].skintone = e.target.value;
                          setShades(newShades);
                        }}
                      >
                        <option value="">Select Skin Tone</option>
                        <option value="F">F</option>
                        <option value="FM">FM</option>
                        <option value="MD">MD</option>
                        <option value="D1">D1</option>
                        <option value="D2">D2</option>
                        <option value="VD">VD</option>
                      </select>

                      <select
                        className="p-2 border border-rose-200 rounded text-black"
                        value={shade.undertone || ""}
                        onChange={(e) => {
                          const newShades = [...shades];
                          newShades[i].undertone = e.target.value;
                          setShades(newShades);
                        }}
                      >
                        <option value="">Select Undertone</option>
                        <option value="W">W</option>
                        <option value="N">N</option>
                        <option value="C">C</option>
                      </select>
                    </>
                  ) : (
                    <div className="flex items-center justify-between text-sm text-gray-600 italic pl-1">
                      <span>
                        Skin Tone: <span className="font-medium">{shade.skintone}</span> | Undertone: <span className="font-medium">{shade.undertone}</span>
                      </span>
                      <button
                        className="text-blue-500 text-xs ml-2 underline"
                        onClick={() => {
                          const newShades = [...shades];
                          newShades[i].skintone = "";
                          newShades[i].undertone = "";
                          setShades(newShades);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <button
            className="px-4 py-2 bg-white text-[#ab1f10] border border-[#ab1f10] rounded w-full hover:bg-rose-100 "
            onClick={() => setShades([...shades, { name: "", hex: "", skintone: "", undertone: "" }])}
          >
            + Add Shade
          </button>

          {category === "lip" && (
            <button
              className="px-4 py-2 bg-[#ab1f10] hover:bg-red-700 text-white border border-[#ab1f10] rounded w-full"
              onClick={handleTriggerPhotoshop}
            >
              Trigger Photoshop
            </button>
          )}

          <button
            className="px-4 py-2 bg-[#ab1f10] hover:bg-red-700 text-white border border-[#ab1f10] rounded w-full"
            onClick={handleSave}
          >
            Send to S3
          </button>

          <button
            className="px-4 py-2 bg-[#ab1f10] hover:bg-red-700 text-white border border-[#ab1f10] rounded w-full"
            onClick={handleAddToProductDatabase}
          >
            Add to Product Database 
          </button>

          {/* --- Export (JS array) — only for lip categories --- */}
          {isLipCategory(category) && (
            <div className="mt-6 space-y-2">
              <h2 className="text-lg font-semibold text-[#ab1f10]">
                Export Shades (JS array)
              </h2>

              <textarea
                id="th-export-textarea"
                readOnly
                value={exportText}
                rows={Math.min(12, Math.max(6, shades.length + 4))}
                className="w-full p-3 border border-rose-200 rounded text-black font-mono text-sm bg-rose-50"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copyExportText}
                  className="px-4 py-2 bg-[#ab1f10] hover:bg-red-700 text-white rounded"
                >
                  Copy
                </button>
                <span className="text-xs text-gray-500 self-center">
                  Format: <code>var shades = [&#123;name, hex&#125; ...]</code>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right column: images (drag & drop + list of canvases) */}
        <div className="w-full md:w-2/3 p-6 flex flex-col items-center">
          {/* Dropzone */}
          <div
            onDragEnter={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsOver(false); }}
            onDrop={onDrop}
            className={[
              "w-full max-w-2xl flex flex-col items-center justify-center text-center rounded-2xl border-2 border-dashed transition p-6",
              isOver ? "border-[#ab1f10] bg-[#fff8f7]" : "border-gray-300 bg-white"
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Browse images
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT.join(",")}
              multiple
              onChange={onBrowse}
              className="hidden"
            />
            <p className="mt-2 text-sm text-gray-600">
              Drag & drop images here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {images.length}/{MAX_FILES} images
            </p>
          </div>

          {/* Render each image canvas below */}
          <div className="w-full mt-6 flex flex-col gap-6 items-center">
            {images.map((img, idx) => (
              <div key={img.id} className="w-full max-w-2xl relative">
                <canvas
                  ref={(el) => (canvasRefs.current[idx] = el)}
                  onMouseMove={(e) => handleMouseMove(e, idx)}
                  onClick={(e) => handleClick(e, idx)}
                  className="w-full h-auto border rounded shadow-md"
                />
                <img
                  ref={(el) => (imgRefs.current[idx] = el)}
                  src={img.dataUrl}
                  alt={img.name || `Uploaded ${idx+1}`}
                  className="w-full h-auto object-contain rounded absolute top-0 left-0 opacity-0 pointer-events-none"
                />
                {/* Delete button */}
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => removeImage(img.id)}
                  className="absolute top-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[#ab1f10] shadow hover:bg-white"
                  title="Remove"
                >
                  ✕
                </button>
                {/* Filename footer */}
                <div className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs px-2 py-1 truncate rounded-b">
                  {img.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SB Picker Panel (unchanged) */}
      <SBPickerPanel
        show={showSBPicker}
        hue={currentHue}
        onClose={() => setShowSBPicker(false)}
        activeShadeIndex={activeShadeIndex}
        shades={shades}
        setShades={setShades}
        pickerSize={448}     // e.g., 448 or 512
        panelWidth={520}
        swatchSize={56}
      />
    </div>
  );
}
