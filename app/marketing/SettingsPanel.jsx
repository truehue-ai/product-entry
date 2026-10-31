"use client";

// Settings: the weekly plan (categories per day), categories (requirements, concepts, shoot / edit days, series)
// and ads quota / timing. Edits a draft; Save writes it all at once.

import { useEffect, useState } from "react";
import { ORGANIC_FORMATS, WEEKDAYS, duplicateNames, findConcept, newCategory, normName, uid } from "./lib";
import { BRAND, Field, GL, INK, MUTED, Panel, RED, catColor } from "./ui";

const numOrNull = (v) => (v === "" ? null : Math.max(0, parseInt(v, 10) || 0));
const xBtn = { background: "none", border: "none", color: RED, cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" };

export default function SettingsPanel({ config, api, setToast }) {
  const [d, setD] = useState(() => structuredClone(config));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(config);
  useEffect(() => { if (!dirty) setD(structuredClone(config)); }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (fn) => setD((x) => { const y = structuredClone(x); fn(y); return y; });
  const cat = (y, id) => y.categories.find((c) => c.id === id);

  // names must be unique: categories among categories, concepts across all categories
  const dups = duplicateNames(d);
  const catTaken = (c) => d.categories.some((k) => k.id !== c.id && normName(k.name) === normName(c.name));
  const conceptTaken = (k) => d.categories.some((c) => c.concepts.some((x) => x.id !== k.id && normName(x.name) === normName(k.name)));

  const save = async () => {
    if (d.categories.some((c) => !c.name.trim())) { setToast("Every category needs a name."); return; }
    if (dups.length) { setToast(`${dups[0]} — names must be unique.`); return; }
    setBusy(true);
    try { const j = await api("saveConfig", { config: d }); setD(structuredClone(j.config)); setToast("Saved ✓"); } catch { /* toast shown */ } finally { setBusy(false); }
  };

  const addCategory = () => edit((y) => {
    const id = uid();
    let name = "New category";
    for (let n = 2; y.categories.some((c) => normName(c.name) === normName(name)); n++) name = `New category ${n}`;
    y.categories.push(newCategory(id, name));
    y.offsets[id] = { shoot: 3, edit: 2 };
  });
  const deleteCategory = (c) => {
    if (c.id === d.ads?.categoryId) { setToast("This category gives the ad concepts — pick another one under Ads first."); return; }
    if (!confirm(`Delete "${c.name}"? It's also removed from the weekly plan.`)) return;
    edit((y) => {
      y.categories = y.categories.filter((k) => k.id !== c.id);
      delete y.offsets[c.id];
      y.template = y.template.map((slots) => slots.filter((s) => s.categoryId !== c.id));
    });
  };

  const organicCats = d.categories.filter((c) => c.id !== d.ads?.categoryId);

  return (
    <>
      {dirty && (
        <div style={{ ...GL.panel, padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 76, zIndex: 30 }}>
          <span style={{ fontSize: 15, color: dups.length ? RED : "#b45309", fontWeight: 700, marginRight: "auto" }}>
            {dups.length ? `${dups[0]} — names must be unique` : "Unsaved changes"}
          </span>
          <button style={GL.btnOutline} disabled={busy} onClick={() => setD(structuredClone(config))}>Discard</button>
          <button style={{ ...GL.btn, opacity: dups.length ? 0.5 : 1 }} disabled={busy || dups.length > 0} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      )}

      <Panel title="Weekly plan">
        <div style={{ display: "flex", flexDirection: "column" }}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "12px 0", borderTop: i ? "1px solid rgba(171,31,16,0.08)" : "none" }}>
              <span style={{ width: 48, fontSize: 18, fontWeight: 800, color: INK }}>{w}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: 1, alignItems: "center" }}>
                {(d.template[i] || []).map((s, j) => {
                  const c = catColor(d, s.categoryId);
                  return (
                    <div key={j} style={{ display: "flex", gap: 4, alignItems: "center", background: c.bg, borderRadius: 12, padding: "4px 6px 4px 10px" }}>
                      <select style={{ ...GL.input, width: "auto", border: "none", background: "transparent", fontWeight: 700, padding: "6px 2px" }} value={s.categoryId}
                        onChange={(e) => edit((y) => { y.template[i][j].categoryId = e.target.value; })}>
                        {!organicCats.some((k) => k.id === s.categoryId) && <option value={s.categoryId}>(missing)</option>}
                        {organicCats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                      </select>
                      <select style={{ ...GL.input, width: "auto", border: "none", background: "transparent", color: MUTED, padding: "6px 2px" }} value={s.format}
                        onChange={(e) => edit((y) => { y.template[i][j].format = e.target.value; })}>
                        {ORGANIC_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <button aria-label="Remove" style={xBtn} onClick={() => edit((y) => { y.template[i].splice(j, 1); })}>×</button>
                    </div>
                  );
                })}
                <button style={GL.btnSmall} onClick={() => edit((y) => { (y.template[i] ||= []).push({ categoryId: organicCats[0]?.id || "", format: "reel" }); })}>+ Add</button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Categories" right={<button style={GL.btnSmall} onClick={addCategory}>+ Category</button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {d.categories.map((c) => {
            const col = catColor(d, c.id);
            return (
              <details key={c.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(171,31,16,0.1)", padding: "14px 16px" }}>
                <summary style={{ cursor: "pointer", fontSize: 17, fontWeight: 700, color: INK, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 999, background: col.dot }} />
                  {c.name || "Untitled"}
                  <span style={{ fontSize: 14, fontWeight: 500, color: MUTED }}>{c.concepts.length} concepts{c.id === d.ads?.categoryId ? " · ads" : ""}</span>
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 16 }}>
                  <div className="mo-2">
                    <Field label={catTaken(c) ? "Name — already used" : "Name"}>
                      <input style={{ ...GL.input, ...(catTaken(c) && { borderColor: RED }) }} value={c.name} onChange={(e) => edit((y) => { cat(y, c.id).name = e.target.value; })} />
                    </Field>
                    {c.id !== d.ads?.categoryId && (
                      <Field label="Shoot / edit (days before posting)">
                        <div style={{ display: "flex", gap: 8 }}>
                          <input type="number" min={0} style={GL.input} placeholder="no shoot" value={d.offsets[c.id]?.shoot ?? ""} aria-label="Shoot days before"
                            onChange={(e) => edit((y) => { (y.offsets[c.id] ||= { shoot: null, edit: null }).shoot = numOrNull(e.target.value); })} />
                          <input type="number" min={0} style={GL.input} placeholder="no edit" value={d.offsets[c.id]?.edit ?? ""} aria-label="Edit days before"
                            onChange={(e) => edit((y) => { (y.offsets[c.id] ||= { shoot: null, edit: null }).edit = numOrNull(e.target.value); })} />
                        </div>
                      </Field>
                    )}
                    <Field label="Warn if a concept is reused within (weeks)">
                      <input type="number" min={0} style={GL.input} value={c.noRepeatWeeks ?? 0}
                        onChange={(e) => edit((y) => { cat(y, c.id).noRepeatWeeks = numOrNull(e.target.value) ?? 0; })} />
                    </Field>
                    <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15, alignSelf: "end", paddingBottom: 10 }}>
                      <input type="checkbox" checked={!!c.series} style={{ width: 18, height: 18, accentColor: BRAND }} onChange={(e) => edit((y) => { cat(y, c.id).series = e.target.checked; })} />
                      Numbered episodes (series)
                    </label>
                  </div>

                  <ListEditor label="Requirements (checklist)" items={c.requirements} textKey="text" placeholder="Add a requirement"
                    onChange={(list) => edit((y) => { cat(y, c.id).requirements = list; })} />

                  <ListEditor label={c.series ? "Concepts · starting episode" : "Concepts"} items={c.concepts} textKey="name" placeholder="Add a concept"
                    isTaken={conceptTaken}
                    whereTaken={(name) => { const f = findConcept(d, name); return f && `"${f.concept.name}" is already in ${f.cat.name}`; }}
                    onChange={(list) => edit((y) => { cat(y, c.id).concepts = list; })}
                    extra={c.series ? (k) => {
                      const s = d.series[k.id] || { startAt: 1 };
                      return (
                        <input type="number" min={1} aria-label="Starting episode" title="Starting episode" style={{ ...GL.input, width: 80 }} value={s.startAt || 1}
                          onChange={(e) => edit((y) => { y.series[k.id] = { ...s, startAt: Math.max(1, parseInt(e.target.value, 10) || 1) }; })} />
                      );
                    } : null} />

                  <button style={{ ...GL.btnSmall, color: RED, alignSelf: "flex-start" }} onClick={() => deleteCategory(c)}>Delete category</button>
                </div>
              </details>
            );
          })}
        </div>
      </Panel>

      <Panel title="Ads">
        <div className="mo-3">
          <Field label="Videos per week">
            <input type="number" min={0} style={GL.input} value={d.ads.quota.video} onChange={(e) => edit((y) => { y.ads.quota.video = numOrNull(e.target.value) ?? 0; })} />
          </Field>
          <Field label="Statics per week">
            <input type="number" min={0} style={GL.input} value={d.ads.quota.static} onChange={(e) => edit((y) => { y.ads.quota.static = numOrNull(e.target.value) ?? 0; })} />
          </Field>
          <Field label="Go live on">
            <select style={GL.input} value={d.ads.liveWeekday} onChange={(e) => edit((y) => { y.ads.liveWeekday = Number(e.target.value); })}>
              {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
            </select>
          </Field>
          <Field label="Shoot / design (days before)">
            <input type="number" min={0} style={GL.input} placeholder="none" value={d.ads.shootDaysBefore ?? ""} onChange={(e) => edit((y) => { y.ads.shootDaysBefore = numOrNull(e.target.value); })} />
          </Field>
          <Field label="Edit (days before)">
            <input type="number" min={0} style={GL.input} placeholder="none" value={d.ads.editDaysBefore ?? ""} onChange={(e) => edit((y) => { y.ads.editDaysBefore = numOrNull(e.target.value); })} />
          </Field>
          <Field label="Ad concepts from">
            <select style={GL.input} value={d.ads.categoryId} onChange={(e) => edit((y) => { y.ads.categoryId = e.target.value; })}>
              {d.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      </Panel>
    </>
  );
}

