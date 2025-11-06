"use client";

import { useEffect, useMemo, useState } from "react";

function fmtDate(value) {
  if (value == null || value === "") return "-";
  const n =
    typeof value === "number"
      ? value
      : isNaN(Date.parse(String(value)))
      ? null
      : Date.parse(String(value));
  if (!n) return "-";
  try {
    return new Date(n).toLocaleString();
  } catch {
    return "-";
  }
}

// Build a brand-wise product breakdown from payload (premium/favourites) and viewedGlobal
function brandBreakdown(payload, brand) {
  if (!payload?.users || !brand) {
    return { premiumProducts: [], favouriteProducts: [], viewedProducts: [] };
  }

  const target = String(brand).toLowerCase();
  const premiumMap = new Map();
  const favMap = new Map();
  const viewedMap = new Map();

  for (const u of payload.users) {
    // premium
    for (const p of (u.premium?.products || [])) {
      if (String(p.brand || "").toLowerCase() !== target) continue;
      const key = String(p.product || "").trim();
      if (!key) continue;
      premiumMap.set(key, (premiumMap.get(key) || 0) + 1);
    }
    // favourites
    for (const f of (u.favourites?.items || [])) {
      if (String(f.brand || "").toLowerCase() !== target) continue;
      const key = String(f.product || f.name || "").trim();
      if (!key) continue;
      favMap.set(key, (favMap.get(key) || 0) + 1);
    }
  }

  // viewed: from global
  for (const v of (payload.viewedGlobal?.items || [])) {
    if (String(v.brand || "").toLowerCase() !== target) continue;
    const key = String(v.product || "").trim();
    if (!key) continue;
    viewedMap.set(key, (viewedMap.get(key) || 0) + (Number(v.views) || 0));
  }

  const premiumProducts = Array.from(premiumMap.entries())
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const favouriteProducts = Array.from(favMap.entries())
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const viewedProducts = Array.from(viewedMap.entries())
    .map(([product, views]) => ({ product, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 50);

  return { premiumProducts, favouriteProducts, viewedProducts };
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [sortKey, setSortKey] = useState("name"); // name | email | premium | lastPurchase
  const [sortDir, setSortDir] = useState("asc");  // asc | desc

  // brand modal
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandModalBrand, setBrandModalBrand] = useState("");
  const [brandModalData, setBrandModalData] = useState({
    premiumProducts: [],
    favouriteProducts: [],
    viewedProducts: [],
  });

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/analytics/users", { cache: "no-store" });
        const j = await r.json();
        if (active) setPayload(j);
      } catch (e) {
        if (active) setPayload(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!payload?.users) return [];
    const q = query.trim().toLowerCase();
    let arr = payload.users;

    if (q) {
      arr = arr.filter((u) => {
        const hay = [
          String(u.id ?? ""),
          String(u.info?.id ?? ""),
          u.info?.name ?? "",
          u.info?.email ?? "",
          u.info?.phone ?? "",
          u.info?.skinTone ?? "",
          u.info?.undertone ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    arr = [...arr].sort((a, b) => {
      let va = "";
      let vb = "";
      if (sortKey === "name") {
        va = a.info?.name || "";
        vb = b.info?.name || "";
      } else if (sortKey === "email") {
        va = a.info?.email || "";
        vb = b.info?.email || "";
      } else if (sortKey === "premium") {
        va = a.premium?.count || 0;
        vb = b.premium?.count || 0;
      } else if (sortKey === "lastPurchase") {
        va = a.premium?.lastPurchase || 0;
        vb = b.premium?.lastPurchase || 0;
      }
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });

    return arr;
  }, [payload, query, sortKey, sortDir]);

  const openBrandModal = (brand) => {
    if (!brand || !payload) return;
    const data = brandBreakdown(payload, brand);
    setBrandModalBrand(brand);
    setBrandModalData(data);
    setBrandModalOpen(true);
  };

  const closeBrandModal = () => {
    setBrandModalOpen(false);
    setBrandModalBrand("");
    setBrandModalData({ premiumProducts: [], favouriteProducts: [], viewedProducts: [] });
  };

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-rose-100">
        <div className="text-[#ab1f10] text-lg font-semibold animate-pulse">
          Loading analytics…
        </div>
      </div>
    );

  if (!payload)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-rose-100">
        <div className="text-gray-600">No data available.</div>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-rose-100 p-6">
      <div className="mx-auto max-w-7xl bg-white rounded-2xl shadow-xl p-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-2xl font-bold text-[#ab1f10]">
            TrueHue — User Analytics
          </h1>
          <div className="text-sm text-gray-600">
            Total Users:{" "}
            <span className="font-semibold text-[#ab1f10]">
              {payload.totals?.usersCount || 0}
            </span>{" "}
            · Premium Users:{" "}
            <span className="font-semibold text-[#ab1f10]">
              {payload.totals?.premiumUsers || 0}
            </span>{" "}
            · Premium Products:{" "}
            <span className="font-semibold text-[#ab1f10]">
              {payload.totals?.totalPremiumProducts || 0}
            </span>
          </div>
        </div>

        {/* Search + Sorting */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            className="flex-1 p-3 border border-rose-200 rounded text-black w-full md:w-auto"
            placeholder="Search users by name, email, ID, tone or undertone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="p-3 border border-rose-200 rounded text-black"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            <option value="name">Sort by Name</option>
            <option value="email">Sort by Email</option>
            <option value="premium">Sort by Premium Count</option>
            <option value="lastPurchase">Sort by Last Purchase</option>
          </select>
          <button
            className="px-4 py-2 bg-[#ab1f10] text-white rounded hover:bg-red-700"
            onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
          >
            {sortDir === "asc" ? "⬆ Asc" : "⬇ Desc"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left panel - users */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-rose-50 px-3 py-2 text-sm text-[#ab1f10] font-semibold">
              Users ({filtered.length})
            </div>
            <ul className="max-h-[65vh] overflow-auto divide-y">
              {filtered.map((u) => {
                const isSel = selected && selected.id === u.id;
                return (
                  <li
                    key={u.id}
                    className={`px-3 py-2 cursor-pointer hover:bg-rose-50 ${
                      isSel ? "bg-rose-100" : ""
                    }`}
                    onClick={() => setSelected(u)}
                  >
                    <div className="text-sm font-semibold text-black">
                      {u.info?.name || "Unnamed"}
                    </div>
                    <div className="text-xs text-gray-600">
                      {u.info?.email || "-"}
                    </div>
                    {(u.info?.skinTone || u.info?.undertone) && (
                      <div className="text-[11px] text-gray-500">
                        {u.info?.skinTone ? `Tone: ${u.info.skinTone}` : ""}
                        {u.info?.undertone ? ` · UT: ${u.info.undertone}` : ""}
                      </div>
                    )}
                    {(u.premium?.count || 0) > 0 && (
                      <div className="text-xs text-[#ab1f10] font-medium">
                        {u.premium.count} Premium
                      </div>
                    )}
                    {(u.favourites?.count || 0) > 0 && (
                      <div className="text-[11px] text-rose-700">
                        {u.favourites.count} Favourites
                      </div>
                    )}
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-gray-500 text-sm">
                  No matching users.
                </li>
              )}
            </ul>
          </div>

          {/* Right panel - user details */}
          <div className="md:col-span-2">
            {!selected && (
              <div className="text-gray-600">
                Select a user to view their analytics.
              </div>
            )}

            {selected && (
              <div className="space-y-4">
                {/* User header */}
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xl font-semibold text-black">
                      {selected.info?.name || "Unnamed User"}
                    </div>
                    <div className="text-sm text-gray-600">
                      {selected.info?.email || "-"} · {selected.info?.phone || "-"}
                    </div>
                    <div className="text-xs text-gray-500">
                      Joined: {fmtDate(selected.info?.createdAt)}
                    </div>
                    {(selected.info?.skinTone || selected.info?.undertone) && (
                      <div className="text-xs text-gray-600">
                        {selected.info?.skinTone ? `Skin Tone: ${selected.info.skinTone}` : ""}
                        {selected.info?.undertone ? ` · Undertone: ${selected.info.undertone}` : ""}
                      </div>
                    )}
                  </div>
                </div>

                {/* Premium products */}
                <div className="border rounded-lg bg-rose-50 p-3">
                  <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                    Premium Products ({selected.premium?.count || 0})
                  </div>

                  {(selected.premium?.products?.length || 0) === 0 && (
                    <div className="text-sm text-gray-600">No premium purchases.</div>
                  )}

                  {(selected.premium?.products || []).map((p, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center bg-white rounded p-2 mb-1"
                    >
                      <div className="text-sm font-semibold text-black">
                        {p.product}
                      </div>
                      <div className="text-xs text-gray-600">{p.brand}</div>
                      <div className="text-xs text-gray-500 text-right">
                        {fmtDate(p.purchasedAt)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Favourites */}
                <div className="border rounded-lg bg-rose-50 p-3">
                  <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                    Favourites ({selected.favourites?.count || 0})
                  </div>

                  {(selected.favourites?.items?.length || 0) === 0 && (
                    <div className="text-sm text-gray-600">No favourites yet.</div>
                  )}

                  {(selected.favourites?.items || []).map((f, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center bg-white rounded p-2 mb-1"
                    >
                      <div className="col-span-2">
                        <div className="text-sm font-semibold text-black">
                          {f.name || f.product || "—"}
                        </div>
                        <div className="text-xs text-gray-600">{f.brand || "-"}</div>
                      </div>

                      <div
                        className="w-8 h-8 rounded border"
                        style={{ backgroundColor: f.hex || "#fff" }}
                        title={f.hex || ""}
                      />

                      <div className="text-xs text-gray-700">
                        {f.type ? `Type: ${f.type}` : "-"}
                        {f.filter ? ` · ${f.filter}` : ""}
                      </div>

                      <div className="text-xs truncate">
                        {f.link ? (
                          <a href={f.link} target="_blank" rel="noreferrer" className="underline">
                            Link
                          </a>
                        ) : (
                          "-"
                        )}
                      </div>

                      <div className="text-sm text-right">
                        {typeof f.price === "number" ? `₹${f.price}` : "-"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer - Top Premium Brands */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-[#ab1f10] mb-2">
            Top Premium Brands
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {payload.totals?.topBrands?.length > 0 ? (
              payload.totals.topBrands.map((b, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => openBrandModal(b.brand)}
                  className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black hover:bg-rose-100 transition"
                  title="View top products for this brand"
                >
                  <span className="font-medium text-left">{b.brand}</span>
                  <span className="font-semibold">{b.count}</span>
                </button>
              ))
            ) : (
              <div className="text-gray-600 text-sm">No brand data yet.</div>
            )}
          </div>
        </div>

        {/* Footer - Top Favourite Brands */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-[#ab1f10] mb-2">
            Top Favourite Brands
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {payload.totals?.topFavouriteBrands?.length > 0 ? (
              payload.totals.topFavouriteBrands.map((b, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => openBrandModal(b.brand)}
                  className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black hover:bg-rose-100 transition"
                  title="View top favourites for this brand"
                >
                  <span className="font-medium text-left">{b.brand}</span>
                  <span className="font-semibold">{b.count}</span>
                </button>
              ))
            ) : (
              <div className="text-gray-600 text-sm">No favourite brand data yet.</div>
            )}
          </div>
        </div>

        {/* Footer - Top Viewed Brands (global) */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-[#ab1f10] mb-2">
            Top Viewed Brands
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {(payload.totals?.topViewedBrands || []).length > 0 ? (
              payload.totals.topViewedBrands.map((b, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => openBrandModal(b.brand)}
                  className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black hover:bg-rose-100 transition"
                  title="View top viewed products for this brand"
                >
                  <span className="font-medium text-left">{b.brand}</span>
                  <span className="font-semibold">{b.views}</span>
                </button>
              ))
            ) : (
              <div className="text-gray-600 text-sm">No viewed data yet.</div>
            )}
          </div>
        </div>

        {/* Footer - Top Viewed Products (global) */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-[#ab1f10] mb-2">
            Top Viewed Products
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {(payload.totals?.topViewedProducts || []).length > 0 ? (
              payload.totals.topViewedProducts.map((row, idx) => (
                <div
                  key={idx}
                  className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black"
                >
                  <span className="font-medium text-left">
                    {row.brand} — {row.product}
                  </span>
                  <span className="font-semibold">{row.views}</span>
                </div>
              ))
            ) : (
              <div className="text-gray-600 text-sm">No viewed product data yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Brand Breakdown Modal (premium/favourites from users, viewed from global) */}
      {brandModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-[#ab1f10]">
                {brandModalBrand} — Top Products
              </h3>
              <button
                onClick={closeBrandModal}
                className="text-sm px-3 py-1 rounded border border-rose-200 hover:bg-rose-50"
                type="button"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Top Premium */}
              <div className="border rounded-lg bg-rose-50 p-3">
                <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                  Top Premium
                </div>
                {brandModalData.premiumProducts.length === 0 ? (
                  <div className="text-sm text-gray-600">No premium data.</div>
                ) : (
                  <ul className="divide-y bg-white rounded">
                    {brandModalData.premiumProducts.map((row, i) => (
                      <li key={i} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm text-black">{row.product}</span>
                        <span className="text-sm font-semibold">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Top Favourites */}
              <div className="border rounded-lg bg-rose-50 p-3">
                <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                  Top Favourites
                </div>
                {brandModalData.favouriteProducts.length === 0 ? (
                  <div className="text-sm text-gray-600">No favourites.</div>
                ) : (
                  <ul className="divide-y bg-white rounded">
                    {brandModalData.favouriteProducts.map((row, i) => (
                      <li key={i} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm text-black">{row.product}</span>
                        <span className="text-sm font-semibold">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Top Viewed (from global) */}
              <div className="border rounded-lg bg-rose-50 p-3">
                <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                  Top Viewed
                </div>
                {brandModalData.viewedProducts.length === 0 ? (
                  <div className="text-sm text-gray-600">No views.</div>
                ) : (
                  <ul className="divide-y bg-white rounded">
                    {brandModalData.viewedProducts.map((row, i) => (
                      <li key={i} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm text-black">{row.product}</span>
                        <span className="text-sm font-semibold">{row.views}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
