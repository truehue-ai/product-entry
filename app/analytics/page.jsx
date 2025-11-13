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

export default function AnalyticsPage() {
  // list state
  const [loadingList, setLoadingList] = useState(false);
  const [usersList, setUsersList] = useState([]); // [{id, name, number}]
  const [topViewedBrands, setTopViewedBrands] = useState([]);
  const [topViewedProducts, setTopViewedProducts] = useState([]);

  // premium summary
  const [topPremiumBrands, setTopPremiumBrands] = useState([]);
  const [topPremiumProducts, setTopPremiumProducts] = useState([]);
  const [premiumUpdatedAt, setPremiumUpdatedAt] = useState(null);

  // perfect product premium summary
  const [topPerfect5, setTopPerfect5] = useState([]);
  const [topPerfect24, setTopPerfect24] = useState([]);
  const [perfect5UpdatedAt, setPerfect5UpdatedAt] = useState(null);
  const [perfect24UpdatedAt, setPerfect24UpdatedAt] = useState(null);

  const [query, setQuery] = useState("");

  // detail state
  const [selectedId, setSelectedId] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState(null); // { info, wallet, premium, favourites }
  const [showImages, setShowImages] = useState(false);

  // bottom analytics tab
  const [activeTab, setActiveTab] = useState("views"); // "views" | "premium" | "perfect"

  // fetch list + global analytics on mount
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingList(true);
      try {
        const r = await fetch("/api/analytics/users", { cache: "no-store" });
        const j = await r.json();
        if (!active) return;

        setUsersList(j.users || []);
        setTopViewedBrands(j.topViewedBrands || []);
        setTopViewedProducts(j.topViewedProducts || []);

        setTopPremiumBrands(j.topPremiumBrands || []);
        setTopPremiumProducts(j.topPremiumProducts || []);
        setPremiumUpdatedAt(j.premiumUpdatedAt || null);

        setTopPerfect5(j.topPerfectProduct5Categories || []);
        setTopPerfect24(j.topPerfectProduct24Categories || []);
        setPerfect5UpdatedAt(j.perfectProduct5UpdatedAt || null);
        setPerfect24UpdatedAt(j.perfectProduct24UpdatedAt || null);
      } catch {
        if (!active) return;
        setUsersList([]);
        setTopViewedBrands([]);
        setTopViewedProducts([]);
        setTopPremiumBrands([]);
        setTopPremiumProducts([]);
        setPremiumUpdatedAt(null);
        setTopPerfect5([]);
        setTopPerfect24([]);
        setPerfect5UpdatedAt(null);
        setPerfect24UpdatedAt(null);
      } finally {
        if (active) setLoadingList(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // reset images toggle when switching user
  useEffect(() => {
    setShowImages(false);
  }, [selectedId]);

  // fetch detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    (async () => {
      setLoadingDetail(true);
      try {
        const r = await fetch(
          `/api/analytics/users?id=${encodeURIComponent(selectedId)}`,
          { cache: "no-store" }
        );
        const j = await r.json();
        if (active) setDetail(j.user || null);
      } catch {
        if (active) setDetail(null);
      } finally {
        if (active) setLoadingDetail(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = usersList || [];
    if (q) {
      arr = arr.filter((u) => {
        const hay = [
          String(u.id ?? ""),
          u.name ?? "",
          u.number ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return [...arr].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [usersList, query]);

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
              {usersList.length}
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            className="flex-1 p-3 border border-rose-200 rounded text-black w-full md:w-auto"
            placeholder="Search by name, number, or ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left panel - users (name + number only) */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-rose-50 px-3 py-2 text-sm text-[#ab1f10] font-semibold">
              Users {loadingList ? "(loading…)" : `(${filtered.length})`}
            </div>
            <ul className="max-h-[65vh] overflow-auto divide-y">
              {loadingList && filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-gray-500 text-sm">
                  Loading…
                </li>
              ) : filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-gray-500 text-sm">
                  No matching users.
                </li>
              ) : (
                filtered.map((u) => {
                  const isSel = selectedId === u.id;
                  return (
                    <li
                      key={u.id}
                      className={`px-3 py-2 cursor-pointer hover:bg-rose-50 ${
                        isSel ? "bg-rose-100" : ""
                      }`}
                      onClick={() => setSelectedId(u.id)}
                    >
                      <div className="text-sm font-semibold text-black">
                        {u.name || "Unnamed"}
                      </div>
                      <div className="text-xs text-gray-700">
                        {u.number || "-"}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          {/* Right panel - user details (lazy loaded) */}
          <div className="md:col-span-2">
            {!selectedId && (
              <div className="text-gray-600">
                Select a user to view their analytics.
              </div>
            )}

            {selectedId && loadingDetail && (
              <div className="text-gray-600">Loading details…</div>
            )}

            {selectedId && !loadingDetail && !detail && (
              <div className="text-gray-600">No details available.</div>
            )}

            {selectedId && detail && (
              <div className="space-y-4">
                {/* User header */}
                <div className="flex justify-between items-center gap-4">
                  <div>
                    <div className="text-xl font-semibold text-black">
                      {detail.info?.name || "Unnamed User"}
                    </div>
                    <div className="text-sm text-gray-700">
                      {detail.info?.number ||
                        detail.info?.id ||
                        detail.id ||
                        "-"}
                    </div>
                    <div className="text-sm text-gray-600">
                      {detail.info?.email || "-"}
                      {detail.info?.phone ? ` · ${detail.info.phone}` : ""}
                    </div>
                    <div className="text-xs text-gray-500">
                      Joined: {fmtDate(detail.info?.createdAt)}
                      {detail.info?.lastLogin ? (
                        <> · Last login: {fmtDate(detail.info.lastLogin)}</>
                      ) : null}
                    </div>
                    {(detail.info?.skinTone || detail.info?.undertone) && (
                      <div className="text-xs text-gray-600">
                        {detail.info?.skinTone
                          ? `Skin Tone: ${detail.info.skinTone}`
                          : ""}
                        {detail.info?.undertone
                          ? ` · Undertone: ${detail.info.undertone}`
                          : ""}
                      </div>
                    )}
                    <div className="text-sm text-[#ab1f10] font-medium">
                      Coins: {detail.wallet?.coins ?? 0}
                      {detail.wallet?.subscriber ? " · Subscriber" : ""}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowImages((v) => !v)}
                      className="px-4 py-2 text-sm rounded-lg border border-rose-200 text-[#ab1f10] hover:bg-rose-50 transition"
                    >
                      {showImages ? "Hide images" : "View images"}
                    </button>
                  </div>
                </div>

                {/* Images section */}
                {showImages && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* User image */}
                    <div className="border rounded-lg bg-rose-50 p-3 flex flex-col items-center">
                      <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                        User Image
                      </div>
                      {detail.info?.number && detail.info?.latestVersion ? (
                        <img
                          src={`https://d2bsc5jetkp62c.cloudfront.net/permanent/shopify/${detail.info.number}/${detail.info.latestVersion}/high_quality_image`}
                          alt={`${detail.info?.name || "User"} image`}
                          className="w-full max-w-xs rounded-lg object-cover"
                        />
                      ) : (
                        <div className="text-xs text-gray-600">
                          No user image available.
                        </div>
                      )}
                    </div>

                    {/* Model image */}
                    <div className="border rounded-lg bg-rose-50 p-3 flex flex-col items-center">
                      <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                        Model Image
                      </div>
                      {detail.info?.modelPath ? (
                        <img
                          src={`https://d2bsc5jetkp62c.cloudfront.net/full_model_pics_jpg/${detail.info.modelPath}`}
                          alt="Model image"
                          className="w-full max-w-xs rounded-lg object-cover"
                        />
                      ) : (
                        <div className="text-xs text-gray-600">
                          No model image available.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Premium products */}
                <div className="border rounded-lg bg-rose-50 p-3">
                  <div className="text-sm font-semibold text-[#ab1f10] mb-2">
                    Premium Products ({detail.premium?.count || 0})
                  </div>

                  {(detail.premium?.products?.length || 0) === 0 && (
                    <div className="text-sm text-gray-600">
                      No premium purchases.
                    </div>
                  )}

                  {(detail.premium?.products || []).map((p, idx) => (
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
                    Favourites ({detail.favourites?.count || 0})
                  </div>

                  {(detail.favourites?.items?.length || 0) === 0 && (
                    <div className="text-sm text-gray-600">
                      No favourites yet.
                    </div>
                  )}

                  {(detail.favourites?.items || []).map((f, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center bg-white rounded p-2 mb-1"
                    >
                      <div className="col-span-2">
                        <div className="text-sm font-semibold text-black">
                          {f.name || f.product || "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          {f.brand || "-"}
                        </div>
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
                          <a
                            href={f.link}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
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

        {/* Bottom Analytics Tabs */}
        <div className="mt-10">
          {/* Tab Buttons */}
          <div className="flex flex-wrap border-b border-rose-200 mb-4">
            {[
              { id: "views", label: "Views" },
              { id: "premium", label: "Premium Products" },
              { id: "perfect", label: "Perfect Product Premium" },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px mr-2 transition ${
                    isActive
                      ? "border-[#ab1f10] text-[#ab1f10]"
                      : "border-transparent text-gray-500 hover:text-[#ab1f10] hover:border-rose-200"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          {activeTab === "views" && (
            <div className="space-y-8">
              {/* Top Viewed Brands */}
              <div>
                <h2 className="text-lg font-semibold text-[#ab1f10] mb-2">
                  Top Viewed Brands
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {(topViewedBrands || []).length > 0 ? (
                    topViewedBrands.map((b, idx) => (
                      <div
                        key={idx}
                        className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black"
                        title="Global views across all users"
                      >
                        <span className="font-medium text-left">{b.brand}</span>
                        <span className="font-semibold">{b.views}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-600 text-sm">
                      No viewed brand data yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Top Viewed Products */}
              <div>
                <h2 className="text-lg font-semibold text-[#ab1f10] mb-2">
                  Top Viewed Products
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {(topViewedProducts || []).length > 0 ? (
                    topViewedProducts.map((row, idx) => (
                      <div
                        key={idx}
                        className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black"
                        title="Global views across all users"
                      >
                        <span className="font-medium text-left">
                          {row.brand} — {row.product}
                        </span>
                        <span className="font-semibold">{row.views}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-600 text-sm">
                      No viewed product data yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "premium" && (
            <div className="space-y-8">
              {/* Top Premium Brands */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-lg font-semibold text-[#ab1f10]">
                    Top Premium Brands (grants)
                  </h2>
                  <div className="text-xs text-gray-500">
                    {premiumUpdatedAt ? `Updated: ${fmtDate(premiumUpdatedAt)}` : ""}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {(topPremiumBrands || []).length > 0 ? (
                    topPremiumBrands.map((b, idx) => (
                      <div
                        key={idx}
                        className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black"
                        title="Total premium product grants per brand"
                      >
                        <span className="font-medium text-left">{b.brand}</span>
                        <span className="font-semibold">{b.count}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-600 text-sm">
                      No premium brand data yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Top Premium Products */}
              <div>
                <h2 className="text-lg font-semibold text-[#ab1f10] mb-2">
                  Top Premium Products (grants)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {(topPremiumProducts || []).length > 0 ? (
                    topPremiumProducts.map((row, idx) => (
                      <div
                        key={idx}
                        className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black"
                        title="Total premium product grants per product"
                      >
                        <span className="font-medium text-left">
                          {row.brand} — {row.product}
                        </span>
                        <span className="font-semibold">{row.count}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-600 text-sm">
                      No premium product data yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "perfect" && (
            <div className="space-y-8">
              {/* Perfect Product Premium (1-hour) */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-lg font-semibold text-[#ab1f10]">
                    Perfect Product Premium (1-hour)
                  </h2>
                  <div className="text-xs text-gray-500">
                    {perfect5UpdatedAt
                      ? `Updated: ${fmtDate(perfect5UpdatedAt)}`
                      : ""}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {(topPerfect5 || []).length > 0 ? (
                    topPerfect5.map((row, idx) => (
                      <div
                        key={idx}
                        className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black"
                        title="Number of 1-hour premium unlocks for this category"
                      >
                        <span className="font-medium text-left">
                          {row.category || "Unknown"}
                        </span>
                        <span className="font-semibold">{row.count}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-600 text-sm">
                      No 1-hour perfect product data yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Perfect Product Premium (24-hour) */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-lg font-semibold text-[#ab1f10]">
                    Perfect Product Premium (24-hour)
                  </h2>
                  <div className="text-xs text-gray-500">
                    {perfect24UpdatedAt
                      ? `Updated: ${fmtDate(perfect24UpdatedAt)}`
                      : ""}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {(topPerfect24 || []).length > 0 ? (
                    topPerfect24.map((row, idx) => (
                      <div
                        key={idx}
                        className="bg-rose-50 border border-rose-200 rounded p-2 text-sm flex justify-between text-black"
                        title="Number of 24-hour premium unlocks for this category"
                      >
                        <span className="font-medium text-left">
                          {row.category || "Unknown"}
                        </span>
                        <span className="font-semibold">{row.count}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-600 text-sm">
                      No 24-hour perfect product data yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