// Editable list of { id, [textKey] } — rename in place, remove, add
// isTaken(item) marks a duplicate name in red; whereTaken(name) blocks adding one (returns the reason)
function ListEditor({ label, items, textKey, placeholder, onChange, extra, isTaken, whereTaken }) {
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");
  const push = () => {
    const t = add.trim().replace(/\s+/g, " ");
    if (!t) return;
    const taken = whereTaken?.(t);
    if (taken) { setErr(taken); return; }
    onChange([...items, { id: uid(), [textKey]: t }]);
    setAdd(""); setErr("");
  };
  return (
    <div>
      <span style={GL.label}>{label}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((k, i) => (
          <div key={k.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input style={{ ...GL.input, flex: 1, ...(isTaken?.(k) && { borderColor: RED, color: RED }) }} value={k[textKey]}
              title={isTaken?.(k) ? "This name is already used" : undefined}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [textKey]: e.target.value } : x)))} />
            {extra?.(k)}
            <button aria-label="Remove" style={xBtn} onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...GL.input, flex: 1 }} value={add} placeholder={placeholder} onChange={(e) => { setAdd(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && push()} />
          <button style={GL.btnSmall} onClick={push}>Add</button>
        </div>
        {err && <div style={{ fontSize: 14, color: RED, fontWeight: 600 }}>{err}</div>}
      </div>
    </div>
  );
}
