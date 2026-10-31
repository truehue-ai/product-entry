"use client";

// Side panel: for the picked day, what to shoot, edit and post (or put live), with a one-tap "Done".
// Overdue work from any week shows on top in red.

import { AD_STATUSES, ORGANIC_STATUSES, catById, conceptName, itemTitle, overdueReasons } from "./lib";
import { BRAND, GL, INK, MUTED, Panel, RED, StatusPill, catColor, dayLabel, dayName } from "./ui";

const LISTS = {
  organic: [["🎥 Shoot", "shootDate", "Shot"], ["✂️ Edit", "editDate", "Edited"], ["📤 Post", "postDate", "Posted"]],
  ads: [["🎥 Shoot / design", "shootDate", "Shot/Designed"], ["✂️ Edit", "editDate", "Edited"], ["🚀 Go live", "liveDate", "Live"]],
};

export const titleOf = (config, kind, it) =>
  kind === "ads" ? `${conceptName(config, { ...it, categoryId: config.ads?.categoryId })} · ${it.format}` : itemTitle(config, it);

export default function DayPanel({ kind, config, items, days, day, setDay, today, open, setStatus }) {
  const statuses = kind === "ads" ? AD_STATUSES : ORGANIC_STATUSES;
  const before = (it, s) => statuses.indexOf(it.status) < statuses.indexOf(s) && it.status !== "Paused";
  const overdue = items.filter((i) => overdueReasons(kind, i, today).length);

  return (
    <Panel style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
        {days.map((d) => (
          <button key={d} onClick={() => setDay(d)}
            style={{ border: "none", borderRadius: 12, padding: "8px 0", cursor: "pointer", lineHeight: 1.2,
              background: d === day ? BRAND : d === today ? "rgba(171,31,16,0.08)" : "transparent", color: d === day ? "#fff" : INK }}>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>{dayName(d)}</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{Number(d.slice(8))}</div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{day === today ? "Today" : dayLabel(day)}</div>

      {overdue.length > 0 && (
        <Group title={`⚠ Overdue · ${overdue.length}`} color={RED}>
          {overdue.map((it) => (
            <Row key={it.id} config={config} kind={kind} it={it} onOpen={() => open(it)} late note={overdueReasons(kind, it, today).join(", ")} />
          ))}
        </Group>
      )}

      {LISTS[kind].map(([title, key, done]) => {
        const list = items.filter((i) => i[key] === day);
        const todo = list.filter((i) => before(i, done));
        return (
          <Group key={key} title={`${title} · ${list.length}`}
            right={todo.length > 1 && <button style={GL.btnSmall} onClick={() => setStatus(todo, done)}>All done</button>}>
            {list.length === 0 ? <div style={{ ...GL.sub, padding: "4px 0" }}>Nothing</div> : list.map((it) => (
              <Row key={it.id} config={config} kind={kind} it={it} onOpen={() => open(it)}
                late={overdueReasons(kind, it, today).length > 0}
                action={before(it, done) && <button style={GL.btnSmall} onClick={() => setStatus([it], done)}>Done</button>} />
            ))}
          </Group>
        );
      })}
    </Panel>
  );
}

function Group({ title, color, right, children }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: color || INK }}>{title}</span>{right}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ config, kind, it, onOpen, action, late, note }) {
  const dot = kind === "ads" ? BRAND : catColor(config, it.categoryId).dot;
  const sub = kind === "ads" ? it.hook : catById(config, it.categoryId)?.name;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: "#fff",
      border: late ? `1.5px solid ${RED}` : "1px solid rgba(171,31,16,0.08)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: dot, flexShrink: 0 }} />
      <div onClick={onOpen} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: it.conceptId ? INK : MUTED }}>{it.conceptId ? titleOf(config, kind, it) : "No concept yet"}</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
          {sub && <span style={{ fontSize: 13, color: MUTED }}>{sub}</span>}
          <StatusPill status={it.status} />
        </div>
        {note && <div style={{ fontSize: 13, color: RED, marginTop: 2 }}>{note}</div>}
      </div>
      {action}
    </div>
  );
}
