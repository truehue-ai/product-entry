import React, { useRef, useEffect, useState } from "react";

export function rgbToHsb(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max, d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) { h = 0; }
  else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
}

function hsbToHex(h, s, v) {
  s /= 100; v /= 100;
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => v - v * s * Math.max(Math.min(k(n), 4 - k(n), 1), 0);
  const [r, g, b] = [f(5), f(3), f(1)].map(x =>
    Math.round(x * 255).toString(16).padStart(2, '0')
  );
  return `#${r}${g}${b}`;
}

export default function SBPickerPanel({
  show,
  hue,
  onClose,
  activeShadeIndex,
  shades,
  setShades,
  pickerSize = 384,
  panelWidth = 460,
  swatchSize = 52,
}) {
  const canvasRef = useRef();
  const [hoverHex, setHoverHex] = useState(null);
  const [hoverHSB, setHoverHSB] = useState(null);
  const [initialSB, setInitialSB] = useState(null);

  useEffect(() => {
    if (!show || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    for (let y = 0; y < height; y++) {
      const b = 100 - (y / height) * 100;
      for (let x = 0; x < width; x++) {
        const s = (x / width) * 100;
        ctx.fillStyle = hsbToHex(hue, s, b);
        ctx.fillRect(x, y, 1, 1);
      }
    }

    if (initialSB) {
      const [s, b] = initialSB;
      const x = (s / 100) * width;
      const y = ((100 - b) / 100) * height;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [hue, show, initialSB]);

  const hexToRgb = (hex) => {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  };

  useEffect(() => {
    if (!show || hue === null) return;
    if (!shades?.[activeShadeIndex]?.hex) return;
    const [h, s, b] = rgbToHsb(...hexToRgb(shades[activeShadeIndex].hex));
    if (Math.round(h) === Math.round(hue)) setInitialSB([s, b]);
  }, [show, hue, shades, activeShadeIndex]);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const s = (x / canvas.width) * 100;
    const b = 100 - (y / canvas.height) * 100;
    const hex = hsbToHex(hue, s, b);
    const next = [...shades];
    next[activeShadeIndex].hex = hex;
    setShades(next);
    setInitialSB(null);
    onClose();
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const s = (x / canvas.width) * 100;
    const b = 100 - (y / canvas.height) * 100;
    setHoverHex(hsbToHex(hue, s, b));
    setHoverHSB([Math.round(hue), Math.round(s), Math.round(b)]);
  };

  if (!show || hue === null) return null;

  const currentHex = shades?.[activeShadeIndex]?.hex;
  const currentName = shades?.[activeShadeIndex]?.name;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(26,10,9,0.25)", backdropFilter: "blur(2px)" }} />

      {/* Panel */}
      <div style={{
        position: "relative",
        height: "100%",
        width: panelWidth,
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        borderLeft: "1.5px solid rgba(255,255,255,0.85)",
        boxShadow: "-12px 0 48px rgba(171,31,16,0.1)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        fontFamily: "'Inter', sans-serif",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <style>{`* { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }`}</style>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(171,31,16,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a0a09" }}>Adjust Shade</div>
            {currentName && <div style={{ fontSize: 11, color: "#7b241c", marginTop: 2 }}>{currentName}</div>}
          </div>
          <button onClick={onClose} style={{ background: "rgba(171,31,16,0.08)", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#ab1f10", fontWeight: 700, lineHeight: 1 }}>×</button>
        </div>

        {/* Hue badge */}
        <div style={{ padding: "12px 24px 0" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#7b241c", background: "rgba(171,31,16,0.08)", padding: "4px 10px", borderRadius: 20, letterSpacing: "0.04em" }}>
            HUE {hue}°
          </span>
        </div>

        {/* Canvas */}
        <div style={{ padding: "14px 24px 0" }}>
          <canvas
            ref={canvasRef}
            width={pickerSize}
            height={pickerSize}
            style={{ width: "100%", height: "auto", display: "block", borderRadius: 14, cursor: "crosshair", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
          />
        </div>

        {/* Preview */}
        <div style={{ padding: "18px 24px 24px" }}>
          <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.9)", padding: "16px", display: "flex", gap: 14, alignItems: "center" }}>
            {/* Hover swatch */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <div style={{ width: swatchSize, height: swatchSize, borderRadius: 12, background: hoverHex || "rgba(171,31,16,0.08)", boxShadow: hoverHex ? "0 4px 12px rgba(0,0,0,0.2)" : "none", border: hoverHex ? "none" : "1.5px dashed rgba(171,31,16,0.2)", transition: "background 0.1s" }} />
              <div style={{ fontSize: 9, fontWeight: 600, color: "#9b4a42", letterSpacing: "0.04em", textTransform: "uppercase" }}>Hover</div>
            </div>

            {/* Arrow */}
            <div style={{ color: "rgba(171,31,16,0.3)", fontSize: 18 }}>→</div>

            {/* Current swatch */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <div style={{ width: swatchSize, height: swatchSize, borderRadius: 12, background: currentHex || "rgba(171,31,16,0.08)", boxShadow: currentHex ? "0 4px 12px rgba(0,0,0,0.2)" : "none", border: currentHex ? "none" : "1.5px dashed rgba(171,31,16,0.2)" }} />
              <div style={{ fontSize: 9, fontWeight: 600, color: "#9b4a42", letterSpacing: "0.04em", textTransform: "uppercase" }}>Current</div>
            </div>

            {/* Values */}
            {hoverHSB && (
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div style={{ fontFamily: "monospace", fontSize: 13, color: "#1a0a09", fontWeight: 600 }}>{hoverHex}</div>
                <div style={{ fontSize: 11, color: "#7b241c", marginTop: 4 }}>
                  H {hoverHSB[0]}° · S {hoverHSB[1]}% · B {hoverHSB[2]}%
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: "#9b4a42", textAlign: "center" }}>
            Click anywhere on the gradient to apply the colour
          </div>
        </div>
      </div>
    </div>
  );
}