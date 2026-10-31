"use client";

// Marketing Organiser — page shell, styles, small UI pieces and the data hook every tab uses.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WEEKDAYS, addDays, fmtDay, istToday, weekStart } from "./lib";
import InstaEmbed from "./InstaEmbed";

export const INK = "#1a0a09", MUTED = "#7b6b6b", BRAND = "#ab1f10";
export const RED = "#b91c1c", GREEN = "#15803d", AMBER = "#b45309";

export const GL = {
  panel: { background: "rgba(255,255,255,0.78)", borderRadius: 20, boxShadow: "0 4px 24px rgba(171,31,16,0.07)", padding: 20 },
  h: { fontSize: 18, fontWeight: 700, color: INK, margin: 0 },
  sub: { fontSize: 14, color: MUTED },
  btn: {
    background: BRAND, color: "#fff", border: "none", borderRadius: 12,
    padding: "10px 18px", fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  btnOutline: {
    background: "#fff", color: BRAND, border: "1.5px solid rgba(171,31,16,0.25)", borderRadius: 12,
    padding: "9px 16px", fontSize: 15, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  btnSmall: {
    background: "#fff", color: BRAND, border: "1.5px solid rgba(171,31,16,0.22)", borderRadius: 10,
    padding: "6px 12px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  input: {
    background: "#fff", border: "1.5px solid rgba(171,31,16,0.16)", borderRadius: 12, padding: "10px 12px",
    fontSize: 15, color: INK, outline: "none", minWidth: 0, width: "100%",
  },
  label: { fontSize: 14, fontWeight: 600, color: MUTED, display: "block", marginBottom: 6 },
};

// Category colours: a fixed dot + tint per category position (text stays in ink)
const TINTS = ["#fde2e0", "#e0ecfb", "#fdecd9", "#e3f4e6", "#efe4fb", "#fbe4f1", "#e2f3f4", "#f1efd9"];
const DOTS = ["#ab1f10", "#2a78d6", "#d97706", "#15803d", "#7c3aed", "#db2777", "#0e7490", "#854d0e"];
export function catColor(config, id) {
  const i = Math.max(0, config?.categories?.findIndex((c) => c.id === id) ?? 0);
  return { bg: TINTS[i % TINTS.length], dot: DOTS[i % DOTS.length] };
}

export function Tag({ config, categoryId, children, big }) {
  const c = catColor(config, categoryId);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.bg, color: "#3b2220", borderRadius: 999,
      padding: big ? "5px 12px" : "3px 10px", fontSize: big ? 14 : 13, fontWeight: 600, maxWidth: "100%" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: c.dot, flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </span>
  );
}

const STATUS_TONE = {
  Idea: "#9ca3af", Planned: "#2a78d6", Shot: "#d97706", "Shot/Designed": "#d97706", Edited: "#7c3aed",
  Scheduled: "#0e7490", Posted: GREEN, Live: GREEN, Paused: "#6b7280",
};
export function StatusPill({ status }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_TONE[status] || "#9ca3af" }} />{status}
    </span>
  );
}

