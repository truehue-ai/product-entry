"use client";

// Asks for the action password (making products live, verifying) in an in-page box — not a browser
// prompt, which browsers can silently block. Remembered for this browser tab only (sessionStorage);
// the server checks it on every request, and a wrong one is forgotten and asked again.
//
//   const { runWithPassword, passwordModal } = useActionPassword();
//   const res = await runWithPassword((password) => fetch(url, { ..., body: JSON.stringify({ ...data, password }) }));
//   ...render {passwordModal} anywhere in the component.

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "th_action_password";
const read = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
const save = (p) => { try { sessionStorage.setItem(KEY, p); } catch { /* not remembered */ } };
const forget = () => { try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ } };

export function useActionPassword() {
  const [ask, setAsk] = useState(null); // { resolve, reject, error }

  const requestPassword = useCallback((error = "") => {
    const saved = read();
    if (saved && !error) return Promise.resolve(saved);
    return new Promise((resolve, reject) => setAsk({ resolve, reject, error }));
  }, []);

  // fn(password) must return a fetch Response. A 401 means a wrong password: ask again once.
  const runWithPassword = useCallback(async (fn) => {
    let res = await fn(await requestPassword());
    if (res.status === 401) {
      forget();
      res = await fn(await requestPassword("Wrong password — try again."));
      if (res.status === 401) forget();
    }
    return res;
  }, [requestPassword]);

  const passwordModal = ask ? (
    <PasswordModal
      error={ask.error}
      onSubmit={(p) => { save(p); setAsk(null); ask.resolve(p); }}
      onCancel={() => { setAsk(null); ask.reject(new Error("Password required")); }}
    />
  ) : null;

  return { runWithPassword, passwordModal };
}

function PasswordModal({ error, onSubmit, onCancel }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,10,9,0.35)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (value) onSubmit(value); }}
        style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 18, padding: "22px 22px 18px",
          boxShadow: "0 20px 60px rgba(171,31,16,0.25)", display: "flex", flexDirection: "column", gap: 12, fontFamily: "'Inter', sans-serif" }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1a0a09" }}>🔒 Password required</div>
        <div style={{ fontSize: 13, color: "#9b4a42" }}>
          Making products live and verifying them needs the action password. It's remembered until you close this tab.
        </div>
        <input
          ref={inputRef}
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
          style={{ background: "rgba(255,255,255,0.9)", border: `1.5px solid ${error ? "#c0392b" : "rgba(171,31,16,0.2)"}`, borderRadius: 11,
            padding: "11px 14px", fontSize: 15, color: "#1a0a09", outline: "none" }}
        />
        {error && <div style={{ fontSize: 13, fontWeight: 600, color: "#c0392b" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel}
            style={{ background: "rgba(255,255,255,0.7)", color: "#ab1f10", border: "1.5px solid rgba(171,31,16,0.3)", borderRadius: 11,
              padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={!value}
            style={{ background: "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)", color: "#fff", border: "none", borderRadius: 11,
              padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: value ? "pointer" : "not-allowed", opacity: value ? 1 : 0.5 }}>Unlock</button>
        </div>
      </form>
    </div>
  );
}
