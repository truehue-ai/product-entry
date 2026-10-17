"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BRANDS_INDIA from "./brands-india.json";
import { useActionPassword } from "../components/useActionPassword";
import BRANDS_USA from "./brands-usa.json";

const GL = {
  card: {
    background: "rgba(255,255,255,0.58)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1.5px solid rgba(255,255,255,0.8)",
    borderRadius: 18,
    boxShadow: "0 4px 24px rgba(171,31,16,0.07)",
  },
  input: {
    background: "rgba(255,255,255,0.7)",
    border: "1.5px solid rgba(171,31,16,0.15)",
    borderRadius: 11,
    padding: "11px 14px",
    fontSize: 14,
    color: "#1a0a09",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 11,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(171,31,16,0.25)",
    transition: "opacity 0.15s, transform 0.15s",
    whiteSpace: "nowrap",
  },
  btnOutline: {
    background: "rgba(255,255,255,0.7)",
    color: "#ab1f10",
    border: "1.5px solid rgba(171,31,16,0.3)",
    borderRadius: 11,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    whiteSpace: "nowrap",
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 700,
    color: "#7b241c",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.03em",
    padding: "3px 9px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  },
};

const DONE = { fg: "#15803d", bg: "rgba(22,163,74,0.1)", bar: "#16a34a" };
const TODO_C = { fg: "#b91c1c", bg: "rgba(220,38,38,0.09)", bar: "#dc2626" };

const MARKETS = {
  // To-do lists live in S3 (left-to-update-<market>/todo.json); items are removed when saved
  // brands: master brand list (slug = our S3 name, name = how the brand writes itself, aliases = other spellings)
  india: { label: "India", flag: "🇮🇳", usa: false, editor: "/color-picker", brands: BRANDS_INDIA },
  usa: { label: "USA", flag: "🇺🇸", usa: true, editor: "/color-picker-usa", brands: BRANDS_USA },
};

// Same categories (and order) as the Shade Capture editor
const CATEGORIES = [
  ["matte-lipstick", "Matte Lipstick"],
  ["satin-lipstick", "Satin Lipstick"],
  ["lip-gloss", "Lip Gloss / Lip Oil"],
  ["lip-tint", "Lip Tint / Lip Stain"],
  ["lip-balm", "Lip Balm"],
  ["foundation", "Foundation"],
  ["concealer", "Concealer"],
  ["skin-tint", "Skin Tint"],
  ["contour", "Contour"],
  ["cream-blush", "Cream / Liquid Blush"],
  ["powder-blush", "Powder Blush"],
  ["cream-eyeshadow", "Cream Eyeshadow"],
  ["powder-eyeshadow", "Powder Eyeshadow"],
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
const CATEGORY_ORDER = Object.fromEntries(CATEGORIES.map(([k], i) => [k, i]));
const categoryLabel = (c) => CATEGORY_LABEL[c] || (c ? c.replace(/-/g, " ") : "Uncategorised");

// "MAC Cosmetics", "mac-cosmetics " -> "maccosmetics" — matches to-do items to captured products
const normKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const itemKey = (brand, product) => `${normKey(brand)}|${normKey(product)}`;
// lowercase, words joined by "-" — same naming as everywhere else in S3
const slugify = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Brand slugs drop dots instead of splitting on them: "e.l.f." -> "elf", "M.A.C" -> "mac"
const slugifyBrand = (s) => slugify(String(s || "").replace(/\./g, ""));

// normKey(any spelling of a brand) -> our brand slug, from the master brand list
function buildBrandIndex(master) {
  const idx = new Map();
  (master || []).forEach((b) => [b.slug, b.name, ...(b.aliases || [])].forEach((n) => idx.set(normKey(n), b.slug)));
  return idx;
}
const canonicalBrand = (idx, input) => idx.get(normKey(String(input || "").replace(/\./g, ""))) || idx.get(normKey(input)) || slugifyBrand(input);

// "Matte Lipstick", "matte-lipstick", "Lip Gloss" -> editor category key, or "" if unknown
function toCategory(v) {
  const slug = slugify(v);
  if (!slug) return "";
  if (CATEGORY_LABEL[slug]) return slug;
  const hit = CATEGORIES.find(([, label]) => slugify(label) === slug || slugify(label).split("-").slice(0, slug.split("-").length).join("-") === slug);
  return hit ? hit[0] : "";
}

// Minimal CSV parser: handles quoted fields, commas/newlines inside quotes and "" escapes
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// CSV rows -> [{ brand, product, category }]. Uses a header row if it names the columns,
// otherwise assumes brand, product, category order.
function csvToItems(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (re, skip = -1) => head.findIndex((h, i) => i !== skip && re.test(h));
  let bi = find(/brand/);
  let pi = find(/product/, bi);
  if (pi === -1) pi = find(/name/, bi);
  let ci = find(/categor|type/, bi);
  let body = rows.slice(1);
  if (bi === -1 || pi === -1) { bi = 0; pi = 1; ci = rows[0].length > 2 ? 2 : -1; body = rows; }
  return body.map((r) => ({
    brand: (r[bi] || "").trim(),
    product: (r[pi] || "").trim(),
    category: ci >= 0 ? (r[ci] || "").trim() : "",
  }));
}

const REVIEW = { fg: "#92400e", bg: "rgba(251,191,36,0.18)" };

// ["most-popular-slug", ...] -> Map(normKey(slug) -> position)
const brandRankMap = (ranking) => new Map((ranking || []).map((b, i) => [normKey(b), i]));

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

export default function ShadeCapturePage() {
  return (
    <Suspense fallback={null}>
      <ShadeCaptureDatabase />
    </Suspense>
  );
}

function ShadeCaptureDatabase() {
  const router = useRouter();
  const sp = useSearchParams();
  const market = sp.get("market") === "usa" ? "usa" : "india";
  const groupBy = sp.get("view") === "brand" ? "brand" : "category";
  const tab = sp.get("tab") === "brands" && MARKETS[market].brands ? "brands" : "products";
  const M = MARKETS[market];

  const [catalog, setCatalog] = useState({});
  const [todos, setTodos] = useState({});
  const [skippedCount, setSkippedCount] = useState({}); // market -> number of skipped products
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState({});
  const [editingId, setEditingId] = useState(null);

  const setParams = useCallback((next) => {
    const params = new URLSearchParams();
    const mk = next.market ?? market;
    const v = next.view ?? groupBy;
    const t = next.tab ?? tab;
    if (mk === "usa") params.set("market", "usa");
    if (v === "brand") params.set("view", "brand");
    if (t === "brands") params.set("tab", "brands");
    const qs = params.toString();
    router.replace(`/shade-capture${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, market, groupBy, tab]);

  const brandIndex = useMemo(() => buildBrandIndex(MARKETS[market].brands), [market]);

  const load = useCallback(async (mk) => {
    setLoading(true);
    setError("");
    try {
      const [catRes, todoRes, skipRes] = await Promise.all([
        fetch(`/api/shade-capture/catalog?usa=${MARKETS[mk].usa ? "1" : "0"}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/shade-capture/todo?market=${mk}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/shade-capture/skipped?market=${mk}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ items: [] })),
      ]);
      setSkippedCount((prev) => ({ ...prev, [mk]: (skipRes.items || []).length }));
      const errs = [catRes.error, todoRes.error].filter(Boolean);
      if (errs.length) setError(errs.join(" · "));
      setCatalog((prev) => ({ ...prev, [mk]: catRes.products || [] }));
      setTodos((prev) => ({ ...prev, [mk]: { items: todoRes.items || [], exists: !!todoRes.exists, ranking: todoRes.ranking || [] } }));
    } catch (e) {
      setError(e?.message || "Failed to load database");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!catalog[market]) load(market);
  }, [market, catalog, load]);

  useEffect(() => { setOpen({}); setEditingId(null); }, [market, groupBy]);

  // Merge captured products (done) with the to-do list
  const rows = useMemo(() => {
    const done = catalog[market];
    const todo = todos[market];
    if (!done || !todo) return null;
    const doneByKey = new Map();
    done.forEach((d) => { const k = itemKey(d.brand, d.product); if (!doneByKey.has(k)) doneByKey.set(k, d); });

    // Queue order: brand popularity (brand-ranking.json), then the list's own order within a brand
    const rank = brandRankMap(todo.ranking);
    const UNRANKED = 1e9;
    const ordered = todo.items
      .map((t, i) => ({ t, i, r: rank.get(normKey(t.brand)) ?? UNRANKED }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.t);

    const out = [];
    const claimed = new Set();
    ordered.forEach((t, i) => {
      const k = itemKey(t.brand, t.product);
      if (claimed.has(k)) return;
      claimed.add(k);
      const d = doneByKey.get(k);
      // To-do items stay "to do" until saved (they're deleted on save) — even if the product
      // already exists, because some of its shades are still missing.
      out.push({
        id: t.id, brand: t.brand, product: t.product, type: t.category || d?.type || "",
        status: "todo", queue: i, partial: !!(t.partial || d), needsReview: t.needsReview || [], links: t.links || [],
      });
    });
    done.forEach((d) => {
      const k = itemKey(d.brand, d.product);
      if (claimed.has(k) && doneByKey.get(k) === d) return;
      out.push({ ...d, status: "done", queue: null });
    });
    return out;
  }, [catalog, todos, market]);

  // ── CSV upload: preview first, then add the new rows to this market's todo.json ──
  const fileRef = useRef(null);
  const [csv, setCsv] = useState(null); // { fileName, rows: [{ brand, product, category, status }] }
  const [csvDefaultCat, setCsvDefaultCat] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState("");

  useEffect(() => { setCsv(null); setCsvMsg(""); }, [market]);

  const onCsvFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCsvMsg("");
    const text = await file.text();
    const doneKeys = new Set((catalog[market] || []).map((d) => itemKey(d.brand, d.product)));
    const todoKeys = new Set((todos[market]?.items || []).map((t) => itemKey(t.brand, t.product)));
    const seen = new Set();
    const parsed = csvToItems(text).map((it) => {
      // brand names are matched to the master list ("e.l.f. Cosmetics" -> elf-cosmetics)
      const brand = canonicalBrand(brandIndex, it.brand), product = slugify(it.product);
      const k = itemKey(brand, product);
      let status = "new";
      if (!brand || !product) status = "invalid";
      else if (doneKeys.has(k)) status = "done";
      else if (todoKeys.has(k)) status = "todo";
      else if (seen.has(k)) status = "duplicate";
      seen.add(k);
      return { brand, rawBrand: it.brand, product, rawCategory: it.category, category: toCategory(it.category), status };
    });
    setCsvDefaultCat("");
    setCsv({ fileName: file.name, rows: parsed });
  };

  const knownBrands = useMemo(() => {
    if (!MARKETS[market].brands) return null;
    const set = new Set(MARKETS[market].brands.map((b) => b.slug));
    (catalog[market] || []).forEach((d) => set.add(d.brand));
    (todos[market]?.items || []).forEach((t) => set.add(t.brand));
    return set;
  }, [market, catalog, todos]);

  // Per-brand counts: master list + any brand that has captured products or to-dos
  const brandStats = useMemo(() => {
    const master = MARKETS[market].brands;
    if (!rows || !master) return null;
    const rank = brandRankMap(todos[market]?.ranking);
    const map = new Map();
    master.forEach((b) => map.set(b.slug, { slug: b.slug, name: b.name, inMaster: true, done: 0, todo: 0 }));
    for (const r of rows) {
      const slug = brandIndex.get(normKey(r.brand)) || r.brand;
      if (!slug) continue;
      if (!map.has(slug)) map.set(slug, { slug, name: slug, inMaster: false, done: 0, todo: 0 });
      map.get(slug)[r.status === "done" ? "done" : "todo"]++;
    }
    return [...map.values()].map((b) => ({ ...b, rank: rank.has(normKey(b.slug)) ? rank.get(normKey(b.slug)) + 1 : null }));
  }, [rows, market, brandIndex, todos]);

  const openBrand = (slug) => {
    setSearch(slug);
    setStatusFilter("all");
    setParams({ tab: "products", view: "brand" });
  };

  const csvCounts = useMemo(() => {
    const c = { new: 0, done: 0, todo: 0, invalid: 0, duplicate: 0 };
    (csv?.rows || []).forEach((r) => { c[r.status]++; });
    return c;
  }, [csv]);

  const submitCsv = async () => {
    const newRows = csv.rows.filter((r) => r.status === "new");
    if (!newRows.length) return;
    setCsvBusy(true);
    setCsvMsg("");
    try {
      const r = await fetch("/api/shade-capture/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market,
          items: newRows.map((x) => ({ brand: x.brand, product: x.product, category: x.category || csvDefaultCat })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Upload failed");
      setTodos((prev) => ({ ...prev, [market]: { ...prev[market], items: j.items || [], exists: true } }));
      const extra = [
        j.alreadyDone?.length ? `${j.alreadyDone.length} already captured` : "",
        j.alreadyTodo?.length ? `${j.alreadyTodo.length} already on the list` : "",
      ].filter(Boolean).join(", ");
      setCsvMsg(`✓ Added ${j.added.length} product${j.added.length === 1 ? "" : "s"} to the ${M.label} to-do list${extra ? ` (skipped ${extra})` : ""}.`);
      setCsv(null);
    } catch (e) {
      setCsvMsg(`Upload failed: ${e?.message || "unknown error"}`);
    } finally {
      setCsvBusy(false);
    }
  };

  const saveFix = async (id, fields) => {
    const r = await fetch("/api/shade-capture/todo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market, id, ...fields, brand: canonicalBrand(brandIndex, fields.brand) }),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || "Could not save");
    setTodos((prev) => ({
      ...prev,
      [market]: { ...prev[market], items: prev[market].items.map((it) => (it.id === id ? j.item : it)) },
    }));
    setEditingId(null);
  };

  // Skip from Up next: move the item from the to-do list into skipped/skipped-<market>.json
  const skipTodo = async (row, reason, duplicateOf = null) => {
    const item = (todos[market]?.items || []).find((it) => it.id === row.id) ||
      { id: row.id, brand: row.brand, product: row.product, category: row.type, links: row.links || [] };
    const r = await fetch("/api/shade-capture/skipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market, item, reason, ...(duplicateOf ? { duplicateOf } : {}) }),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || "Could not skip");
    setTodos((prev) => ({ ...prev, [market]: { ...prev[market], items: j.todo || [] } }));
    setSkippedCount((prev) => ({ ...prev, [market]: (j.skipped || []).length }));
  };

  const doneCount = rows ? rows.filter((r) => r.status === "done").length : 0;
  const todoRows = useMemo(
    () => (rows || []).filter((r) => r.status === "todo").sort((a, b) => a.queue - b.queue),
    [rows]
  );
  const total = doneCount + todoRows.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  // Up next can be narrowed to one category; remembered per market in this browser
  const [upNextCat, setUpNextCat] = useState("");
  useEffect(() => {
    try { setUpNextCat(localStorage.getItem(`th_upnext_cat_${market}`) || ""); } catch { setUpNextCat(""); }
  }, [market]);
  const pickUpNextCat = (c) => {
    setUpNextCat(c);
    try { localStorage.setItem(`th_upnext_cat_${market}`, c); } catch { /* not persisted */ }
  };
  const todoCats = useMemo(() => {
    const counts = {};
    todoRows.forEach((r) => { counts[r.type || ""] = (counts[r.type || ""] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => (CATEGORY_ORDER[a[0]] ?? 99) - (CATEGORY_ORDER[b[0]] ?? 99) || a[0].localeCompare(b[0]));
  }, [todoRows]);
  const queue = upNextCat ? todoRows.filter((r) => (r.type || "") === upNextCat) : todoRows;
  const hasTodoList = !!todos[market]?.exists;
  const reviewCount = todoRows.filter((r) => r.needsReview?.length).length;

  // For the Up next card: brand display name, popularity rank and captured/to-do counts
  const brandInfo = useMemo(() => {
    const names = new Map((M.brands || []).map((b) => [normKey(b.slug), b.name]));
    const rank = brandRankMap(todos[market]?.ranking);
    const counts = new Map();
    (rows || []).forEach((r) => {
      const k = normKey(r.brand);
      if (!counts.has(k)) counts.set(k, { done: 0, todo: 0 });
      counts.get(k)[r.status === "done" ? "done" : "todo"]++;
    });
    return (brand) => {
      const k = normKey(brand);
      return {
        name: names.get(k) || brand,
        rank: rank.has(k) ? rank.get(k) + 1 : null,
        ...(counts.get(k) || { done: 0, todo: 0 }),
      };
    };
  }, [M.brands, todos, market, rows]);

  const listRef = useRef(null);
  const seeAllTodos = () => {
    setSearch("");
    setStatusFilter("todo");
    setParams({ tab: "products" });
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const groups = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) =>
      (statusFilter === "all" || r.status === statusFilter) &&
      (!q || r.brand.toLowerCase().includes(q) || r.product.toLowerCase().includes(q))
    );
    const map = new Map();
    for (const r of filtered) {
      // brands are grouped by exact spelling, like Product Logs, so misspelled folders stay visible
      const key = groupBy === "brand" ? r.brand : r.type || "";
      if (!map.has(key)) map.set(key, { key, label: groupBy === "brand" ? r.brand || "No brand in link" : categoryLabel(r.type), rows: [] });
      map.get(key).rows.push(r);
    }
    const list = [...map.values()];
    list.forEach((g) => {
      g.rows.sort((a, b) =>
        a.status !== b.status ? (a.status === "todo" ? -1 : 1)
        : a.status === "todo" ? a.queue - b.queue
        : a.product.localeCompare(b.product)
      );
      g.done = g.rows.filter((r) => r.status === "done").length;
      g.todo = g.rows.length - g.done;
    });
    if (groupBy === "brand") list.sort((a, b) => a.label.trim().localeCompare(b.label.trim(), undefined, { sensitivity: "base" }) || a.label.localeCompare(b.label));
    else list.sort((a, b) => (CATEGORY_ORDER[a.key] ?? 99) - (CATEGORY_ORDER[b.key] ?? 99) || a.label.localeCompare(b.label));
    return list;
  }, [rows, search, statusFilter, groupBy]);

  const searching = search.trim().length > 0;
  const isOpen = (key) => searching || !!open[key];
  const allOpen = groups.length > 0 && groups.every((g) => open[g.key]);
  const toggleAll = () => setOpen(allOpen ? {} : Object.fromEntries(groups.map((g) => [g.key, true])));

  const openEditor = (r) => {
    const params = new URLSearchParams({ brand: r.brand, product: r.product });
    if (r.status === "todo" && r.type) params.set("category", r.type);
    if (r.status === "todo" && r.id) params.set("todo", r.id);
    router.push(`${M.editor}?${params.toString()}`);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)",
      fontFamily: "'Inter', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .th-btn-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .group-head:hover { background: rgba(171,31,16,0.03); }
        .db-row:hover { background: rgba(255,255,255,0.85) !important; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .db-row { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto auto; gap: 14px; align-items: center; }
        .brand-head, .brand-row { display: grid; grid-template-columns: minmax(0, 1fr) 80px 80px 140px; gap: 14px; align-items: center; }
        .brand-row:hover { background: rgba(171,31,16,0.03); }
        .upnext-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 16px; align-items: stretch; }
        .cat-chips { display: flex; gap: 6px; overflow-x: auto; padding: 2px 2px 6px; scrollbar-width: thin; }
        .cat-chip { border: 1.5px solid rgba(171,31,16,0.14); background: rgba(255,255,255,0.7); color: #7b241c; border-radius: 999px;
          padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center;
          transition: background 0.15s, border-color 0.15s, color 0.15s; }
        .cat-chip:hover { border-color: #ab1f10; }
        .cat-chip.active { background: #ab1f10; border-color: #ab1f10; color: #fff; }
        .cat-chip .n { font-weight: 500; opacity: 0.7; font-size: 12px; }
        .queue-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 10px;
          border-radius: 11px; cursor: pointer; transition: background 0.12s; }
        .queue-row:hover { background: rgba(171,31,16,0.05); }
        .queue-row .go { opacity: 0; transition: opacity 0.12s; }
        .queue-row:hover .go { opacity: 1; }
        @keyframes upnextIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .upnext-hero { animation: upnextIn 0.25s ease both; }
        @media (max-width: 720px) {
          .stats-grid { grid-template-columns: 1fr; }
          .db-row { grid-template-columns: 14px minmax(0, 1fr) auto; }
          .db-row .row-meta { display: none; }
          .brand-head, .brand-row { grid-template-columns: minmax(0, 1fr) 64px 64px; }
          .brand-bar { display: none; }
          .upnext-grid { grid-template-columns: 1fr; }
          .queue-row .go { opacity: 1; }
        }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
      `}</style>

      {/* ── Top Nav ── */}
      <div className="m-topbar" style={{
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        background: "rgba(255,255,255,0.65)",
        borderBottom: "1px solid rgba(255,255,255,0.8)",
        padding: "14px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        position: "sticky", top: 0, zIndex: 40,
        boxShadow: "0 1px 12px rgba(171,31,16,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <NavBtn onClick={() => router.push("/")} strong>← Home</NavBtn>
          <NavBtn onClick={() => router.push(`/logs${market === "usa" ? "?market=usa" : ""}`)}>Product Logs</NavBtn>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>Shade Capture</span>
        <Segmented
          value={market}
          onChange={(k) => { setSearch(""); setParams({ market: k }); }}
          options={Object.entries(MARKETS).map(([k, m]) => [k, `${m.flag} ${m.label}`])}
        />
      </div>

      <div className="m-pad" style={{ padding: "24px 28px", maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* ── Progress ── */}
        <div className="stats-grid">
          <StatCard label="Done" value={rows ? doneCount : "—"} color={DONE.fg} sub="products with shades captured" />
          <StatCard label="To do" value={rows ? todoRows.length : "—"} color={TODO_C.fg} sub={!hasTodoList ? "no to-do list added yet" : reviewCount ? `${reviewCount} need a name check` : "left on the to-do list"} />
          <div style={{ ...GL.card, padding: "18px 20px" }}>
            <div style={GL.sectionHeader}>{M.flag} {M.label} progress</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#1a0a09", margin: "6px 0 10px" }}>{rows ? `${pct}%` : "—"}</div>
            <ProgressBar done={doneCount} todo={todoRows.length} height={8} />
          </div>
        </div>

        {/* ── Up next ── */}
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onCsvFile} hidden />
        <UpNextPanel
          loaded={!!rows}
          loading={loading}
          queue={queue}
          totalTodo={todoRows.length}
          cats={todoCats}
          cat={upNextCat}
          onPickCat={pickUpNextCat}
          brandInfo={brandInfo}
          hasTodoList={hasTodoList}
          market={market}
          onOpen={openEditor}
          onSaveFix={saveFix}
          onUploadCsv={() => fileRef.current?.click()}
          onAddNew={() => router.push(M.editor)}
          onSeeAll={seeAllTodos}
          onSkip={skipTodo}
          savedProducts={catalog[market] || []}
          skippedCount={skippedCount[market] ?? null}
          onOpenSkipped={() => router.push(`/shade-capture/skipped${market === "usa" ? "?market=usa" : ""}`)}
        />

        {/* ── Make live ── */}
        {rows && (
          <MakeLivePanel
            key={market}
            market={market}
            marketLabel={M.label}
            products={catalog[market] || []}
            brandInfo={brandInfo}
            onLive={(added) => {
              const keys = new Set(added.map((a) => `${a.brand}:::${a.product}`));
              setCatalog((prev) => ({
                ...prev,
                [market]: (prev[market] || []).map((p) => (keys.has(`${p.brand}:::${p.product}`) ? { ...p, live: true } : p)),
              }));
            }}
          />
        )}

        {/* ── CSV upload preview ── */}
        {(csv || csvMsg) && (
          <div style={{ ...GL.card, padding: "20px 22px" }}>
            {csvMsg && (
              <div style={{ fontSize: 14, fontWeight: 600, color: csvMsg.startsWith("✓") ? DONE.fg : "#c0392b", marginBottom: csv ? 14 : 0, display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{csvMsg}</span>
                {!csv && <button onClick={() => setCsvMsg("")} style={linkBtn}>Dismiss</button>}
              </div>
            )}
            {csv && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={GL.sectionHeader}>{M.flag} CSV upload — {csv.fileName}</div>
                    <div style={{ fontSize: 13, color: "#9b4a42", marginTop: 4 }}>
                      Products already captured or already on the to-do list are left alone; only new ones are added.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ ...GL.pill, background: TODO_C.bg, color: TODO_C.fg }}>{csvCounts.new} new</span>
                    <span style={{ ...GL.pill, background: DONE.bg, color: DONE.fg }}>{csvCounts.done} already captured</span>
                    <span style={{ ...GL.pill, background: "rgba(0,0,0,0.05)", color: "#7b6b6b" }}>{csvCounts.todo} already on list</span>
                    {csvCounts.duplicate > 0 && <span style={{ ...GL.pill, background: "rgba(0,0,0,0.05)", color: "#7b6b6b" }}>{csvCounts.duplicate} repeated</span>}
                    {csvCounts.invalid > 0 && <span style={{ ...GL.pill, background: REVIEW.bg, color: REVIEW.fg }}>{csvCounts.invalid} missing brand/product</span>}
                  </div>
                </div>

                {csvCounts.new > 0 && (
                  <>
                    <div style={{ marginTop: 14, maxHeight: 260, overflowY: "auto", borderRadius: 10, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(171,31,16,0.08)" }}>
                      {csv.rows.filter((r) => r.status === "new").slice(0, 300).map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "7px 12px", fontSize: 13, borderBottom: "1px solid rgba(171,31,16,0.05)", flexWrap: "wrap" }}>
                          <span style={{ color: "#7b241c", minWidth: 140 }}>
                            {r.brand}
                            {knownBrands && !knownBrands.has(r.brand) && (
                              <span title="Not in the master brand list and nothing captured for it yet — check the spelling"
                                style={{ ...GL.pill, marginLeft: 6, background: REVIEW.bg, color: REVIEW.fg }}>new brand</span>
                            )}
                          </span>
                          <span style={{ fontWeight: 600, color: "#1a0a09", flex: 1 }}>{r.product}</span>
                          <span style={{ color: r.category ? "#9b4a42" : "#c0b0b0" }}>
                            {r.category ? categoryLabel(r.category) : r.rawCategory ? `“${r.rawCategory}” not recognised` : "no category"}
                          </span>
                        </div>
                      ))}
                      {csvCounts.new > 300 && <div style={{ padding: "7px 12px", fontSize: 12, color: "#b08080" }}>+ {csvCounts.new - 300} more</div>}
                    </div>
                    {csv.rows.some((r) => r.status === "new" && !r.category) && (
                      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontSize: 13, color: "#7b241c", fontWeight: 600, flexWrap: "wrap" }}>
                        Category for rows without one:
                        <select className="th-input" value={csvDefaultCat} onChange={(e) => setCsvDefaultCat(e.target.value)}
                          style={{ ...GL.input, width: "auto", padding: "7px 11px", fontSize: 13, cursor: "pointer" }}>
                          <option value="">Leave empty (set later with Fix name)</option>
                          {CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                      </label>
                    )}
                  </>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  <button className="th-btn-primary" onClick={submitCsv} disabled={csvBusy || csvCounts.new === 0}
                    style={{ ...GL.btnPrimary, opacity: csvBusy || csvCounts.new === 0 ? 0.5 : 1, cursor: csvBusy || csvCounts.new === 0 ? "not-allowed" : "pointer" }}>
                    {csvBusy ? "Adding…" : csvCounts.new === 0 ? "Nothing new to add" : `Add ${csvCounts.new} to ${M.label} to-do list`}
                  </button>
                  <button className="th-btn-outline" style={GL.btnOutline} onClick={() => { setCsv(null); setCsvMsg(""); }} disabled={csvBusy}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Products / Brands ── */}
        {M.brands && (
          <Segmented
            value={tab}
            onChange={(t) => setParams({ tab: t })}
            options={[["products", "Products"], ["brands", `Brands${brandStats ? ` (${brandStats.length})` : ""}`]]}
          />
        )}

        {tab === "brands" && (
          brandStats
            ? <BrandsPanel stats={brandStats} onOpen={openBrand} />
            : <div style={{ ...GL.card, padding: 32, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>{loading ? "Loading brands…" : ""}</div>
        )}

        {tab === "products" && <>
        <div ref={listRef} style={{ scrollMarginTop: 90 }} />
        {/* ── Toolbar ── */}
        <div style={{ ...GL.card, padding: "12px 14px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Segmented
            value={groupBy}
            onChange={(v) => setParams({ view: v })}
            options={[["category", "By category"], ["brand", "By brand"]]}
          />
          <input
            className="th-input"
            style={{ ...GL.input, flex: "1 1 220px", width: "auto" }}
            placeholder="Search brand or product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Segmented
            value={statusFilter}
            onChange={setStatusFilter}
            options={[["all", "All"], ["todo", "To do"], ["done", "Done"]]}
          />
          <button className="th-btn-ghost" onClick={toggleAll} disabled={searching}
            style={{ background: "none", border: "none", cursor: searching ? "default" : "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "8px 10px", borderRadius: 8, opacity: searching ? 0.4 : 1 }}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
          <button className="th-btn-ghost" onClick={() => load(market)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "8px 10px", borderRadius: 8 }}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>

        {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}

        {/* ── Database ── */}
        {rows && groups.length === 0 && (
          <div style={{ ...GL.card, padding: 32, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>Nothing matches.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.map((g) => (
            <div key={g.key} style={{ ...GL.card, overflow: "hidden" }}>
              <div
                className="group-head"
                onClick={() => !searching && setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                style={{ padding: "14px 20px", cursor: searching ? "default" : "pointer", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}
              >
                <span style={{ color: "#ab1f10", fontSize: 12, display: "inline-block", width: 10, transform: isOpen(g.key) ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#1a0a09", flex: "1 1 160px", textTransform: groupBy === "category" ? "capitalize" : "none" }}>{g.label}</span>
                <span style={{ ...GL.pill, background: DONE.bg, color: DONE.fg }}>{g.done} done</span>
                {g.todo > 0 && <span style={{ ...GL.pill, background: TODO_C.bg, color: TODO_C.fg }}>{g.todo} to do</span>}
                <div style={{ width: 120 }}><ProgressBar done={g.done} todo={g.todo} height={6} /></div>
              </div>

              {isOpen(g.key) && (
                <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {g.rows.map((r) => (
                    <Row
                      key={`${r.status}|${r.brand}|${r.product}`}
                      r={r}
                      secondary={groupBy === "brand" ? categoryLabel(r.type) : r.brand}
                      onOpen={() => openEditor(r)}
                      canFix={r.status === "todo"}
                      editing={editingId === r.id}
                      onEdit={() => setEditingId(editingId === r.id ? null : r.id)}
                      onSaveFix={(fields) => saveFix(r.id, fields)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        </>}
      </div>
      {M.brands && (
        <datalist id="th-brand-list">
          {M.brands.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </datalist>
      )}
    </div>
  );
}

const BRAND_FILTERS = [["all", "All"], ["todo", "Has to-do"], ["captured", "Captured"], ["empty", "Not started"]];

// Every brand with how many products are captured / still to do
function BrandsPanel({ stats, onOpen }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(() => (stats.some((b) => b.rank) ? "popular" : "name"));

  const totals = useMemo(() => ({
    all: stats.length,
    todo: stats.filter((b) => b.todo > 0).length,
    captured: stats.filter((b) => b.done > 0).length,
    empty: stats.filter((b) => !b.done && !b.todo).length,
  }), [stats]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = stats.filter((b) =>
      (!needle || b.slug.includes(needle) || b.name.toLowerCase().includes(needle)) &&
      (filter === "all" || (filter === "todo" && b.todo > 0) || (filter === "captured" && b.done > 0) || (filter === "empty" && !b.done && !b.todo))
    );
    const byName = (a, b) => a.slug.localeCompare(b.slug);
    if (sort === "popular") out.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.todo - a.todo || byName(a, b));
    else if (sort === "todo") out.sort((a, b) => b.todo - a.todo || byName(a, b));
    else if (sort === "done") out.sort((a, b) => b.done - a.done || byName(a, b));
    else out.sort(byName);
    return out;
  }, [stats, q, filter, sort]);

  return (
    <div style={{ ...GL.card, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid rgba(171,31,16,0.08)" }}>
        <input className="th-input" style={{ ...GL.input, flex: "1 1 200px", width: "auto" }} placeholder="Search brands…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented value={filter} onChange={setFilter} options={BRAND_FILTERS.map(([k, l]) => [k, `${l} (${totals[k]})`])} />
        <select className="th-input" value={sort} onChange={(e) => setSort(e.target.value)}
          style={{ ...GL.input, width: "auto", padding: "8px 11px", fontSize: 13, cursor: "pointer" }}>
          <option value="popular">Sort: popularity</option>
          <option value="name">Sort: A–Z</option>
          <option value="todo">Sort: most to do</option>
          <option value="done">Sort: most captured</option>
        </select>
      </div>

      <div className="brand-head" style={{ padding: "8px 16px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        <span>Brand</span><span style={{ textAlign: "right" }}>Captured</span><span style={{ textAlign: "right" }}>To do</span><span className="brand-bar">Progress</span>
      </div>
      <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
        {list.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 14, color: "#9b4a42" }}>No brands match.</div>}
        {list.map((b) => {
          const empty = !b.done && !b.todo;
          return (
            <div key={b.slug} className="brand-row" onClick={() => !empty && onOpen(b.slug)}
              style={{ padding: "10px 16px", borderTop: "1px solid rgba(171,31,16,0.05)", cursor: empty ? "default" : "pointer" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {b.rank && (
                    <span title="Popularity rank — to-dos for higher-ranked brands come first in the queue"
                      style={{ ...GL.pill, background: "rgba(171,31,16,0.08)", color: "#ab1f10" }}>#{b.rank}</span>
                  )}
                  {b.name}
                  {!b.inMaster && (
                    <span title="Has products in S3 or on the to-do list but isn't in the master brand list — may be a misspelling"
                      style={{ ...GL.pill, background: REVIEW.bg, color: REVIEW.fg }}>not in master list</span>
                  )}
                  {empty && <span style={{ ...GL.pill, background: "rgba(0,0,0,0.05)", color: "#8a7a7a" }}>not started</span>}
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "#9b4a42" }}>{b.slug}</div>
              </div>
              <span style={{ textAlign: "right", fontSize: 15, fontWeight: 700, color: b.done ? DONE.fg : "#c0b0b0" }}>{b.done}</span>
              <span style={{ textAlign: "right", fontSize: 15, fontWeight: 700, color: b.todo ? TODO_C.fg : "#c0b0b0" }}>{b.todo}</span>
              <div className="brand-bar"><ProgressBar done={b.done} todo={b.todo} height={6} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ r, secondary, onOpen, canFix, editing, onEdit, onSaveFix }) {
  const done = r.status === "done";
  const C = done ? DONE : TODO_C;
  const [showLinks, setShowLinks] = useState(false);
  return (
    <div style={{
      borderRadius: 11,
      background: done ? "rgba(255,255,255,0.6)" : "rgba(254,242,242,0.85)",
      borderLeft: `4px solid ${C.bar}`,
    }}>
      <div className="db-row" style={{ padding: "10px 12px" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.bar }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product}</div>
          <div style={{ fontSize: 12, color: "#9b4a42", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ textTransform: "capitalize" }}>{secondary}</span>
            {!done && <TodoTags r={r} />}
            {!done && r.links?.length > 0 && (
              <button onClick={() => setShowLinks((v) => !v)} style={linkBtn}>
                {showLinks ? "Hide" : "Show"} {r.links.length} link{r.links.length === 1 ? "" : "s"}
              </button>
            )}
            {canFix && <button onClick={onEdit} style={linkBtn}>{editing ? "Cancel" : "Fix name"}</button>}
          </div>
        </div>
        <div className="row-meta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {done ? (
            <>
              <span style={{ fontSize: 12, color: "#9b4a42" }}>{fmtDate(r.updatedAt)}</span>
              <span
                title={r.live ? "In the app catalogue (all-data)" : "Saved but not made live yet"}
                style={{ ...GL.pill, background: r.live ? DONE.bg : "rgba(0,0,0,0.05)", color: r.live ? DONE.fg : "#8a7a7a" }}
              >
                {r.live ? "Live" : "Not live"}
              </span>
              <span
                title={r.verified ? "Checked and marked verified" : "Not verified yet — mark it in Product Logs or the Shade Capture editor"}
                style={{ ...GL.pill, background: r.verified ? "rgba(37,99,235,0.1)" : "rgba(0,0,0,0.04)", color: r.verified ? "#1d4ed8" : "#a09090" }}
              >
                {r.verified ? "✓ Verified" : "Unverified"}
              </span>
            </>
          ) : (
            <span style={{ ...GL.pill, background: TODO_C.bg, color: TODO_C.fg }}>#{r.queue + 1} in queue</span>
          )}
        </div>
        {done ? (
          <button className="th-btn-outline" style={{ ...GL.btnOutline, padding: "7px 14px" }} onClick={onOpen}>Edit</button>
        ) : (
          <button className="th-btn-primary" style={{ ...GL.btnPrimary, padding: "8px 16px", fontSize: 13 }} onClick={onOpen}>Add →</button>
        )}
      </div>
      {showLinks && <div style={{ padding: "0 12px 10px 40px" }}><SourceLinks links={r.links} open /></div>}
      {editing && <FixForm r={r} onSave={onSaveFix} onCancel={onEdit} />}
    </div>
  );
}

const SKIP_OPTIONS = [
  ["already-added", "✓ Already added"],
  ["website-not-found", "🔍 Couldn't find website"],
  ["discontinued", "⛔ Product discontinued"],
  ["out-of-stock", "📦 All shades out of stock"],
];

// "Already added": pick which saved product this to-do already is, with one saved shade link to cross-check
function DuplicatePicker({ usa, brand, saved, brandInfo, busy, onPick, onCancel }) {
  const brands = useMemo(() => [...new Set(saved.map((p) => p.brand))].sort((a, b) => a.trim().localeCompare(b.trim())), [saved]);
  const [chosenBrand, setChosenBrand] = useState(() => brands.find((b) => normKey(b) === normKey(brand)) || brand || "");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);
  const [details, setDetails] = useState({}); // "brand:::product" -> { link, shades }
  const [loadingLinks, setLoadingLinks] = useState(false);

  const products = useMemo(
    () => saved.filter((p) => normKey(p.brand) === normKey(chosenBrand)).sort((a, b) => a.product.localeCompare(b.product)),
    [saved, chosenBrand]
  );
  const keyOf = (p) => `${p.brand}:::${p.product}`;

  // one saved shade link per product, for cross-checking
  useEffect(() => {
    setPicked(null);
    if (!products.length) return;
    let active = true;
    setLoadingLinks(true);
    fetch("/api/logs/brand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usa, items: products.map((p) => ({ brand: p.brand, product: p.product })) }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!active) return;
        const map = {};
        (j.products || []).forEach((p) => {
          map[`${p.brand}:::${p.product}`] = { link: (p.shades || []).find((s) => s.link)?.link || "", shades: (p.shades || []).length };
        });
        setDetails(map);
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingLinks(false); });
    return () => { active = false; };
  }, [products, usa]);

  const needle = q.trim().toLowerCase();
  const shown = products.filter((p) => !needle || p.product.toLowerCase().includes(needle));

  return (
    <div style={{ flexBasis: "100%", marginTop: 4, borderRadius: 12, background: "rgba(255,255,255,0.85)", border: "1px solid rgba(171,31,16,0.12)",
      padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a0a09" }}>Which saved product is it?</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 200px", fontSize: 11, fontWeight: 700, color: "#7b241c" }}>
          BRAND
          <input className="th-input" list="th-dup-brands" value={chosenBrand} onChange={(e) => setChosenBrand(e.target.value)}
            style={{ ...GL.input, padding: "8px 11px", fontSize: 13 }} />
          <datalist id="th-dup-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label style={{ flex: "2 1 220px", fontSize: 11, fontWeight: 700, color: "#7b241c" }}>
          SEARCH {products.length ? `${products.length} SAVED PRODUCTS` : ""}
          <input className="th-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter products…"
            style={{ ...GL.input, padding: "8px 11px", fontSize: 13 }} />
        </label>
      </div>

      {products.length === 0 ? (
        <div style={{ fontSize: 13, color: "#9b4a42" }}>
          No saved products for “{chosenBrand || "—"}”. If it's saved under another brand spelling, pick that brand above.
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: "auto", borderRadius: 10, border: "1px solid rgba(171,31,16,0.08)" }}>
          {shown.map((p) => {
            const d = details[keyOf(p)];
            const on = picked && keyOf(picked) === keyOf(p);
            return (
              <div key={keyOf(p)} onClick={() => setPicked(p)}
                style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 10, alignItems: "start", padding: "8px 10px", cursor: "pointer",
                  borderBottom: "1px solid rgba(171,31,16,0.05)", background: on ? "rgba(171,31,16,0.07)" : "transparent" }}>
                <input type="radio" readOnly checked={!!on} style={{ accentColor: "#ab1f10", marginTop: 3 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1a0a09" }}>{p.product}</div>
                  <div style={{ fontSize: 12, color: "#9b4a42" }}>
                    {categoryLabel(p.type)}{d ? ` · ${d.shades} shade${d.shades === 1 ? "" : "s"}` : ""}{p.live ? " · Live" : ""}
                  </div>
                  <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d?.link ? (
                      <a href={d.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#7b241c" }}>{d.link}</a>
                    ) : (
                      <span style={{ color: "#c0b0b0" }}>{loadingLinks && !d ? "Loading link…" : "No saved link"}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <div style={{ padding: 12, fontSize: 13, color: "#9b4a42" }}>No products match.</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="th-btn-primary" disabled={!picked || busy}
          onClick={() => onPick({ brand: picked.brand, product: picked.product, link: details[keyOf(picked)]?.link || "" })}
          style={{ ...GL.btnPrimary, padding: "9px 16px", fontSize: 13, opacity: !picked || busy ? 0.5 : 1, cursor: !picked || busy ? "not-allowed" : "pointer" }}>
          {busy ? "Skipping…" : picked ? `Skip — already added as “${picked.product}”` : "Pick the saved product"}
        </button>
        <button onClick={onCancel} disabled={busy} style={{ ...linkBtn, fontSize: 13 }}>Back</button>
      </div>
    </div>
  );
}

function UpNextPanel({ loaded, loading, queue, totalTodo, cats, cat, onPickCat, brandInfo, hasTodoList, market,
  onOpen, onSaveFix, onUploadCsv, onAddNew, onSeeAll, onSkip, skippedCount, onOpenSkipped, savedProducts }) {
  const next = queue[0];
  const later = queue.slice(1, 7);
  const [fixing, setFixing] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [skipping, setSkipping] = useState(false); // showing the reason choice
  const [skipBusy, setSkipBusy] = useState("");    // reason being saved
  const [skipErr, setSkipErr] = useState("");
  const [pickingDup, setPickingDup] = useState(false); // "already added": choosing the saved product
  useEffect(() => { setFixing(false); setShowLinks(false); setSkipping(false); setSkipBusy(""); setSkipErr(""); setPickingDup(false); }, [next?.id]);
  const skip = async (reason, duplicateOf = null) => {
    setSkipBusy(reason); setSkipErr("");
    try { await onSkip(next, reason, duplicateOf); }
    catch (e) { setSkipErr(e?.message || "Could not skip"); setSkipBusy(""); }
  };
  const info = next ? brandInfo(next.brand) : null;
  const catCount = cat ? (cats.find(([c]) => c === cat)?.[1] || 0) : totalTodo;

  return (
    <div style={{ ...GL.card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#1a0a09", letterSpacing: "-0.3px" }}>Up next</span>
          {loaded && totalTodo > 0 && (
            <span style={{ fontSize: 13, color: "#9b4a42" }}>
              {catCount} in queue{cat ? ` · ${categoryLabel(cat)}` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="th-btn-outline" style={GL.btnOutline} onClick={onUploadCsv} disabled={!loaded}
            title="CSV with columns: brand, product (category optional)">⬆ Upload CSV</button>
          <button className="th-btn-outline" style={GL.btnOutline} onClick={onAddNew}>+ Product not on the list</button>
          <button className="th-btn-outline" style={GL.btnOutline} onClick={onOpenSkipped} title="Products skipped from the queue">
            ⏭ Skipped{skippedCount != null ? ` (${skippedCount})` : ""}
          </button>
        </div>
      </div>

      {/* category chips */}
      {loaded && totalTodo > 0 && (
        <div className="cat-chips" role="tablist" aria-label="Up next category">
          <button className={`cat-chip ${!cat ? "active" : ""}`} onClick={() => onPickCat("")}>All <span className="n">{totalTodo}</span></button>
          {cats.map(([c, n]) => (
            <button key={c} className={`cat-chip ${cat === c ? "active" : ""}`} onClick={() => onPickCat(c)}>
              {categoryLabel(c)} <span className="n">{n}</span>
            </button>
          ))}
          {cat && !cats.some(([c]) => c === cat) && (
            <button className="cat-chip active" onClick={() => onPickCat("")}>{categoryLabel(cat)} <span className="n">0</span></button>
          )}
        </div>
      )}

      {!loaded && (
        <div style={{ padding: "28px 0", textAlign: "center", fontSize: 14, color: "#9b4a42" }}>{loading ? "Loading the queue…" : ""}</div>
      )}

      {loaded && next && (
        <div className="upnext-grid">
          {/* the product to capture now */}
          <div key={next.id} className="upnext-hero" style={{
            position: "relative", overflow: "hidden", borderRadius: 16, padding: "22px 22px 18px",
            background: "linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(255,240,238,0.92) 100%)",
            border: "1.5px solid rgba(171,31,16,0.14)", boxShadow: "0 8px 28px rgba(171,31,16,0.10)",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ position: "absolute", inset: "0 auto 0 0", width: 5, background: "linear-gradient(180deg, #c0392b, #ab1f10)" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {info.rank && (
                <span title="Brand popularity rank" style={{ ...GL.pill, background: "#ab1f10", color: "#fff" }}>#{info.rank} brand</span>
              )}
              <span style={{ fontSize: 14, fontWeight: 700, color: "#7b241c" }}>
                {next.brand ? info.name : "No brand in link"}
              </span>
              {next.brand && (
                <span style={{ fontSize: 12, color: "#9b4a42" }}>· {info.done} captured · {info.todo} to do</span>
              )}
            </div>

            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#1a0a09", letterSpacing: "-0.5px", lineHeight: 1.2, wordBreak: "break-word" }}>
                {next.product.replace(/-/g, " ")}
              </div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: "#b08080", marginTop: 4, wordBreak: "break-all" }}>
                {next.brand || "?"}/{next.product}
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={{ ...GL.pill, background: "rgba(171,31,16,0.08)", color: "#ab1f10" }}>{categoryLabel(next.type)}</span>
              <TodoTags r={next} />
            </div>
            {next.needsReview?.length > 0 && (
              <div style={{ fontSize: 12, color: REVIEW.fg, background: REVIEW.bg, borderRadius: 9, padding: "7px 10px" }}>
                ⚠ {next.needsReview.join(" · ")}
              </div>
            )}

            {next.brand && info.done + info.todo > 1 && (
              <div title={`${info.name}: ${info.done} captured, ${info.todo} to do`}>
                <ProgressBar done={info.done} todo={info.todo} height={5} />
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
              <button className="th-btn-primary" onClick={() => onOpen(next)}
                style={{ ...GL.btnPrimary, padding: "13px 24px", fontSize: 15 }}>
                {next.partial ? "Add missing shades →" : "Start capturing →"}
              </button>
              <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setFixing((v) => !v)}>
                {fixing ? "Cancel" : "Fix name"}
              </button>
              {!skipping && (
                <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setSkipping(true)}>Skip ⏭</button>
              )}
              {next.links?.length > 0 && (
                <button onClick={() => setShowLinks((v) => !v)} style={{ ...linkBtn, fontSize: 13 }}>
                  {showLinks ? "Hide" : "Show"} {next.links.length} source link{next.links.length === 1 ? "" : "s"}
                </button>
              )}
            </div>
            {skipping && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 12,
                background: "rgba(171,31,16,0.04)", border: "1px solid rgba(171,31,16,0.12)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#7b241c", marginRight: 4 }}>Why skip?</span>
                {SKIP_OPTIONS.map(([reason, label]) => (
                  <button key={reason} className="th-btn-outline" disabled={!!skipBusy}
                    onClick={() => (reason === "already-added" ? setPickingDup(true) : skip(reason))}
                    style={{ ...GL.btnOutline, opacity: skipBusy && skipBusy !== reason ? 0.5 : 1,
                      ...(reason === "already-added" && pickingDup ? { background: "#ab1f10", color: "#fff", borderColor: "#ab1f10" } : {}) }}>
                    {skipBusy === reason ? "Skipping…" : label}
                  </button>
                ))}
                <button onClick={() => { setSkipping(false); setPickingDup(false); setSkipErr(""); }} disabled={!!skipBusy} style={{ ...linkBtn, fontSize: 13 }}>Cancel</button>
                {skipErr && <span style={{ flexBasis: "100%", fontSize: 13, fontWeight: 600, color: "#c0392b" }}>{skipErr}</span>}
                {pickingDup && (
                  <DuplicatePicker
                    usa={market === "usa"}
                    brand={next.brand}
                    saved={savedProducts || []}
                    brandInfo={brandInfo}
                    busy={skipBusy === "already-added"}
                    onPick={(dup) => skip("already-added", dup)}
                    onCancel={() => setPickingDup(false)}
                  />
                )}
              </div>
            )}
            {showLinks && <SourceLinks links={next.links} open />}
            {fixing && (
              <div style={{ margin: "0 -12px -6px -40px" }}>
                <FixForm r={next} onSave={async (fields) => { await onSaveFix(next.id, fields); setFixing(false); }} onCancel={() => setFixing(false)} />
              </div>
            )}
          </div>

          {/* what comes after */}
          <div style={{ borderRadius: 16, background: "rgba(255,255,255,0.5)", border: "1px solid rgba(171,31,16,0.08)", padding: "14px 10px 10px", display: "flex", flexDirection: "column" }}>
            <div style={{ ...GL.sectionHeader, fontSize: 11, padding: "0 6px 8px" }}>Next in line</div>
            {later.length === 0 && (
              <div style={{ padding: "18px 8px", fontSize: 13, color: "#9b4a42" }}>This is the last one{cat ? ` in ${categoryLabel(cat)}` : ""} 🎉</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {later.map((r, i) => {
                const bi = brandInfo(r.brand);
                return (
                  <div key={r.id || `${r.brand}|${r.product}`} className="queue-row" onClick={() => onOpen(r)} title="Open in Shade Capture">
                    <span style={{ width: 24, height: 24, borderRadius: 8, background: "rgba(171,31,16,0.08)", color: "#ab1f10",
                      fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 2}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1a0a09", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.product.replace(/-/g, " ")}
                      </div>
                      <div style={{ fontSize: 12, color: "#9b4a42", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.brand ? bi.name : "No brand"} · {categoryLabel(r.type)}{r.needsReview?.length ? " · ⚠" : ""}
                      </div>
                    </div>
                    <span className="go" style={{ fontSize: 13, fontWeight: 700, color: "#ab1f10" }}>→</span>
                  </div>
                );
              })}
            </div>
            {queue.length > 7 && (
              <button onClick={onSeeAll} className="th-btn-ghost"
                style={{ marginTop: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#ab1f10", padding: "10px 8px 4px", textAlign: "left" }}>
                + {queue.length - 7} more · see all to-dos ↓
              </button>
            )}
          </div>
        </div>
      )}

      {loaded && !next && (
        <div style={{ padding: "26px 16px", textAlign: "center", borderRadius: 14, background: "rgba(255,255,255,0.5)" }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>{hasTodoList || cat ? "🎉" : "📋"}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a0a09" }}>
            {cat && totalTodo > 0
              ? `Nothing left in ${categoryLabel(cat)}`
              : hasTodoList ? "Everything on the to-do list is captured" : "No to-do list yet"}
          </div>
          <div style={{ fontSize: 13, color: "#9b4a42", marginTop: 4 }}>
            {cat && totalTodo > 0
              ? <button onClick={() => onPickCat("")} style={{ ...linkBtn, fontSize: 13 }}>Show all categories</button>
              : hasTodoList ? "Upload a CSV to add more products." : <>Upload it to S3 as <code>left-to-update-{market}/todo.json</code>, or add products with a CSV.</>}
          </div>
        </div>
      )}
    </div>
  );
}

// Bulk "Make live": pick a category, every saved-but-not-live product in it is added to all-data(.usa).json
function MakeLivePanel({ market, marketLabel, products, brandInfo, onLive }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(null); // null = no category picked yet, "" = products saved without a category
  const [unchecked, setUnchecked] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [autoCat, setAutoCat] = useState(true);
  const { runWithPassword, passwordModal } = useActionPassword();
  const canAutoCat = cat === "foundation" || cat === "concealer";

  const notLive = useMemo(() => products.filter((p) => !p.live), [products]);
  const cats = useMemo(() => {
    const counts = {};
    notLive.forEach((p) => { counts[p.type || ""] = (counts[p.type || ""] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => (CATEGORY_ORDER[a[0]] ?? 99) - (CATEGORY_ORDER[b[0]] ?? 99) || a[0].localeCompare(b[0]));
  }, [notLive]);
  const list = useMemo(
    () => (cat === null ? [] : notLive.filter((p) => (p.type || "") === cat)).sort((a, b) => a.brand.localeCompare(b.brand) || a.product.localeCompare(b.product)),
    [notLive, cat]
  );
  const keyOf = (p) => `${p.brand}:::${p.product}`;
  const selected = list.filter((p) => !unchecked.has(keyOf(p)));

  const pick = (c) => { setCat(c); setUnchecked(new Set()); setConfirming(false); setMsg(""); };
  const toggle = (p) => setUnchecked((prev) => {
    const next = new Set(prev);
    next.has(keyOf(p)) ? next.delete(keyOf(p)) : next.add(keyOf(p));
    return next;
  });
  const allOn = selected.length === list.length;
  const toggleAll = () => setUnchecked(allOn ? new Set(list.map(keyOf)) : new Set());

  const makeLive = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await runWithPassword((password) => fetch("/api/shade-capture/make-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market, category: cat, autoCategorise: canAutoCat && autoCat,
          items: selected.map((p) => ({ brand: p.brand, product: p.product })),
          password,
        }),
      }));
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Make live failed");
      onLive([...(j.added || []), ...(j.alreadyLive || [])]);
      setMsg(`✓ ${j.added.length} ${categoryLabel(cat)} product${j.added.length === 1 ? " is" : "s are"} now live in ${marketLabel}` +
        (j.categorised?.length ? `, ${j.categorised.length} auto-categorised` : "") +
        (j.alreadyLive?.length ? ` (${j.alreadyLive.length} were already live)` : "") + "." +
        (j.failed?.length ? ` Not made live (couldn't auto-categorise): ${j.failed.map((f) => `${f.brand}/${f.product} — ${f.reason}`).join("; ")}.` : ""));
      setConfirming(false);
      setUnchecked(new Set());
    } catch (e) {
      setMsg(`Make live failed: ${e?.message || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...GL.card, padding: open ? "20px 22px" : "16px 22px" }}>
      {passwordModal}
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#ab1f10", fontSize: 12, display: "inline-block", width: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#1a0a09", letterSpacing: "-0.3px" }}>Make products live</span>
        </div>
        <span style={{ ...GL.pill, background: notLive.length ? "rgba(217,119,6,0.12)" : DONE.bg, color: notLive.length ? "#b45309" : DONE.fg }}>
          {notLive.length ? `${notLive.length} saved but not live` : "everything saved is live"}
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#9b4a42" }}>
            Pick a category: every product saved in S3 for {marketLabel} that isn't in the app yet will be added to{" "}
            <code>{market === "usa" ? "all-data-usa.json" : "all-data.json"}</code>, the same as “Make Live” in the editor.
          </div>

          {cats.length > 0 ? (
            <div className="cat-chips">
              {cats.map(([c, n]) => (
                <button key={c || "none"} className={`cat-chip ${cat === c ? "active" : ""}`} onClick={() => pick(c)}>
                  {categoryLabel(c)} <span className="n">{n}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: DONE.fg, fontWeight: 600 }}>🎉 Every saved {marketLabel} product is live.</div>
          )}

          {msg && (
            <div style={{ fontSize: 14, fontWeight: 600, color: msg.startsWith("✓") ? DONE.fg : "#c0392b" }}>{msg}</div>
          )}

          {cat === null && cats.length > 0 && (
            <div style={{ fontSize: 13, color: "#b08080" }}>Choose a category above to see its products.</div>
          )}

          {cat === "" && list.length > 0 && (
            <div style={{ fontSize: 12, color: REVIEW.fg, background: REVIEW.bg, borderRadius: 9, padding: "8px 11px" }}>
              ⚠ These products have no category saved, so they can't be made live from here. Open them in Shade Capture, set the category and save.
            </div>
          )}

          {list.length > 0 && cat && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#7b241c", cursor: "pointer" }}>
                  <input type="checkbox" checked={allOn} onChange={toggleAll} style={{ accentColor: "#ab1f10", width: 16, height: 16 }} />
                  {selected.length} of {list.length} {categoryLabel(cat)} selected
                </label>
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto", borderRadius: 12, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(171,31,16,0.08)" }}>
                {list.map((p) => {
                  const on = !unchecked.has(keyOf(p));
                  return (
                    <label key={keyOf(p)} style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) auto", gap: 10, alignItems: "center",
                      padding: "8px 12px", borderBottom: "1px solid rgba(171,31,16,0.05)", cursor: "pointer", opacity: on ? 1 : 0.5 }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(p)} style={{ accentColor: "#ab1f10", width: 15, height: 15 }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1a0a09" }}>{p.product}</span>
                        <span style={{ fontSize: 12, color: "#9b4a42" }}> · {brandInfo(p.brand).name}</span>
                      </span>
                      <span style={{ fontSize: 12, color: "#b08080", whiteSpace: "nowrap" }}>{fmtDate(p.updatedAt)}</span>
                    </label>
                  );
                })}
              </div>

              {canAutoCat && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: "#7b241c", cursor: "pointer",
                  padding: "10px 12px", borderRadius: 11, background: "rgba(171,31,16,0.04)", border: "1px solid rgba(171,31,16,0.1)" }}>
                  <input type="checkbox" checked={autoCat} onChange={(e) => setAutoCat(e.target.checked)}
                    style={{ accentColor: "#ab1f10", width: 16, height: 16, marginTop: 1 }} />
                  <span>
                    <b>Auto-categorise skin tone &amp; undertone first</b>
                    <span style={{ display: "block", color: "#9b4a42", marginTop: 2 }}>
                      Each product's shades are re-classified (F → VD, W / N / C) with the shade classifier, its shades.json is
                      rewritten (the old one is kept as a backup next to it), then it's made live. Products that can't be
                      categorised stay not live.
                    </span>
                  </span>
                </label>
              )}

              {!confirming ? (
                <div>
                  <button className="th-btn-primary" disabled={!selected.length} onClick={() => setConfirming(true)}
                    style={{ ...GL.btnPrimary, opacity: selected.length ? 1 : 0.5, cursor: selected.length ? "pointer" : "not-allowed" }}>
                    Make {selected.length} {categoryLabel(cat)} live →
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 12,
                  background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.3)" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "#92400e", flex: "1 1 260px" }}>
                    {canAutoCat && autoCat ? "Auto-categorise and make " : "Make "}{selected.length} {categoryLabel(cat)} product{selected.length === 1 ? "" : "s"} live for {marketLabel} users?
                  </span>
                  <button className="th-btn-primary" onClick={makeLive} disabled={busy}
                    style={{ ...GL.btnPrimary, opacity: busy ? 0.6 : 1 }}>
                    {busy ? (canAutoCat && autoCat ? "Categorising & making live…" : "Making live…") : "Yes, make live"}
                  </button>
                  <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const linkBtn = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ab1f10", textDecoration: "underline" };

function TodoTags({ r }) {
  return (
    <>
      {r.partial && (
        <span title="This product is already in S3 — add the missing shades" style={{ ...GL.pill, background: "rgba(59,130,246,0.1)", color: "#1d4ed8" }}>
          Adding shades
        </span>
      )}
      {r.needsReview?.length > 0 && (
        <span title={r.needsReview.join(", ")} style={{ ...GL.pill, background: REVIEW.bg, color: REVIEW.fg }}>⚠ Check name</span>
      )}
    </>
  );
}

// Source product pages from the spreadsheet, for looking up shades while capturing
function SourceLinks({ links, open }) {
  const [show, setShow] = useState(!!open);
  if (!links?.length) return null;
  return (
    <div style={{ marginTop: open ? 0 : 8 }}>
      {!open && (
        <button onClick={() => setShow((v) => !v)} style={linkBtn}>
          {show ? "Hide" : "Show"} {links.length} source link{links.length === 1 ? "" : "s"}
        </button>
      )}
      {show && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: open ? 0 : 6 }}>
          {links.map((l) => (
            <a key={l} href={l} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: "#7b241c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
              {l}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function FixForm({ r, onSave, onCancel }) {
  const [brand, setBrand] = useState(r.brand);
  const [product, setProduct] = useState(r.product);
  const [category, setCategory] = useState(r.type);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try { await onSave({ brand, product, category }); }
    catch (e2) { setErr(e2?.message || "Could not save"); }
    finally { setSaving(false); }
  };
  const field = { ...GL.input, padding: "8px 11px", fontSize: 13 };
  return (
    <form onSubmit={submit} style={{ padding: "4px 12px 12px 40px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ flex: "1 1 160px", fontSize: 11, fontWeight: 700, color: "#7b241c" }}>
        BRAND
        <input className="th-input" style={field} value={brand} onChange={(e) => setBrand(e.target.value)} list="th-brand-list" />
      </label>
      <label style={{ flex: "2 1 240px", fontSize: 11, fontWeight: 700, color: "#7b241c" }}>
        PRODUCT
        <input className="th-input" style={field} value={product} onChange={(e) => setProduct(e.target.value)} />
      </label>
      <label style={{ flex: "1 1 160px", fontSize: 11, fontWeight: 700, color: "#7b241c" }}>
        CATEGORY
        <select className="th-input" style={{ ...field, cursor: "pointer" }} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      <button type="submit" className="th-btn-primary" disabled={saving} style={{ ...GL.btnPrimary, padding: "9px 16px", fontSize: 13, opacity: saving ? 0.6 : 1 }}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} style={{ ...GL.btnOutline, padding: "8px 14px" }}>Cancel</button>
      <div style={{ flexBasis: "100%", fontSize: 12, color: err ? "#c0392b" : "#9b4a42" }}>
        {err || "Saved as lowercase words joined by “-”."}
      </div>
    </form>
  );
}

function ProgressBar({ done, todo, height }) {
  const total = done + todo;
  const pct = total ? (done / total) * 100 : 0;
  return (
    <div style={{ height, borderRadius: height, background: total && todo ? TODO_C.bg : "rgba(171,31,16,0.08)", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: DONE.bar, borderRadius: height, transition: "width 0.3s" }} />
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ ...GL.card, padding: "18px 20px" }}>
      <div style={GL.sectionHeader}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color, margin: "6px 0 2px" }}>{value}</div>
      <div style={{ fontSize: 13, color: "#9b4a42" }}>{sub}</div>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", background: "rgba(171,31,16,0.07)", borderRadius: 11, padding: 3, gap: 3 }}>
      {options.map(([k, label]) => {
        const active = k === value;
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            border: "none", cursor: "pointer", borderRadius: 8, padding: "7px 13px", fontSize: 13, fontWeight: 600,
            background: active ? "#fff" : "transparent", color: active ? "#ab1f10" : "#9b4a42",
            boxShadow: active ? "0 2px 8px rgba(171,31,16,0.15)" : "none", whiteSpace: "nowrap",
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function NavBtn({ children, onClick, strong }) {
  return (
    <button className="th-btn-ghost" onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, color: strong ? "#ab1f10" : "#7b241c", padding: "8px 12px", borderRadius: 9 }}>
      {children}
    </button>
  );
}
