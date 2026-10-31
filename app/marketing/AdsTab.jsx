"use client";

// Ads planner (separate from Instagram posts): the week's quota as slots to fill — tap an empty one to add the ad;
// shoot / design and edit dates come from the go-live date. The side panel lists what's due on a day.

import { useMemo, useState } from "react";
import { AD_FORMATS, adLiveDate, conceptName, inWeek, istToday, newAd, overdueReasons, weekDays } from "./lib";
import { BRAND, GREEN, INK, MUTED, Panel, RED, ReelModal, ReelThumb, StatusPill, WeekNav, dayLabel } from "./ui";
import DayPanel from "./DayPanel";
import ItemEditor from "./ItemEditor";

const FORMAT = { video: ["🎥", "Video ads", "Video ad"], static: ["🖼", "Static creatives", "Static"] };
const READY = new Set(["Edited", "Live", "Paused"]);

export default function AdsTab({ config, ads, inspo, api, ws, setWs }) {
  const today = istToday();
  const days = weekDays(ws);
  const [editor, setEditor] = useState(null);
  const [day, setDay] = useState(null);
  const [reel, setReel] = useState(null);
  const selDay = day && days.includes(day) ? day : days.includes(today) ? today : ws;
  const quota = config.ads?.quota || {};
  const inspoById = useMemo(() => Object.fromEntries(inspo.map((x) => [x.id, x])), [inspo]);

  const save = (item) => api("upsertItems", { list: "ads", items: [item] });
  const remove = (item) => api("deleteItem", { list: "ads", id: item.id });
  const setStatus = (list, status) => api("upsertItems", { list: "ads", items: list.map((a) => ({ ...a, status })) }).catch(() => {});
  const add = (format) => setEditor({ item: newAd(config, { format, liveDate: adLiveDate(config, ws) }), isNew: true });

  const week = useMemo(() => ads.filter((a) => inWeek(a.liveDate, ws)).sort((a, b) => a.liveDate.localeCompare(b.liveDate)), [ads, ws]);

  return (
    <>
      <WeekNav ws={ws} setWs={setWs} />

      <div className="mo-split">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {AD_FORMATS.map((f) => {
            const q = Number(quota[f]) || 0;
            const list = week.filter((a) => a.format === f);
            const ready = list.filter((a) => READY.has(a.status)).length;
            const empty = Math.max(0, q - list.length);
            return (
              <Panel key={f} title={`${FORMAT[f][0]} ${FORMAT[f][1]}`}
                right={<span style={{ fontSize: 18, fontWeight: 800, color: q && ready >= q ? GREEN : INK }}>{ready}/{q} ready</span>}>
                <div style={{ height: 8, borderRadius: 999, background: "rgba(171,31,16,0.1)", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ width: `${q ? Math.min(100, (ready / q) * 100) : 0}%`, height: "100%", background: q && ready >= q ? GREEN : BRAND }} />
                </div>
                <div className="mo-cards">
                  {list.map((a) => <AdCard key={a.id} config={config} a={a} today={today} inspoById={inspoById} onOpen={() => setEditor({ item: a })} onReel={setReel} />)}
                  {Array.from({ length: empty }, (_, i) => (
                    <button key={i} className="mo-card" onClick={() => add(f)}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, background: "rgba(255,255,255,0.45)",
                        border: `2px dashed ${BRAND}55`, textAlign: "left", minHeight: 68 }}>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontSize: 16, fontWeight: 700, color: BRAND }}>{FORMAT[f][2]}</span>
                        <span style={{ display: "block", fontSize: 14, color: MUTED }}>live {dayLabel(adLiveDate(config, ws))} · tap to add</span>
                      </span>
                      <span style={{ fontSize: 26, color: BRAND, lineHeight: 1 }}>+</span>
                    </button>
                  ))}
                  {empty === 0 && (
                    <button onClick={() => add(f)} aria-label={`Add another ${f}`}
                      style={{ alignSelf: "center", border: "none", background: "transparent", color: MUTED, fontSize: 26, padding: "4px 10px", cursor: "pointer" }}>+</button>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>

        <div className="mo-side">
          <DayPanel kind="ads" config={config} items={ads} days={days} day={selDay} setDay={setDay} today={today}
            open={(it) => setEditor({ item: it })} setStatus={setStatus} />
        </div>
      </div>

      {editor && (
        <ItemEditor kind="ads" item={editor.item} isNew={editor.isNew} config={config} inspo={inspo} items={ads}
          onSave={save} onDelete={remove} onClose={() => setEditor(null)} />
      )}
      <ReelModal inspo={reel} onClose={() => setReel(null)} />
    </>
  );
}

function AdCard({ config, a, today, inspoById, onOpen, onReel }) {
  const late = overdueReasons("ads", a, today);
  const reels = (a.inspoIds || []).map((id) => inspoById[id]).filter(Boolean);
  const when = [a.shootDate && `${a.format === "video" ? "Shoot" : "Design"} ${dayLabel(a.shootDate)}`, a.editDate && `Edit ${dayLabel(a.editDate)}`].filter(Boolean).join(" · ");
  return (
    <div className="mo-card" onClick={onOpen}
      style={{ display: "flex", gap: 12, padding: 12, borderRadius: 14, background: "#fff", border: late.length ? `2px solid ${RED}` : "1px solid rgba(171,31,16,0.08)" }}>
      {reels.length > 0 && (
        <div onClick={(e) => e.stopPropagation()}><ReelThumb shortcode={reels[0].shortcode} width={84} onClick={() => onReel(reels[0])} /></div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: a.conceptId ? INK : MUTED }}>{a.conceptId ? conceptName(config, { ...a, categoryId: config.ads?.categoryId }) : "No concept yet"}</span>
        {a.hook && <span style={{ fontSize: 14, color: "#4b3b3a" }}>“{a.hook}”</span>}
        <StatusPill status={a.status} />
        {when && <span style={{ fontSize: 13, color: MUTED }}>{when}</span>}
        {a.metaAd && <span style={{ fontSize: 13, color: MUTED }}>📣 {a.metaAd}</span>}
        {late.length > 0 && <span style={{ fontSize: 13, color: RED, fontWeight: 700 }}>⚠ {late.join(", ")}</span>}
      </div>
    </div>
  );
}
