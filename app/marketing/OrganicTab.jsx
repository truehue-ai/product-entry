"use client";

// Instagram planner: each day shows its planned categories (from the weekly plan in Settings). Tap one to add the
// post — shoot and edit dates are worked out from the post date. Attached inspo shows on the post.
// Drag a post to another day to move it. The side panel lists what to shoot / edit / post on a day.

import { useMemo, useState } from "react";
import { catById, daySlots, istToday, itemTitle, moveItem, newOrganic, overdueReasons, weekDays } from "./lib";
import { BRAND, INK, MUTED, Panel, RED, ReelModal, ReelThumb, StatusPill, WeekNav, catColor, dayLabel, dayName } from "./ui";
import DayPanel from "./DayPanel";
import ItemEditor from "./ItemEditor";

export default function OrganicTab({ config, items, inspo, api, patchLocal, reload, ws, setWs }) {
  const today = istToday();
  const days = weekDays(ws);
  const [editor, setEditor] = useState(null); // { item, isNew }
  const [dragOver, setDragOver] = useState(null);
  const [day, setDay] = useState(null);
  const [reel, setReel] = useState(null);
  const selDay = day && days.includes(day) ? day : days.includes(today) ? today : ws;
  const inspoById = useMemo(() => Object.fromEntries(inspo.map((x) => [x.id, x])), [inspo]);

  const save = (item) => api("upsertItems", { list: "organic", items: [item] });
  const remove = (item) => api("deleteItem", { list: "organic", id: item.id });
  const setStatus = (list, status) => api("upsertItems", { list: "organic", items: list.map((i) => ({ ...i, status })) }).catch(() => {});

  const drop = (date, id) => {
    setDragOver(null);
    const it = items.find((x) => x.id === id);
    if (!it || it.postDate === date) return;
    const moved = moveItem(config, "organic", it, date);
    patchLocal("organic", [moved]);
    save(moved).catch(() => reload());
  };

  const addPost = (date, categoryId, format) => {
    const cat = categoryId || config.categories.find((c) => c.id !== config.ads?.categoryId)?.id || "";
    setEditor({ item: newOrganic(config, { categoryId: cat, postDate: date, format: format || "reel" }), isNew: true });
  };

  const byDay = useMemo(() => {
    const m = Object.fromEntries(days.map((d) => [d, []]));
    for (const it of items) if (m[it.postDate]) m[it.postDate].push(it);
    return m;
  }, [items, days]);

  const slotsByDay = days.map((d) => daySlots(config, byDay[d], d));
  const planned = slotsByDay.flat().filter((s) => s.slot && s.item).length;
  const total = slotsByDay.flat().filter((s) => s.slot).length;

  return (
    <>
      <WeekNav ws={ws} setWs={setWs}>
        <span style={{ fontSize: 15, color: MUTED }}>{planned} of {total} planned</span>
      </WeekNav>

      <div className="mo-split">
        <Panel>
          {days.map((d, di) => (
            <div key={d} className={`mo-day${dragOver === d ? " mo-drop" : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== d) setDragOver(d); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); }}
              onDrop={(e) => { e.preventDefault(); drop(d, e.dataTransfer.getData("text/plain")); }}>
              <button onClick={() => setDay(d)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", alignSelf: "start" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: d === today ? BRAND : INK, lineHeight: 1.1 }}>{dayName(d)}</div>
                <div style={{ fontSize: 15, color: MUTED }}>{dayLabel(d).split(" ").slice(1).join(" ")}</div>
                {d === today && <div style={{ fontSize: 13, fontWeight: 700, color: BRAND, marginTop: 2 }}>Today</div>}
              </button>
              <div className="mo-cards">
                {slotsByDay[di].map(({ slot, item }, i) => item ? (
                  <PostCard key={item.id} config={config} item={item} today={today} inspoById={inspoById}
                    onOpen={() => setEditor({ item })} onReel={setReel} />
                ) : (
                  <EmptySlot key={`slot-${i}`} config={config} slot={slot} onClick={() => addPost(d, slot.categoryId, slot.format)} />
                ))}
                <button onClick={() => addPost(d)} title="Add another post" aria-label="Add another post"
                  style={{ alignSelf: "center", border: "none", background: "transparent", color: MUTED, fontSize: 26, padding: "4px 10px", cursor: "pointer" }}>+</button>
              </div>
            </div>
          ))}
        </Panel>

        <div className="mo-side">
          <DayPanel kind="organic" config={config} items={items} days={days} day={selDay} setDay={setDay} today={today}
            open={(it) => setEditor({ item: it })} setStatus={setStatus} />
        </div>
      </div>

      {editor && (
        <ItemEditor kind="organic" item={editor.item} isNew={editor.isNew} config={config} inspo={inspo} items={items}
          onSave={save} onDelete={remove} onClose={() => setEditor(null)} />
      )}
      <ReelModal inspo={reel} onClose={() => setReel(null)} />
    </>
  );
}

// A planned category with no post yet
function EmptySlot({ config, slot, onClick }) {
  const cat = catById(config, slot.categoryId);
  const c = catColor(config, slot.categoryId);
  return (
    <button onClick={onClick} className="mo-card"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, background: "rgba(255,255,255,0.45)",
        border: `2px dashed ${c.dot}66`, textAlign: "left", minHeight: 68 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 700, color: c.dot }}>{cat?.name || "Category"}</span>
        <span style={{ display: "block", fontSize: 14, color: MUTED }}>{slot.format} · tap to add</span>
      </span>
      <span style={{ fontSize: 26, color: c.dot, lineHeight: 1 }}>+</span>
    </button>
  );
}

function PostCard({ config, item, today, inspoById, onOpen, onReel }) {
  const late = overdueReasons("organic", item, today);
  const cat = catById(config, item.categoryId);
  const c = catColor(config, item.categoryId);
  const reels = (item.inspoIds || []).map((id) => inspoById[id]).filter(Boolean);
  const when = [item.shootDate && `Shoot ${dayLabel(item.shootDate)}`, item.editDate && `Edit ${dayLabel(item.editDate)}`].filter(Boolean).join(" · ");
  return (
    <div draggable className="mo-card" onClick={onOpen}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", item.id); e.dataTransfer.effectAllowed = "move"; }}
      style={{ display: "flex", gap: 12, padding: "12px 12px 12px 16px", borderRadius: 14, background: "#fff",
        border: late.length ? `2px solid ${RED}` : "1px solid rgba(171,31,16,0.08)", boxShadow: `inset 5px 0 0 ${c.dot}` }}>
      {reels.length > 0 && (
        <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
          <ReelThumb shortcode={reels[0].shortcode} width={84} onClick={() => onReel(reels[0])} />
          {reels.length > 1 && <span style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "1px 7px" }}>+{reels.length - 1}</span>}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: c.dot }}>{cat?.name || "No category"} · {item.format}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: item.conceptId ? INK : MUTED, lineHeight: 1.3 }}>{item.conceptId ? itemTitle(config, item) : "No concept yet"}</span>
        {item.idea && <span style={{ fontSize: 14, color: "#4b3b3a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.idea}</span>}
        <StatusPill status={item.status} />
        {when && <span style={{ fontSize: 13, color: MUTED }}>{when}</span>}
        {late.length > 0 && <span style={{ fontSize: 13, color: RED, fontWeight: 700 }}>⚠ {late.join(", ")}</span>}
      </div>
    </div>
  );
}
