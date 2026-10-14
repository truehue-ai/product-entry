export const runtime = "nodejs";

import { loadProduct } from "../loadProduct";

export async function GET(req) {
  const { searchParams } = new URL(req.url, "http://localhost");
  const brand = searchParams.get("brand");
  const product = searchParams.get("product");
  const usa = searchParams.get("usa") === "1";
  if (!brand || !product) {
    return new Response(JSON.stringify({ error: "Missing brand or product" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await loadProduct({ brand, product, usa });
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
