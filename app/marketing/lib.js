// Marketing Organiser — plain logic shared by the page and the API route (no React, no Node-only APIs):
// seed config, IST week dates, production dates, the day plan, overdue checks,
// Instagram link normalising and cleaning items before they're stored.

// ── dates (India time, "YYYY-MM-DD" strings) ──
export const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); // b - a
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const weekdayIdx = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6
export const weekStart = (day) => addDays(day, -weekdayIdx(day));
export const weekDays = (ws) => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
export const inWeek = (day, ws) => !!day && day >= ws && day <= addDays(ws, 6);
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const fmtDay = (day, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" }) : "—";

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── statuses & formats ──
export const ORGANIC_STATUSES = ["Idea", "Planned", "Shot", "Edited", "Scheduled", "Posted"];
export const AD_STATUSES = ["Idea", "Shot/Designed", "Edited", "Live", "Paused"];
export const ORGANIC_FORMATS = ["reel", "carousel", "static", "story"];
export const AD_FORMATS = ["video", "static"];

// ── seed config (stored in S3 on first save, then edited in Settings) ──
const SEED_CATEGORIES = [
  {
    id: "ads", name: "Ads", noRepeatWeeks: 0, series: false,
    requirements: ["Visually makeup related", "No pretty-girl visuals", "Something that is quick", "Shows results", "No long explanations", "Shows proof", "Doesn't give everything away"],
    concepts: ["Good v/s Bad", "Time Challenge Product Proof", "10 Sec Shopping Vid – Girl Girl", "10 Sec Shade Guide Vid – Girl Girl", "Designed By Woman", "Graphic Video", "Street Reviews"],
  },
  {
    id: "challenge", name: "Challenge/Series", noRepeatWeeks: 0, series: true,
    requirements: ["Shows product proof", "Can be a template", "Is repetitive", "People want more", "People connect", "Creates a pattern", "A standard visual", "Instantly recognisable", "Gives engagement"],
    concepts: ["In Store Shade Challenge", "30 Day Challenge", "Drawer Product Finder", "Makeup Bag Shade Guide", "Online Shade Challenge"],
  },
  {
    id: "fun", name: "Fun", noRepeatWeeks: 3, series: false,
    requirements: ["Copy viral Insta reels", "10–15 sec reels", "No script needed", "Can be made in an hour", "Creates following", "Creates engagement"],
    concepts: ["Too Many Lipsticks", "Bag Not Closing Problem", "Changing Looks", "Click Makeup", "Air Makeup", "Matching With Bestie", "Lips Mature", "Hand Gesture", "Girl With 2 Personalities", "Girl Grip", "Problem Areas", "Product Show", "No Makeup Men"],
  },
  {
    id: "educational", name: "Educational", noRepeatWeeks: 3, series: false,
    requirements: ["Carousel posts", "Fun info", "Relate to brands/products", "Compare people"],
    concepts: ["How We Detect Undertone", "Why Categories Are Imp", "Brand Shade Data", "New Product Shade Analysis", "Skintone Depth"],
  },
  {
    id: "stories", name: "Stories", noRepeatWeeks: 0, series: false,
    requirements: ["Hint of info", "Very casual content", "Interactive content", "\"Today's ___ of the day\""],
    concepts: ["Article Of The Day", "Lip Shade Of The Day", "Product Of The Day", "Behind The Scenes", "Reviews", "Testimony", "Quiz", "Polls", "Questions", "Makeup Bag For Celeb"],
  },
];

export function seedConfig() {
  const story = { categoryId: "stories", format: "story" };
  const slot = (categoryId, format) => [{ categoryId, format }, story];
  return {
    version: 1,
    categories: SEED_CATEGORIES.map((c) => ({
      id: c.id, name: c.name, noRepeatWeeks: c.noRepeatWeeks, series: c.series,
      requirements: c.requirements.map((text) => ({ id: `${c.id}-r-${slug(text)}`, text })),
      concepts: c.concepts.map((name) => ({ id: `${c.id}-${slug(name)}`, name })),
    })),
    // Mon … Sun: the categories planned for each day (the week board shows them as posts to add)
    template: [
      slot("educational", "carousel"), slot("fun", "reel"), slot("challenge", "reel"), slot("fun", "reel"),
      slot("educational", "carousel"), slot("challenge", "reel"), slot("fun", "reel"),
    ],
    // days before the post date; null = no such step (stories are made on the day)
    offsets: {
      fun: { shoot: 1, edit: 1 },
      challenge: { shoot: 3, edit: 2 },
      educational: { shoot: 3, edit: 2 },
      stories: { shoot: null, edit: null },
    },
    // series (categories with series: true) — the episode each series starts at
    series: {},
    ads: { categoryId: "ads", quota: { video: 2, static: 5 }, liveWeekday: 0, shootDaysBefore: 4, editDaysBefore: 3 },
  };
}

// ── names ──
// Category names are unique, and concept names are unique across all categories (ignoring case and extra spaces).
export const normName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
export const tidyName = (s) => String(s || "").trim().replace(/\s+/g, " ");
export const findCategory = (config, name) => config?.categories?.find((c) => normName(c.name) === normName(name)) || null;
export function findConcept(config, name) {
  for (const cat of config?.categories || []) {
    const concept = cat.concepts.find((k) => normName(k.name) === normName(name));
    if (concept) return { cat, concept };
  }
  return null;
}
// -> ["Category \"Fun\" is used twice", …] (empty when every name is unique)
export function duplicateNames(config) {
  const out = [];
  const cats = new Set();
  for (const c of config?.categories || []) {
    const n = normName(c.name);
    if (cats.has(n)) out.push(`Category "${tidyName(c.name)}" is used twice`);
    cats.add(n);
  }
  const concepts = new Map();
  for (const c of config?.categories || []) {
    for (const k of c.concepts) {
      const n = normName(k.name);
      if (!n) continue;
      const other = concepts.get(n);
      if (other != null) out.push(other === c.name ? `Concept "${tidyName(k.name)}" is in ${c.name} twice` : `Concept "${tidyName(k.name)}" is in both ${other} and ${c.name}`);
      else concepts.set(n, c.name);
    }
  }
  return out;
}

export const newCategory = (id, name) => ({ id, name: tidyName(name), noRepeatWeeks: 0, series: false, requirements: [], concepts: [] });

// An inspo reel's main category, plus any it's also for (e.g. an Ads reel that's also Fun inspo)
export const inspoInCat = (x, id) => x.categoryId === id || (x.alsoCategoryIds || []).includes(id);

export const catById = (config, id) => config?.categories?.find((c) => c.id === id) || null;
export const conceptName = (config, item) => {
  const c = catById(config, item.categoryId ?? config?.ads?.categoryId)?.concepts.find((x) => x.id === item.conceptId);
  return c?.name || item.conceptName || "No concept";
};
export const itemTitle = (config, item) => {
  const name = conceptName(config, item);
  if (item.episode == null) return name;
  return `${name} – ${/day/i.test(name) ? "Day" : "Ep"} ${item.episode}`;
};

// ── production dates ──
export function organicDates(config, categoryId, postDate) {
  const o = config?.offsets?.[categoryId] || { shoot: null, edit: null };
  const at = (n) => (n == null || n === "" || !postDate ? null : addDays(postDate, -Number(n)));
  return { shootDate: at(o.shoot), editDate: at(o.edit) };
}
export function adDates(config, liveDate) {
  const a = config?.ads || {};
  const at = (n) => (n == null || n === "" || !liveDate ? null : addDays(liveDate, -Number(n)));
  return { shootDate: at(a.shootDaysBefore), editDate: at(a.editDaysBefore) };
}
export const adLiveDate = (config, ws) => addDays(ws, Number(config?.ads?.liveWeekday) || 0);

// Move an item to a new post / live date. Default dates are recalculated; dates set by hand keep their gap.
export function moveItem(config, kind, item, newDate) {
  const key = kind === "ads" ? "liveDate" : "postDate";
  const old = item[key];
  if (old === newDate) return item;
  if (item.datesManual && old) {
    const d = diffDays(old, newDate);
    const shift = (x) => (x ? addDays(x, d) : x);
    return { ...item, [key]: newDate, shootDate: shift(item.shootDate), editDate: shift(item.editDate) };
  }
  const dates = kind === "ads" ? adDates(config, newDate) : organicDates(config, item.categoryId, newDate);
  return { ...item, [key]: newDate, ...dates };
}

// ── series ──
// The next episode of a series: one after the last planned before `date`, or the series' start number.
export function nextEpisode(config, items, conceptId, date) {
  const start = Math.max(1, Number(config?.series?.[conceptId]?.startAt) || 1);
  const before = items.filter((i) => i.conceptId === conceptId && i.episode != null && i.postDate && i.postDate < date).map((i) => i.episode);
  return before.length ? Math.max(Math.max(...before) + 1, start) : start;
}

export function newOrganic(config, fields) {
  const now = new Date().toISOString();
  const postDate = fields.postDate || istToday();
  return {
    id: uid(), categoryId: fields.categoryId || "", conceptId: "", conceptName: "", episode: null,
    format: fields.format || "reel", idea: "", postDate, ...organicDates(config, fields.categoryId, postDate), datesManual: false,
    status: "Planned", checks: {}, inspoIds: [], postLink: "", createdAt: now, updatedAt: now,
  };
}

export function newAd(config, fields) {
  const now = new Date().toISOString();
  const liveDate = fields.liveDate || adLiveDate(config, weekStart(istToday()));
  return {
    id: uid(), format: fields.format || "video", conceptId: "", conceptName: "", hook: "", notes: "",
    liveDate, ...adDates(config, liveDate), datesManual: false,
    status: "Idea", checks: {}, inspoIds: [], metaAd: "", createdAt: now, updatedAt: now,
  };
}

// The day's planned categories (from the weekly plan in Settings) paired with the posts added for them.
// -> [{ slot: { categoryId, format } | null, item | null }] — an empty slot is a post still to add;
//    posts that don't match a slot come last with slot: null.
export function daySlots(config, dayItems, date) {
  const left = [...dayItems];
  const out = (config.template?.[weekdayIdx(date)] || []).map((slot) => {
    const i = left.findIndex((x) => x.categoryId === slot.categoryId);
    return { slot, item: i >= 0 ? left.splice(i, 1)[0] : null };
  });
  for (const item of left) out.push({ slot: null, item });
  return out;
}

// When each concept was last used (by post / live date) — shown next to concepts when picking one
export function conceptLastUsed(items, dateKey = "postDate") {
  const m = {};
  for (const it of items) if (it.conceptId && it[dateKey] && (!m[it.conceptId] || it[dateKey] > m[it.conceptId])) m[it.conceptId] = it[dateKey];
  return m;
}

// ── overdue ──
export function overdueReasons(kind, item, today = istToday()) {
  const statuses = kind === "ads" ? AD_STATUSES : ORGANIC_STATUSES;
  const s = statuses.indexOf(item.status);
  const out = [];
  if (kind === "ads") {
    if (item.status === "Paused") return out;
    if (item.shootDate && item.shootDate < today && s < 1) out.push("shoot/design overdue");
    if (item.editDate && item.editDate < today && s < 2) out.push("edit overdue");
    if (item.liveDate && item.liveDate < today && s < 3) out.push("not live yet");
  } else {
    if (item.shootDate && item.shootDate < today && s < 2) out.push("shoot overdue");
    if (item.editDate && item.editDate < today && s < 3) out.push("edit overdue");
    if (item.postDate && item.postDate < today && s < 5) out.push("not posted");
  }
  return out;
}

// ── Instagram links ──
// -> { shortcode, kind: "reel" | "p", permalink } | { error }
export function normaliseInsta(raw) {
  const s = String(raw || "").trim();
  if (!s) return { error: "Paste an Instagram link first." };
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return { error: "That doesn't look like a link." }; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  if (host !== "instagram.com" && host !== "instagr.am") return { error: "Only Instagram links can be saved." };
  const m = u.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(reels?|p)\/([A-Za-z0-9_-]{5,})/);
  if (!m) return { error: "Paste a link to an Instagram reel or post (…/reel/…, …/reels/… or …/p/…)." };
  const kind = m[1] === "p" ? "p" : "reel";
  return { shortcode: m[2], kind, permalink: `https://www.instagram.com/${kind}/${m[2]}/` };
}

