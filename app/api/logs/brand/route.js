export const runtime = "nodejs";

import { loadProduct } from "../loadProduct";

const CONCURRENCY = 8;

/**
 * POST /api/logs/brand
 * Body: { usa: boolean, items: [{ brand, product }] }
 * Loads every listed product (shades + links + price + type + meta) in one round trip.
 */
export async function POST(req) {
  try {
    const { usa = false, items } = await req.json();
    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: "Missing items" }, { status: 400 });
    }

    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        const { brand, product } = items[i];
        try {
          results[i] = await loadProduct({ brand, product, usa });
        } catch (e) {
          results[i] = { brand, product, productType: "", meta: {}, shades: [], error: e?.message || "Load failed" };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

    return Response.json({ products: results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e?.message || "Brand load failed" }, { status: 500 });
  }
}
