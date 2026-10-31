"use client";

// One editor for posts and ads: category / format, concept, inspo (tap reels to attach), dates, status, notes, checklist.

import { useMemo, useState } from "react";
import {
  AD_STATUSES, ORGANIC_FORMATS, ORGANIC_STATUSES, adDates, catById, conceptLastUsed, diffDays, fmtDay, moveItem,
  inspoInCat, nextEpisode, organicDates, overdueReasons,
} from "./lib";
import { BRAND, Choice, Field, GL, MUTED, Modal, RED, ReelThumb } from "./ui";

export default function ItemEditor({ kind, item, isNew, config, inspo, items = [], onSave, onDelete, onClose }) {
  const [d, setD] = useState(item);
  const [busy, setBusy] = useState(false);
  const [allInspo, setAllInspo] = useState(false);
  const ads = kind === "ads";
  const categoryId = ads ? config.ads?.categoryId : d.categoryId;
  const cat = catById(config, categoryId);
  const dateKey = ads ? "liveDate" : "postDate";
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const late = overdueReasons(kind, d);
  const others = useMemo(() => items.filter((x) => x.id !== d.id), [items, d.id]);

  const setMainDate = (v) => { if (v) setD((x) => moveItem(config, kind, x, v)); };
  const setProdDate = (key, v) => set({ [key]: v || null, datesManual: true });
  const resetDates = () => set({ ...(ads ? adDates(config, d.liveDate) : organicDates(config, d.categoryId, d.postDate)), datesManual: false });
  const setCategory = (id) => setD((x) => ({
    ...x, categoryId: id, conceptId: "", conceptName: "", episode: null, checks: {},
    format: config.template.flat().find((s) => s.categoryId === id)?.format || x.format,
    ...(x.datesManual ? {} : organicDates(config, id, x.postDate)),
  }));
  const setConcept = (id) => {
    const c = cat?.concepts.find((x) => x.id === id);
    const episode = !ads && cat?.series && id ? (d.conceptId === id ? d.episode : nextEpisode(config, others, id, d.postDate)) : null;
    set({ conceptId: id, conceptName: c?.name || "", episode });
  };
  const toggle = (key, id) => setD((x) => {
    const has = (x[key] || []).includes(id);
    return { ...x, [key]: has ? x[key].filter((i) => i !== id) : [...(x[key] || []), id] };
  });
  const toggleCheck = (rid) => setD((x) => {
    const checks = { ...x.checks };
    if (checks[rid]) delete checks[rid]; else checks[rid] = true;
    return { ...x, checks };
  });

  // "last used 12 Oct" next to each concept; ⚠ when it's inside the category's no-repeat window
  const lastUsed = useMemo(() => conceptLastUsed(others.filter((x) => !ads || x.format === d.format), dateKey), [others, ads, d.format, dateKey]);
  const conceptLabel = (c) => {
    const last = lastUsed[c.id];
    if (!last) return `${c.name}  ·  new`;
    const recent = cat?.noRepeatWeeks && d[dateKey] && Math.abs(diffDays(last, d[dateKey])) < cat.noRepeatWeeks * 7;
    return `${recent ? "⚠ " : ""}${c.name}  ·  last ${fmtDay(last, { day: "numeric", month: "short" })}`;
  };

  // inspo: attached first, then this category's, then (if asked) everything
  const linked = new Set(d.inspoIds || []);
  const tiles = useMemo(() => {
    const mine = inspo.filter((x) => linked.has(x.id));
    const rest = inspo.filter((x) => !linked.has(x.id) && (allInspo || inspoInCat(x, categoryId)))
      .sort((a, b) => (b.conceptId === d.conceptId && !!d.conceptId) - (a.conceptId === d.conceptId && !!d.conceptId));
    return [...mine, ...rest];
  }, [inspo, d.inspoIds, allInspo, categoryId, d.conceptId]); // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenCount = allInspo ? 0 : inspo.filter((x) => !linked.has(x.id) && !inspoInCat(x, categoryId)).length;

  const save = async () => {
    setBusy(true);
    try { await onSave(d); onClose(); } catch { /* toast shown */ } finally { setBusy(false); }
  };
  const del = async () => {
    if (!confirm("Delete this?")) return;
    setBusy(true);
    try { await onDelete(d); onClose(); } catch { /* toast shown */ } finally { setBusy(false); }
  };

  const reqs = cat?.requirements || [];
  const done = reqs.filter((r) => d.checks?.[r.id]).length;
  const organicCats = config.categories.filter((c) => c.id !== config.ads?.categoryId);

  return (
    <Modal title={isNew ? (ads ? "New ad" : "New post") : (ads ? "Ad" : "Post")} onClose={onClose} footer={<>
      {!isNew && <button style={{ ...GL.btnOutline, color: RED, borderColor: "rgba(185,28,28,0.3)", marginRight: "auto" }} onClick={del} disabled={busy}>Delete</button>}
      <button style={GL.btnOutline} onClick={onClose} disabled={busy}>Cancel</button>
      <button style={GL.btn} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </>}>
      {late.length > 0 && <div style={{ color: RED, fontSize: 15, fontWeight: 700 }}>⚠ {late.join(", ")}</div>}

      {ads ? (
        <Choice options={[["video", "🎥 Video"], ["static", "🖼 Static"]]} value={d.format} onChange={(v) => set({ format: v })} />
      ) : (
        <Choice options={[...organicCats.map((c) => [c.id, c.name]), ...(cat || !d.categoryId ? [] : [[d.categoryId, "(deleted)"]])]}
          value={d.categoryId} onChange={setCategory} />
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <Field label="Concept" style={{ flex: 1 }}>
          <select style={{ ...GL.input, fontSize: 16, fontWeight: 600 }} value={d.conceptId} onChange={(e) => setConcept(e.target.value)}>
            <option value="">{d.conceptId && !cat?.concepts.some((c) => c.id === d.conceptId) ? `${d.conceptName || "?"} (deleted)` : "Pick a concept"}</option>
            {(cat?.concepts || []).map((c) => <option key={c.id} value={c.id}>{conceptLabel(c)}</option>)}
          </select>
        </Field>
        {!ads && cat?.series && (
          <Field label={/day/i.test(d.conceptName) ? "Day" : "Episode"} style={{ width: 90 }}>
            <input type="number" min={1} style={GL.input} value={d.episode ?? ""}
              onChange={(e) => set({ episode: e.target.value ? Math.max(1, parseInt(e.target.value, 10) || 1) : null })} />
          </Field>
        )}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ ...GL.label, marginBottom: 0 }}>Inspo {linked.size ? `· ${linked.size} attached` : "· tap to attach"}</span>
          {hiddenCount > 0 && <button type="button" style={{ background: "none", border: "none", color: BRAND, fontSize: 14, fontWeight: 600, cursor: "pointer" }} onClick={() => setAllInspo(true)}>Show all ({hiddenCount} more)</button>}
        </div>
        {tiles.length === 0 ? (
          <div style={GL.sub}>No reels saved{inspo.length ? " for this category" : ""} yet — add them in the Inspo tab.</div>
        ) : (
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
            {tiles.map((x) => <ReelThumb key={x.id} shortcode={x.shortcode} width={100} selected={linked.has(x.id)} onClick={() => toggle("inspoIds", x.id)} />)}
          </div>
        )}
      </div>

      <div>
        <div className="mo-3">
          <Field label={ads ? "Goes live" : "Post on"}>
            <input type="date" style={GL.input} value={d[dateKey] || ""} onChange={(e) => setMainDate(e.target.value)} />
          </Field>
          <Field label={ads ? "Shoot / design" : "Shoot"}>
            <input type="date" style={GL.input} value={d.shootDate || ""} onChange={(e) => setProdDate("shootDate", e.target.value)} />
          </Field>
          <Field label="Edit">
            <input type="date" style={GL.input} value={d.editDate || ""} onChange={(e) => setProdDate("editDate", e.target.value)} />
          </Field>
        </div>
        {d.datesManual && <button type="button" style={{ background: "none", border: "none", color: BRAND, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "6px 0 0" }} onClick={resetDates}>Use default shoot / edit dates</button>}
      </div>

      <Field label="Status">
        <Choice options={(ads ? AD_STATUSES : ORGANIC_STATUSES).map((s) => [s, s])} value={d.status} onChange={(v) => set({ status: v })} />
      </Field>

      {ads ? (
        <>
          <Field label="Hook / headline"><input style={GL.input} value={d.hook} onChange={(e) => set({ hook: e.target.value })} /></Field>
          <Field label="Notes"><textarea rows={2} style={{ ...GL.input, resize: "vertical" }} value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </>
      ) : (
        <Field label="Idea"><textarea rows={2} style={{ ...GL.input, resize: "vertical" }} value={d.idea} onChange={(e) => set({ idea: e.target.value })} /></Field>
      )}

      {reqs.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 700, color: done === reqs.length ? "#15803d" : "#1a0a09" }}>
            Checklist {done}/{reqs.length}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {reqs.map((r) => (
              <label key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15, cursor: "pointer" }}>
                <input type="checkbox" checked={!!d.checks?.[r.id]} onChange={() => toggleCheck(r.id)} style={{ width: 18, height: 18, accentColor: BRAND }} />
                <span style={{ color: d.checks?.[r.id] ? MUTED : "#1a0a09", textDecoration: d.checks?.[r.id] ? "line-through" : "none" }}>{r.text}</span>
              </label>
            ))}
          </div>
        </details>
      )}

      <div className="mo-2">
        {ads ? (
          <Field label="Meta ad name / ID"><input style={GL.input} value={d.metaAd} onChange={(e) => set({ metaAd: e.target.value })} /></Field>
        ) : (
          <>
            <Field label="Format">
              <select style={GL.input} value={d.format} onChange={(e) => set({ format: e.target.value })}>
                {ORGANIC_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="Post link"><input style={GL.input} value={d.postLink} onChange={(e) => set({ postLink: e.target.value })} placeholder="Once posted" /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
