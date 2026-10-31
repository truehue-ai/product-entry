"use client";

// Inspo library: paste an Instagram reel / post, tag it, then attach it to a post or ad (here, or from the post itself).

import { useEffect, useMemo, useState } from "react";
import { catById, conceptName, findCategory, findConcept, fmtDay, inspoInCat, istToday, itemTitle, normaliseInsta, tidyName } from "./lib";
import { BRAND, Choice, GL, GREEN, INK, MUTED, Modal, Panel, RED, Tag, Toggles, dayLabel } from "./ui";
import InstaEmbed from "./InstaEmbed";

const NEW = "__new__";

// Ads can be combined with other categories: an Ads reel can also be for Fun, a Fun reel can also be for Ads.
function alsoOptions(config, main) {
  const adsId = config.ads?.categoryId;
  if (!main) return [];
  if (main === adsId) return config.categories.filter((c) => c.id !== adsId).map((c) => [c.id, c.name]);
  const ads = catById(config, adsId);
  return ads ? [[ads.id, `Also for ${ads.name}`]] : [];
}

export default function InspoTab({ config, inspo, items, api }) {
  const [url, setUrl] = useState("");
  const [cat, setCat] = useState("");
  const [concept, setConcept] = useState("");
  const [newConcept, setNewConcept] = useState(""); // typed when concept === NEW
  const [newCat, setNewCat] = useState(""); // typed when cat === NEW
  const [also, setAlso] = useState([]); // other categories this reel is also for
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);
  const [fCat, setFCat] = useState("");
  const [fConcept, setFConcept] = useState("");
  const [q, setQ] = useState("");
  const [attachFor, setAttachFor] = useState(null);

  const conceptsOf = (id) => catById(config, id)?.concepts || [];

  const save = async () => {
    const n = normaliseInsta(url);
    if (n.error) { setMsg({ ok: false, text: n.error }); return; }
    if (inspo.some((x) => x.shortcode === n.shortcode)) { setMsg({ ok: false, text: "Already saved." }); return; }
    // typed names: an existing category / concept with the same name (any case) is used instead of a duplicate
    const typedCat = cat === NEW ? tidyName(newCat) : "";
    if (!cat || (cat === NEW && !typedCat)) { setMsg({ ok: false, text: cat === NEW ? "Type the category name." : "Pick a category." }); return; }
    const knownCat = typedCat ? findCategory(config, typedCat) : null;
    const catId = cat === NEW ? knownCat?.id || "" : cat;
    const typed = concept === NEW ? tidyName(newConcept) : "";
    if (concept === NEW && !typed && cat !== NEW) { setMsg({ ok: false, text: "Type the concept name." }); return; }
    const known = typed ? findConcept(config, typed) : null;
    if (known && known.cat.id !== catId) { setMsg({ ok: false, text: `"${known.concept.name}" is already a concept in ${known.cat.name}.` }); return; }
    const body = {
      ...(catId ? { categoryId: catId } : { newCategory: typedCat }),
      ...(typed && !known ? { newConcept: typed } : { conceptId: known ? known.concept.id : concept === NEW ? "" : concept }),
    };
    setBusy(true); setMsg(null);
    try {
      const j = await api("addInspo", { url, notes, alsoCategoryIds: also.filter((id) => id !== catId), ...body }, { quiet: true });
      const saved = j.inspo?.[0];
      setUrl(""); setNotes(""); setNewConcept(""); setNewCat("");
      setCat(saved?.categoryId || "");
      setAlso(saved?.alsoCategoryIds || []);
      setConcept(saved?.conceptId || "");
      setMsg({ ok: true, text: "Saved ✓" });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Could not save" });
    } finally { setBusy(false); }
  };

  const usedIn = useMemo(() => {
    const m = {};
    for (const [list, arr] of [["organic", items.organic || []], ["ads", items.ads || []]]) {
      for (const it of arr) for (const id of it.inspoIds || []) (m[id] ||= []).push({ list, it });
    }
    return m;
  }, [items]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return inspo.filter((x) => (!fCat || inspoInCat(x, fCat)) && (!fConcept || x.conceptId === fConcept) && (!s || (x.notes || "").toLowerCase().includes(s)))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }, [inspo, fCat, fConcept, q]);

  // new cards process themselves as they mount; this picks up any blockquote embed.js hasn't handled yet
  const shownKey = shown.map((x) => x.id).join(",");
  useEffect(() => { window.instgrm?.Embeds?.process(); }, [shownKey]);

  return (
    <>
      <Panel title="Save a reel">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input style={{ ...GL.input, fontSize: 16 }} value={url} onChange={(e) => { setUrl(e.target.value); setMsg(null); }}
            placeholder="Paste Instagram link" onKeyDown={(e) => e.key === "Enter" && save()} inputMode="url" />
          <Choice options={[...config.categories.map((c) => [c.id, c.name]), [NEW, "+ New category"]]} value={cat} onChange={(v) => { setCat(v); setAlso([]); setConcept(v === NEW ? NEW : ""); }} />
          {alsoOptions(config, cat).length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {cat === config.ads?.categoryId && <span style={{ fontSize: 14, fontWeight: 600, color: MUTED }}>Also for</span>}
              <Toggles options={alsoOptions(config, cat)} values={also} onChange={setAlso} />
            </div>
          )}
          {cat === NEW && (
            <input style={GL.input} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" autoFocus />
          )}
          <div className="mo-2">
            {concept === NEW ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input style={GL.input} value={newConcept} onChange={(e) => setNewConcept(e.target.value)} placeholder={cat === NEW ? "Concept (optional)" : "New concept name"} autoFocus={cat !== NEW}
                  onKeyDown={(e) => e.key === "Enter" && save()} />
                {cat !== NEW && <button type="button" aria-label="Back to the list" style={{ ...GL.btnSmall, color: MUTED }} onClick={() => { setConcept(""); setNewConcept(""); }}>×</button>}
              </div>
            ) : (
              <select style={GL.input} value={concept} onChange={(e) => setConcept(e.target.value)} disabled={!cat}>
                <option value="">Concept (optional)</option>
                {conceptsOf(cat).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW}>+ Write my own…</option>
              </select>
            )}
            <input style={GL.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button style={GL.btn} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            {msg && <span style={{ fontSize: 15, fontWeight: 600, color: msg.ok ? GREEN : RED }}>{msg.text}</span>}
          </div>
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Choice options={[["", `All · ${inspo.length}`], ...config.categories.map((c) => [c.id, `${c.name} · ${inspo.filter((x) => inspoInCat(x, c.id)).length}`])]}
            value={fCat} onChange={(v) => { setFCat(v); setFConcept(""); }} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {fCat && (
            <select style={{ ...GL.input, width: "auto", minWidth: 200 }} value={fConcept} onChange={(e) => setFConcept(e.target.value)}>
              <option value="">All concepts</option>
              {conceptsOf(fCat).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input style={{ ...GL.input, flex: 1, minWidth: 180 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" />
        </div>
      </div>

      {shown.length === 0 ? <div style={{ ...GL.sub, fontSize: 16, padding: 20, textAlign: "center" }}>{inspo.length ? "Nothing matches." : "No reels saved yet."}</div> : (
        <div className="mo-inspo">
          {shown.map((x) => <InspoCard key={x.id} x={x} config={config} api={api} used={usedIn[x.id] || []} onAttach={() => setAttachFor(x)} />)}
        </div>
      )}

      {attachFor && <AttachModal x={attachFor} config={config} items={items} api={api} onClose={() => setAttachFor(null)} />}
    </>
  );
}

function InspoCard({ x, config, api, used, onAttach }) {
  const [notes, setNotes] = useState(x.notes || "");
  const [cat, setCat] = useState(x.categoryId);
  const [also, setAlso] = useState(x.alsoCategoryIds || []);
  const [concept, setConcept] = useState(x.conceptId);
  const [editing, setEditing] = useState(false);
  const c = catById(config, x.categoryId);
  const conceptLabel = c?.concepts.find((k) => k.id === x.conceptId)?.name;
  const link = { background: "none", border: "none", padding: 0, fontSize: 14, fontWeight: 600, cursor: "pointer", color: BRAND };

  const saveEdit = async () => {
    try { await api("updateInspo", { id: x.id, notes, categoryId: cat, conceptId: concept, alsoCategoryIds: also.filter((id) => id !== cat) }); setEditing(false); } catch { /* toast shown */ }
  };
  const del = async () => {
    if (!confirm(used.length ? `Delete? It's attached to ${used.length} post(s) and will be removed from them.` : "Delete this reel?")) return;
    try { await api("deleteInspo", { id: x.id }); } catch { /* toast shown */ }
  };

  return (
    <div style={{ ...GL.panel, padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Tag config={config} categoryId={x.categoryId}>{c?.name || "Uncategorised"}</Tag>
        {(x.alsoCategoryIds || []).map((id) => catById(config, id) && <Tag key={id} config={config} categoryId={id}>{catById(config, id).name}</Tag>)}
        {conceptLabel && <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{conceptLabel}</span>}
      </div>
      <InstaEmbed shortcode={x.shortcode} kind={x.kind} />
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <select style={GL.input} value={cat} onChange={(e) => { setCat(e.target.value); setConcept(""); setAlso([]); }}>
            {config.categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          {alsoOptions(config, cat).length > 0 && <Toggles options={alsoOptions(config, cat)} values={also} onChange={setAlso} />}
          <select style={GL.input} value={concept} onChange={(e) => setConcept(e.target.value)}>
            <option value="">No concept</option>
            {(catById(config, cat)?.concepts || []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <textarea rows={2} style={{ ...GL.input, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={GL.btnSmall} onClick={saveEdit}>Save</button>
            <button style={{ ...GL.btnSmall, color: MUTED }} onClick={() => { setEditing(false); setNotes(x.notes || ""); setCat(x.categoryId); setConcept(x.conceptId); setAlso(x.alsoCategoryIds || []); }}>Cancel</button>
          </div>
        </div>
      ) : x.notes ? (
        <div style={{ fontSize: 15, color: INK, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{x.notes}</div>
      ) : null}
      {used.length > 0 && (
        <div style={{ fontSize: 14, color: GREEN, fontWeight: 600 }}>
          ✓ {used.map(({ list, it }) => (list === "ads" ? `Ad: ${conceptName(config, { ...it, categoryId: config.ads?.categoryId })}` : `${itemTitle(config, it)} (${dayLabel(it.postDate)})`)).join(", ")}
        </div>
      )}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button style={GL.btnSmall} onClick={onAttach}>Attach to post</button>
        {!editing && <button style={link} onClick={() => setEditing(true)}>Edit</button>}
        <button style={{ ...link, color: RED }} onClick={del}>Delete</button>
        <span style={{ fontSize: 13, color: MUTED, marginLeft: "auto" }}>{fmtDay(x.addedAt?.slice(0, 10), { day: "numeric", month: "short" })}</span>
      </div>
    </div>
  );
}

// Tick the posts / ads this reel is for
function AttachModal({ x, config, items, api, onClose }) {
  const [list, setList] = useState("organic");
  const [showPast, setShowPast] = useState(false);
  const today = istToday();
  const rows = useMemo(() => (items[list] || [])
    .map((it) => ({
      it, date: list === "ads" ? it.liveDate : it.postDate,
      title: list === "ads" ? `${conceptName(config, { ...it, categoryId: config.ads?.categoryId })} · ${it.format}` : (it.conceptId ? itemTitle(config, it) : `${catById(config, it.categoryId)?.name || "Post"} (no concept yet)`),
    }))
    .filter((r) => showPast || (r.date || "") >= today || (r.it.inspoIds || []).includes(x.id))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 200), [items, list, config, today, showPast, x.id]);

  const toggle = (it) => api("linkInspo", { list, itemId: it.id, inspoId: x.id, linked: !(it.inspoIds || []).includes(x.id) }).catch(() => {});

  return (
    <Modal title="Attach to…" onClose={onClose} footer={<button style={GL.btn} onClick={onClose}>Done</button>}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Choice options={[["organic", "Instagram posts"], ["ads", "Ads"]]} value={list} onChange={setList} />
        <label style={{ fontSize: 14, color: MUTED, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} style={{ accentColor: BRAND }} /> Show past
        </label>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "60vh", overflowY: "auto" }}>
        {rows.length === 0 && <div style={GL.sub}>Nothing upcoming — add posts in the {list === "ads" ? "Ads" : "Instagram"} tab first.</div>}
        {rows.map(({ it, date, title }) => {
          const on = (it.inspoIds || []).includes(x.id);
          return (
            <label key={it.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", background: "#fff", borderRadius: 12, cursor: "pointer",
              border: on ? `2px solid ${BRAND}` : "1px solid rgba(171,31,16,0.1)" }}>
              <input type="checkbox" checked={on} onChange={() => toggle(it)} style={{ width: 18, height: 18, accentColor: BRAND }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: INK }}>{title}</span>
              <span style={{ fontSize: 14, color: MUTED, whiteSpace: "nowrap" }}>{date ? dayLabel(date) : "—"}</span>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
