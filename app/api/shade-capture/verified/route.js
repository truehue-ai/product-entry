export const runtime = "nodejs";

import { cookies } from "next/headers";
import { readVerified, setVerified, readJSONWithEtag, VERIFIED_KEYS, ALL_DATA_KEYS } from "../verifiedStore";
import { rejectUnlessActionPassword } from "../actionAuth";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// GET /api/shade-capture/verified?market=india[&brand=..&product=..]
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const market = searchParams.get("market") || "india";
    if (!VERIFIED_KEYS[market]) return json({ error: "Unknown market" }, 400);
    const { verified, exists } = await readVerified(market);
    const brand = searchParams.get("brand"), product = searchParams.get("product");
    if (brand && product) return json({ verified: !!verified[brand]?.[product], entry: verified[brand]?.[product] || null, exists });
    // also the live catalogue, as { brand: { product: type } }, so lists can show Live / Not live
    const { data: allData } = await readJSONWithEtag(ALL_DATA_KEYS[market]);
    const live = {};
    for (const [b, arr] of Object.entries(allData || {})) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) for (const [prod, type] of Object.entries(entry || {})) (live[b] ||= {})[prod] = type;
    }
    return json({ verified, exists, live });
  } catch (e) {
    return json({ error: e?.message || "Failed to load verified list" }, 500);
  }
}

// POST { market, brand, product, verified: true|false }
export async function POST(req) {
  try {
    const { market = "india", brand, product, verified, password } = await req.json();
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
    if (!VERIFIED_KEYS[market]) return json({ error: "Unknown market" }, 400);
    if (!brand || !product || typeof verified !== "boolean") return json({ error: "Missing brand, product or verified" }, 400);
    const user = (await cookies()).get("th_auth")?.value || "unknown";
    const { entry } = await setVerified(market, brand, product, verified, user);
    return json({ success: true, verified, entry });
  } catch (e) {
    return json({ error: e?.message || "Update failed" }, 500);
  }
}