export function Panel({ title, right, children, style }) {
  return (
    <section style={{ ...GL.panel, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {title && <h2 style={GL.h}>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

// ‹  3 – 9 Nov 2026  ›   Today
export function WeekNav({ ws, setWs, children }) {
  const thisWs = weekStart(istToday());
  const arrow = { ...GL.btnOutline, padding: "8px 14px", fontSize: 18, lineHeight: 1 };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button style={arrow} onClick={() => setWs(addDays(ws, -7))} aria-label="Previous week">‹</button>
      <span style={{ fontSize: 20, fontWeight: 700, color: INK, minWidth: 170, textAlign: "center" }}>
        {fmtDay(ws, { day: "numeric", month: "short" })} – {fmtDay(addDays(ws, 6), { day: "numeric", month: "short" })}
      </span>
      <button style={arrow} onClick={() => setWs(addDays(ws, 7))} aria-label="Next week">›</button>
      {ws !== thisWs && <button style={GL.btnSmall} onClick={() => setWs(thisWs)}>This week</button>}
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(40,10,8,0.4)", zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", overflowY: "auto", padding: "3vh 10px" }}>
      <div style={{ background: "#fffaf9", borderRadius: 20, width: "100%", maxWidth: wide ? 980 : 680, boxShadow: "0 24px 64px rgba(60,10,5,0.25)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: INK, minWidth: 0 }}>{title}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 28, color: "#7b241c", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>{children}</div>
        {footer && <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(171,31,16,0.08)", display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, style }) {
  return <label style={{ display: "flex", flexDirection: "column", minWidth: 0, ...style }}><span style={GL.label}>{label}</span>{children}</label>;
}

// Tap-to-pick row of options (status, category, format)
export function Choice({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          style={{ ...GL.btnSmall, ...(v === value ? { background: BRAND, color: "#fff", borderColor: BRAND } : { color: "#3b2220" }) }}>{label}</button>
      ))}
    </div>
  );
}

// Tap-to-toggle row (pick any number)
export function Toggles({ options, values, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(([v, label]) => {
        const on = values.includes(v);
        return (
          <button key={v} type="button" onClick={() => onChange(on ? values.filter((x) => x !== v) : [...values, v])}
            style={{ ...GL.btnSmall, ...(on ? { background: "rgba(171,31,16,0.12)", borderColor: BRAND, color: BRAND } : { color: "#3b2220" }) }}>
            {on ? "✓ " : "+ "}{label}
          </button>
        );
      })}
    </div>
  );
}

// A small live preview of a reel (Instagram's embed iframe, scaled down). Loads only when on screen.
const SAFE = /^[A-Za-z0-9_-]+$/;
export function ReelThumb({ shortcode, width = 96, onClick, selected }) {
  const ref = useRef(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (!("IntersectionObserver" in window)) { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const FRAME_W = 326, scale = width / FRAME_W, height = Math.round(width * 1.3);
  return (
    <button type="button" ref={ref} onClick={onClick} aria-label="Show reel"
      style={{ position: "relative", width, height, flexShrink: 0, borderRadius: 12, overflow: "hidden", padding: 0, cursor: "pointer",
        border: selected ? `3px solid ${BRAND}` : "1px solid rgba(171,31,16,0.12)", background: "linear-gradient(135deg,#fde8e4,#f9d0cc)" }}>
      {near && SAFE.test(shortcode || "") ? (
        <iframe src={`https://www.instagram.com/p/${shortcode}/embed`} title="Reel preview" loading="lazy" scrolling="no" tabIndex={-1}
          style={{ position: "absolute", top: -54 * scale, left: 0, width: FRAME_W, height: 700, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }} />
      ) : <span style={{ fontSize: 22 }}>🎬</span>}
      {selected && <span style={{ position: "absolute", top: 4, right: 4, background: BRAND, color: "#fff", borderRadius: 999, width: 22, height: 22, fontSize: 13, display: "grid", placeItems: "center" }}>✓</span>}
    </button>
  );
}

// The full reel in a pop-up
export function ReelModal({ inspo, onClose }) {
  if (!inspo) return null;
  return (
    <Modal title={inspo.notes ? inspo.notes.slice(0, 60) : "Inspo"} onClose={onClose}>
      <div style={{ maxWidth: 420, width: "100%", margin: "0 auto" }}><InstaEmbed shortcode={inspo.shortcode} kind={inspo.kind} /></div>
    </Modal>
  );
}

// Loads everything once; every change goes through `api(op, body)` and the response replaces what it changed.
export function useOrganiser(enabled) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(0);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch(`/api/marketing?t=${Date.now()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Could not load");
      setData(j);
    } catch (e) {
      setError(e?.message || "Could not load the organiser");
    }
  }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);

  // -> response JSON; throws (and shows a toast) on failure
  const api = useCallback(async (op, body = {}, { quiet } = {}) => {
    setSaving((n) => n + 1);
    try {
      const r = await fetch("/api/marketing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Could not save");
      setData((d) => ({ ...d, ...(j.config && { config: j.config }), ...(j.items && { items: j.items }), ...(j.inspo && { inspo: j.inspo }) }));
      return j;
    } catch (e) {
      if (!quiet) setToast(e?.message || "Could not save");
      throw e;
    } finally {
      setSaving((n) => n - 1);
    }
  }, []);

  // optimistic local change (e.g. drag to reschedule) before the server answers
  const patchLocal = useCallback((list, items) => {
    setData((d) => {
      if (!d) return d;
      const next = [...(d.items?.[list] || [])];
      for (const it of items) {
        const i = next.findIndex((x) => x.id === it.id);
        if (i >= 0) next[i] = it; else next.push(it);
      }
      return { ...d, items: { ...d.items, [list]: next } };
    });
  }, []);

  return { data, error, load, api, patchLocal, saving: saving > 0, toast, setToast };
}

export function Shell({ tab, setTab, saving, children }) {
  const router = useRouter();
  const tabs = [["organic", "Instagram"], ["ads", "Ads"], ["inspo", "Inspo"], ["settings", "Settings"]];
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif", color: INK }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .mo-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .mo-split { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
        .mo-side { position: sticky; top: 84px; }
        .mo-day { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 16px; padding: 16px 0; border-top: 1px solid rgba(171,31,16,0.08); }
        .mo-day:first-child { border-top: none; padding-top: 4px; }
        .mo-cards { display: flex; flex-wrap: wrap; gap: 10px; }
        .mo-card { width: 300px; max-width: 100%; cursor: pointer; transition: box-shadow .15s, transform .15s; }
        .mo-card:hover { box-shadow: 0 6px 18px rgba(171,31,16,0.14); }
        .mo-drop { background: rgba(171,31,16,0.05); border-radius: 14px; outline: 2px dashed ${BRAND}; outline-offset: 2px; }
        .mo-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .mo-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .mo-inspo { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; align-items: start; }
        /* Instagram embeds: fit the card (embed.js forces min-width 326px), drop its border/shadow, and crop
           the like / comment bar at the bottom */
        .mo-embed { width: 100%; overflow: hidden; border-radius: 14px; background: #fff; }
        .mo-embed iframe { display: block; width: 100% !important; min-width: 0 !important; max-width: 100% !important;
          margin: 0 0 -86px !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
        .mo-embed blockquote.instagram-media { min-width: 0 !important; width: 100% !important; margin: 0 !important; }
        @media (max-width: 1100px) {
          .mo-split { grid-template-columns: minmax(0, 1fr); }
          .mo-side { position: static; order: -1; }
        }
        @media (max-width: 700px) {
          .mo-day { grid-template-columns: minmax(0, 1fr); gap: 10px; }
          .mo-card { width: 100%; }
          .mo-2, .mo-3 { grid-template-columns: minmax(0, 1fr); }
          .mo-inspo { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>
      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.7)",
        borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "12px 28px", display: "flex", alignItems: "center",
        gap: 6, flexWrap: "wrap", position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <button className="mo-ghost" onClick={() => router.push("/")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: BRAND, padding: "9px 12px", borderRadius: 10 }}>← Home</button>
        {tabs.map(([k, label]) => (
          <button key={k} className="mo-ghost" onClick={() => setTab(k)}
            style={{ background: tab === k ? "rgba(171,31,16,0.1)" : "none", border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700,
              color: tab === k ? BRAND : "#7b241c", padding: "9px 14px", borderRadius: 10 }}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 14, color: MUTED }}>{saving ? "Saving…" : ""}</span>
      </div>
      <div className="m-pad" style={{ padding: "24px 28px 60px", maxWidth: 1440, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, onClose }) {
  if (!text) return null;
  return (
    <div role="status" onClick={onClose}
      style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#3b0d08", color: "#fff", padding: "12px 18px",
        borderRadius: 14, fontSize: 15, fontWeight: 500, zIndex: 200, maxWidth: "calc(100% - 32px)", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", cursor: "pointer" }}>
      {text}
    </div>
  );
}

export const dayName = (day) => WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
export const dayLabel = (day) => (day ? `${dayName(day)} ${fmtDay(day, { day: "numeric", month: "short" })}` : "—");
