// Date ranges for Meta Ads — plain functions, used by the API route (what to fetch) and the pages (what to show).
// One refresh fetches a fixed data window; every preset / custom range is then cut from it in the browser.

export const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const fmtDay = (day, opts = { day: "numeric", month: "short" }) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
const quarterStart = (day) => { const [y, m] = day.split("-").map(Number); return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`; };
const prevQuarterStart = (qs) => { const [y, m] = qs.split("-").map(Number); return m === 1 ? `${y - 1}-10-01` : `${y}-${String(m - 3).padStart(2, "0")}-01`; };
const qLabel = (qs) => { const [y, m] = qs.split("-").map(Number); return `Q${Math.floor((m - 1) / 3) + 1} ${y}`; };

export const PRESETS = [["7d", "7 d"], ["14d", "14 d"], ["30d", "30 d"], ["90d", "90 d"], ["tq", "This quarter"], ["lq", "Last quarter"], ["custom", "Custom"]];
export const PRESET_KEYS = PRESETS.map(([k]) => k).filter((k) => k !== "custom");

// What one refresh covers, as of `today`:
//   since…until    the days you can look at — the last 90 days, and always all of last quarter
//   compareSince   daily data goes back this far, so every range has its previous period to compare with
export function dataWindow(today = istToday()) {
  const d90 = addDays(today, -89);
  const lq = prevQuarterStart(quarterStart(today));
  const since = lq < d90 ? lq : d90;
  return { since, until: today, compareSince: addDays(since, -daysBetween(since, today)) };
}

// -> { since, until, prevSince, prevUntil, days, label, prevLabel } | { error }
// `today` is the last day of the fetched data, so presets always line up with what was fetched.
export function computeRange(preset, customSince, customUntil, today = istToday(), win = dataWindow(today)) {
  const sameLength = (since, until) => {
    const n = daysBetween(since, until);
    return { since, until, prevSince: addDays(since, -n), prevUntil: addDays(since, -1) };
  };
  let r;
  if (/^\d+d$/.test(preset)) {
    const n = parseInt(preset, 10);
    r = { ...sameLength(addDays(today, -(n - 1)), today), label: `Last ${n} days` };
  } else if (preset === "tq") {
    const qs = quarterStart(today), pqs = prevQuarterStart(qs);
    const n = daysBetween(qs, today);
    const pqEnd = addDays(qs, -1); // a 92-day quarter can be longer than the one before it
    const prevUntil = addDays(pqs, n - 1) < pqEnd ? addDays(pqs, n - 1) : pqEnd;
    r = { since: qs, until: today, prevSince: pqs, prevUntil, label: `${qLabel(qs)} so far`, prevLabel: `same days of ${qLabel(pqs)}` };
  } else if (preset === "lq") {
    const lqs = prevQuarterStart(quarterStart(today)), pqs = prevQuarterStart(lqs);
    r = { since: lqs, until: addDays(quarterStart(today), -1), prevSince: pqs, prevUntil: addDays(lqs, -1), label: qLabel(lqs), prevLabel: qLabel(pqs) };
  } else {
    if (!customSince || !customUntil) return { error: "Pick a start and an end date" };
    if (customSince > customUntil) return { error: "Start date is after end date" };
    if (customSince < win.since || customUntil > win.until) {
      return { error: `Pick dates between ${fmtDay(win.since)} and ${fmtDay(win.until, { day: "numeric", month: "short", year: "numeric" })} — that's what the last refresh fetched` };
    }
    r = { ...sameLength(customSince, customUntil), label: `${fmtDay(customSince)} – ${fmtDay(customUntil)}` };
  }
  r.preset = preset;
  r.days = daysBetween(r.since, r.until);
  r.prevLabel ||= `previous ${r.days} days`;
  return r;
}
