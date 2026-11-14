// Minimal iCalendar (.ics) reader: which events fall on a given day (India time).
// Handles what Google Calendar exports: single events, RRULE (DAILY / WEEKLY / MONTHLY / YEARLY, INTERVAL, UNTIL,
// COUNT for daily), EXDATE, edited single occurrences (RECURRENCE-ID) and cancelled ones. No dependencies.

const IST_MS = 5.5 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, "0");
const istDay = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istTime = (ms) => new Date(ms + IST_MS).toISOString().slice(11, 16);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const weekdayIdx = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

// offset (ms) of a time zone at a moment
function tzOffset(ms, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms));
    const g = (t) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
  } catch {
    return IST_MS;
  }
}

// "20261115T103000Z" | "20261115T103000" (+ TZID) | "20261115" (all day) -> { ms, day, time, allDay }
function parseDt(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h == null || params.VALUE === "DATE") {
    const day = `${y}-${mo}-${d}`;
    return { ms: Date.parse(`${day}T00:00:00Z`) - IST_MS, day, time: null, allDay: true };
  }
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const ms = z ? wall : wall - tzOffset(wall, params.TZID || "Asia/Kolkata");
  return { ms, day: istDay(ms), time: istTime(ms), allDay: false };
}

const unescapeText = (v) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

export function parseIcs(text) {
  const lines = String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: new Set() }; continue; }
    if (line === "END:VEVENT") { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...rawParams] = line.slice(0, i).split(";");
    const params = Object.fromEntries(rawParams.map((p) => { const j = p.indexOf("="); return [p.slice(0, j), p.slice(j + 1)]; }));
    const value = line.slice(i + 1);
    if (name === "SUMMARY") cur.summary = unescapeText(value);
    else if (name === "UID") cur.uid = value;
    else if (name === "STATUS") cur.status = value;
    else if (name === "DTSTART") cur.start = parseDt(value, params);
    else if (name === "DTEND") cur.end = parseDt(value, params);
    else if (name === "RECURRENCE-ID") cur.recurrenceId = parseDt(value, params);
    else if (name === "RRULE") cur.rrule = Object.fromEntries(value.split(";").map((p) => p.split("=")));
    else if (name === "EXDATE") for (const v of value.split(",")) { const dt = parseDt(v, params); if (dt) cur.exdates.add(dt.day); }
  }
  return events;
}

// Does a repeating event happen on `day`?
function occursOn(ev, day) {
  const start = ev.start.day;
  if (day < start) return false;
  const r = ev.rrule;
  if (r.UNTIL) { const u = parseDt(r.UNTIL); if (u && day > u.day) return false; }
  const n = Math.max(1, parseInt(r.INTERVAL || "1", 10));
  const diff = dayDiff(start, day);
  switch (r.FREQ) {
    case "DAILY":
      if (diff % n) return false;
      return !r.COUNT || diff / n < Number(r.COUNT);
    case "WEEKLY": {
      const days = r.BYDAY ? r.BYDAY.split(",").map((x) => x.slice(-2)) : [BYDAY[weekdayIdx(start)]];
      if (!days.includes(BYDAY[weekdayIdx(day)])) return false;
      const weeks = Math.floor((dayDiff(start, day) + weekdayIdx(start)) / 7);
      return weeks % n === 0;
    }
    case "MONTHLY": {
      const months = (Number(day.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(day.slice(5, 7)) - Number(start.slice(5, 7));
      return day.slice(8) === start.slice(8) && months % n === 0;
    }
    case "YEARLY":
      return day.slice(5) === start.slice(5) && (Number(day.slice(0, 4)) - Number(start.slice(0, 4))) % n === 0;
    default:
      return false;
  }
}

// -> [{ id, title, start: "HH:MM" | null, end: "HH:MM" | null, allDay }] sorted by start time
export function eventsOnDay(events, day) {
  const overrides = new Map(); // uid|day -> edited / cancelled single occurrence
  for (const ev of events) if (ev.recurrenceId) overrides.set(`${ev.uid}|${ev.recurrenceId.day}`, ev);

  const out = [];
  const push = (ev, startMs, durMs, key) => out.push({
    id: key, title: ev.summary || "(no title)", allDay: ev.start.allDay,
    start: ev.start.allDay ? null : istTime(startMs), end: ev.start.allDay || durMs == null ? null : istTime(startMs + durMs),
  });
  for (const ev of events) {
    if (ev.status === "CANCELLED") continue;
    const dur = ev.end ? ev.end.ms - ev.start.ms : null;
    if (ev.recurrenceId) {
      if (ev.start.day === day) push(ev, ev.start.ms, dur, `${ev.uid}|${day}|x`);
      continue;
    }
    if (!ev.rrule) {
      if (ev.start.day === day) push(ev, ev.start.ms, dur, ev.uid || `${ev.summary}|${day}`);
      continue;
    }
    if (ev.exdates.has(day) || overrides.has(`${ev.uid}|${day}`) || !occursOn(ev, day)) continue;
    // same wall-clock time as the first occurrence (India has no daylight saving)
    const startMs = ev.start.allDay ? Date.parse(`${day}T00:00:00Z`) - IST_MS : Date.parse(`${day}T${ev.start.time}:00Z`) - IST_MS;
    push(ev, startMs, dur, `${ev.uid}|${day}`);
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? (a.start || "").localeCompare(b.start || "") : a.allDay ? -1 : 1));
}

export const todayIst = () => istDay(Date.now());
export { pad };
