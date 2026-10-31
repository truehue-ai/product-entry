"use client";

// An Instagram reel / post via the official embed (blockquote + embed.js). Only built once the card is near the
// screen. If embed.js doesn't turn it into an iframe within a few seconds, falls back to the plain /embed iframe.

import { useEffect, useRef, useState } from "react";

let igScript = null; // one load of embed.js per page
function loadInstagram() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.instgrm?.Embeds) return Promise.resolve(window.instgrm);
  if (!igScript) {
    igScript = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://www.instagram.com/embed.js";
      s.async = true;
      s.onload = () => resolve(window.instgrm);
      s.onerror = () => { igScript = null; s.remove(); reject(new Error("embed.js failed")); };
      document.body.appendChild(s);
    });
  }
  return igScript;
}

const SAFE = /^[A-Za-z0-9_-]+$/;

export default function InstaEmbed({ shortcode, kind = "reel", compact = false }) {
  const wrap = useRef(null);
  const box = useRef(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const ok = SAFE.test(shortcode || "");
  const permalink = `https://www.instagram.com/${kind === "p" ? "p" : "reel"}/${shortcode}/`;

  // lazy: wait until the card is within ~1.5 screens
  useEffect(() => {
    const el = wrap.current;
    if (!el || near) return;
    if (!("IntersectionObserver" in window)) { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  // embed.js replaces the blockquote with its own iframe, so React never owns that DOM — it lives inside `box`
  useEffect(() => {
    const el = box.current;
    if (!near || failed || !ok || !el) return;
    el.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${permalink}" data-instgrm-version="14" ` +
      `style="background:#fff;border:0;margin:0;max-width:100%;min-width:0;width:100%;padding:0;"></blockquote>`;
    let alive = true;
    loadInstagram().then((ig) => { if (alive) ig?.Embeds?.process(); }).catch(() => { if (alive) setFailed(true); });
    const t = setTimeout(() => { if (alive && !el.querySelector("iframe")) setFailed(true); }, 6000);
    return () => { alive = false; clearTimeout(t); el.innerHTML = ""; };
  }, [near, failed, ok, permalink]);

  if (!ok) return <div style={{ fontSize: 12, color: "#9b8b88", padding: 12 }}>Invalid Instagram link</div>;

  return (
    <div ref={wrap} style={{ minHeight: near ? undefined : (compact ? 260 : 480), width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
      {failed ? (
        <>
          <div className="mo-embed">
            <iframe src={`https://www.instagram.com/p/${shortcode}/embed`} title="Instagram post" loading="lazy"
              style={{ height: compact ? 420 : 600, background: "#fff" }} allowFullScreen />
          </div>
          <a href={permalink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: "#ab1f10" }}>Open on Instagram ↗</a>
        </>
      ) : (
        <div ref={box} className="mo-embed" style={{ minHeight: compact ? 260 : 400, background: near ? "#fff" : "rgba(255,255,255,0.5)" }} />
      )}
    </div>
  );
}
