// How many of a save's shades are genuinely new work, i.e. not already captured in the other market's database.
// Compared against the product it was imported from (importedFrom) or, failing that, the same brand + product
// in the other market. A shade matches when its name or its hex is already there.
import { loadProduct } from "../logs/loadProduct";

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hexKey = (h) => String(h || "").trim().toLowerCase().replace(/^#/, "");

export async function countNewShades({ market, brand, product, shades, importedFrom }) {
  const otherMarket = importedFrom?.market && importedFrom.market !== market ? importedFrom.market : market === "usa" ? "india" : "usa";
  const src = importedFrom?.brand && importedFrom?.product ? importedFrom : { brand, product };
  const other = await loadProduct({ brand: src.brand, product: src.product, usa: otherMarket === "usa" });
  const otherShades = other?.shades || [];
  if (!otherShades.length) return { newShades: shades.length, comparedWith: null };

  const names = new Set(otherShades.map((s) => norm(s.name)));
  const hexes = new Set(otherShades.map((s) => hexKey(s.hex)));
  const newShades = shades.filter((s) => !names.has(norm(s.name)) && !hexes.has(hexKey(s.hex))).length;
  return {
    newShades,
    comparedWith: { market: otherMarket, brand: src.brand, product: src.product, shades: otherShades.length, imported: !!importedFrom },
  };
}
