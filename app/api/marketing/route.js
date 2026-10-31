export const runtime = "nodejs";

// Marketing Organiser API — dhruvi only.
//   GET                       -> { config, items: { organic, ads }, inspo }
//   POST { op, ... }          -> the file(s) the op changed
//     saveConfig    { config }
//     upsertItems   { list: "organic" | "ads", items: [...] }      (add or replace by id)
//     deleteItem    { list, id }
//     addInspo      { url, categoryId | newCategory, conceptId | newConcept, alsoCategoryIds, notes }   (new names are added to the settings)
//     updateInspo   { id, notes?, categoryId?, conceptId?, alsoCategoryIds? }
//     deleteInspo   { id }                                         (also unlinks it from items)
//     linkInspo     { list, itemId, inspoId, linked: true|false }
import { isDhruvi } from "../../lib/auth";
import { read, readAll, update, StoreError } from "./store";
import { cleanConfig, cleanItem, duplicateNames, findCategory, findConcept, newCategory, normaliseInsta, tidyName, uid } from "../../marketing/lib";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const LISTS = ["organic", "ads"];
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
// other categories a reel is also for (never its main one)
const alsoIds = (v, main) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x && x !== main).map((x) => x.slice(0, 120)))].slice(0, 10);

export async function GET() {
  if (!(await isDhruvi())) return json({ error: "You don't have access to this" }, 403);
  try {
    return json(await readAll());
  } catch (e) {
    console.error("marketing GET failed", e?.name, e?.message);
    return json({ error: "Could not load the organiser data" }, 500);
  }
}

export async function POST(req) {
  if (!(await isDhruvi())) return json({ error: "You don't have access to this" }, 403);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const { op } = body || {};
  const needList = () => { if (!LISTS.includes(body.list)) throw new StoreError("Unknown list"); };
  const withItems = (fn) => update("items", (d) => {
    d.organic ||= [];
    d.ads ||= [];
    return fn(d);
  });

  try {
    switch (op) {
      case "saveConfig": {
        const config = cleanConfig(body.config);
        const dups = duplicateNames(config);
        if (dups.length) throw new StoreError(`${dups[0]} — names must be unique.`);
        if (JSON.stringify(config).length > 300_000) throw new StoreError("Settings are too large");
        return json({ config: await update("config", () => config) });
      }
      case "upsertItems": {
        needList();
        const incoming = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((i) => cleanItem(body.list, i));
        const items = await withItems((d) => {
          const list = d[body.list];
          for (const it of incoming) {
            const i = list.findIndex((x) => x.id === it.id);
            if (i >= 0) list[i] = { ...it, createdAt: list[i].createdAt || it.createdAt };
            else list.push(it);
          }
          if (list.length > 5000) throw new StoreError("Too many items");
        });
        return json({ items });
      }
      case "deleteItem": {
        needList();
        const items = await withItems((d) => { d[body.list] = d[body.list].filter((x) => x.id !== body.id); });
        return json({ items });
      }
      case "linkInspo": {
        needList();
        const items = await withItems((d) => {
          const it = d[body.list].find((x) => x.id === body.itemId);
          if (!it) throw new StoreError("That item no longer exists", 404);
          const set = new Set(it.inspoIds || []);
          if (body.linked) set.add(str(body.inspoId, 64)); else set.delete(body.inspoId);
          it.inspoIds = [...set].slice(0, 50);
          it.updatedAt = new Date().toISOString();
        });
        return json({ items });
      }
      case "addInspo": {
        const n = normaliseInsta(body.url);
        if (n.error) throw new StoreError(n.error);
        // a category / concept typed in: an existing one with the same name is used, otherwise it's created
        // (after the reel is saved). A concept name already used in another category is refused.
        const { data: cfg } = await read("config");
        const catName = tidyName(str(body.newCategory, 80));
        const conceptName = tidyName(str(body.newConcept, 120));
        const knownCat = catName ? findCategory(cfg, catName) : null;
        const categoryId = catName ? (knownCat?.id || uid()) : str(body.categoryId, 120);
        const addCat = !!catName && !knownCat;
        if (!categoryId) throw new StoreError("Pick a category");
        const known = conceptName ? findConcept(cfg, conceptName) : null;
        if (known && known.cat.id !== categoryId) throw new StoreError(`"${known.concept.name}" is already a concept in ${known.cat.name}`);
        const conceptId = conceptName ? (known?.concept.id || uid()) : str(body.conceptId, 120);
        const addConcept = !!conceptName && !known;

        const inspo = await update("inspo", (list) => {
          const dup = list.find((x) => x.shortcode === n.shortcode);
          if (dup) throw new StoreError(`Already saved (added ${dup.addedAt?.slice(0, 10) || "earlier"}).`, 409);
          if (list.length >= 3000) throw new StoreError("The inspo library is full");
          list.unshift({
            id: uid(), shortcode: n.shortcode, kind: n.kind, permalink: n.permalink,
            categoryId, alsoCategoryIds: alsoIds(body.alsoCategoryIds, categoryId), conceptId, notes: str(body.notes, 2000), addedAt: new Date().toISOString(),
          });
        });
        if (!addCat && !addConcept) return json({ inspo });
        const config = await update("config", (c) => {
          let cat = c.categories.find((k) => k.id === categoryId);
          if (!cat && addCat && !findCategory(c, catName) && c.categories.length < 30) {
            cat = newCategory(categoryId, catName);
            c.categories.push(cat);
            c.offsets = { ...c.offsets, [categoryId]: { shoot: 3, edit: 2 } };
          }
          if (cat && addConcept && !findConcept(c, conceptName)) cat.concepts.push({ id: conceptId, name: conceptName });
        });
        return json({ inspo, config });
      }
      case "updateInspo": {
        const inspo = await update("inspo", (list) => {
          const x = list.find((i) => i.id === body.id);
          if (!x) throw new StoreError("That inspo no longer exists", 404);
          if ("notes" in body) x.notes = str(body.notes, 2000);
          if ("categoryId" in body) x.categoryId = str(body.categoryId, 120);
          if ("conceptId" in body) x.conceptId = str(body.conceptId, 120);
          if ("alsoCategoryIds" in body || "categoryId" in body) x.alsoCategoryIds = alsoIds("alsoCategoryIds" in body ? body.alsoCategoryIds : x.alsoCategoryIds, x.categoryId);
        });
        return json({ inspo });
      }
      case "deleteInspo": {
        const inspo = await update("inspo", (list) => list.filter((i) => i.id !== body.id));
        const items = await withItems((d) => {
          for (const l of LISTS) for (const it of d[l]) if (it.inspoIds?.includes(body.id)) it.inspoIds = it.inspoIds.filter((x) => x !== body.id);
        });
        return json({ inspo, items });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof StoreError) return json({ error: e.message }, e.status);
    console.error("marketing POST failed", op, e?.name, e?.message);
    return json({ error: "Could not save — please try again" }, 500);
  }
}