// ── cleaning what's stored (the API runs every write through these) ──
const str = (v, n = 1000) => (typeof v === "string" ? v.slice(0, n) : "");
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string").map((x) => x.slice(0, 64)))].slice(0, 50) : []);
const checks = (v) => {
  const out = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v).slice(0, 100)) if (x === true) out[k.slice(0, 120)] = true;
  return out;
};

export function cleanItem(list, raw) {
  const r = raw || {};
  const common = {
    id: str(r.id, 64) || uid(), conceptId: str(r.conceptId, 120), conceptName: str(r.conceptName, 200),
    shootDate: date(r.shootDate), editDate: date(r.editDate), datesManual: !!r.datesManual,
    checks: checks(r.checks), inspoIds: ids(r.inspoIds),
    createdAt: str(r.createdAt, 40) || new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (list === "ads") {
    return {
      ...common, format: oneOf(r.format, AD_FORMATS, "video"), hook: str(r.hook, 500), notes: str(r.notes, 3000),
      liveDate: date(r.liveDate), status: oneOf(r.status, AD_STATUSES, "Idea"), metaAd: str(r.metaAd, 200),
    };
  }
  return {
    ...common, categoryId: str(r.categoryId, 120), episode: Number.isInteger(r.episode) && r.episode > 0 ? r.episode : null,
    format: oneOf(r.format, ORGANIC_FORMATS, "reel"), idea: str(r.idea, 3000), postDate: date(r.postDate),
    status: oneOf(r.status, ORGANIC_STATUSES, "Planned"), postLink: str(r.postLink, 500),
  };
}

export function cleanConfig(raw) {
  const seed = seedConfig();
  const r = raw && typeof raw === "object" ? raw : {};
  const num = (v, d = null) => (v === null || v === "" || v === undefined ? d : Number.isFinite(Number(v)) ? Math.max(0, Math.min(60, Math.round(Number(v)))) : d);
  const categories = (Array.isArray(r.categories) ? r.categories : seed.categories).slice(0, 30).map((c) => ({
    id: str(c.id, 120) || uid(), name: tidyName(str(c.name, 80)) || "Untitled",
    noRepeatWeeks: num(c.noRepeatWeeks, 0), series: !!c.series,
    requirements: (Array.isArray(c.requirements) ? c.requirements : []).slice(0, 50)
      .map((q) => ({ id: str(q.id, 120) || uid(), text: str(q.text, 200).trim() })).filter((q) => q.text),
    concepts: (Array.isArray(c.concepts) ? c.concepts : []).slice(0, 100)
      .map((q) => ({ id: str(q.id, 120) || uid(), name: tidyName(str(q.name, 120)) })).filter((q) => q.name),
  }));
  const template = Array.from({ length: 7 }, (_, i) => (Array.isArray(r.template?.[i]) ? r.template[i] : seed.template[i]).slice(0, 10)
    .map((s) => ({ categoryId: str(s.categoryId, 120), format: oneOf(s.format, ORGANIC_FORMATS, "reel") })));
  const offsets = {};
  for (const c of categories) {
    const o = r.offsets?.[c.id] || seed.offsets[c.id] || { shoot: null, edit: null };
    offsets[c.id] = { shoot: num(o.shoot), edit: num(o.edit) };
  }
  const series = {};
  for (const [k, v] of Object.entries(r.series || {}).slice(0, 200)) series[str(k, 120)] = { active: !!v?.active, startAt: Math.max(1, Math.min(9999, Math.round(Number(v?.startAt)) || 1)) };
  const a = r.ads || seed.ads;
  const ads = {
    categoryId: str(a.categoryId, 120) || "ads",
    quota: { video: num(a.quota?.video, 2), static: num(a.quota?.static, 5) },
    liveWeekday: Math.min(6, num(a.liveWeekday, 0)), shootDaysBefore: num(a.shootDaysBefore), editDaysBefore: num(a.editDaysBefore),
  };
  return { version: 1, categories, template, offsets, series, ads };
}
