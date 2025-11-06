"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function LogsPage() {
  const [query, setQuery] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [currentUser, setCurrentUser] = useState("");
  const router = useRouter();

  // build & download builder state
  const [buildCategory, setBuildCategory] = useState("lip-gloss");
  const [building, setBuilding] = useState(false);

  const handleBuildAndDownloadDict = async () => {
    if (!buildCategory) return;
    setBuilding(true);
    try {
      const res = await fetch("/api/build-product-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: buildCategory }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!data?.success) {
        alert(data?.error || "Build failed");
        return;
      }

      const pretty = JSON.stringify(data.dict || {}, null, 2);
      const blob = new Blob([pretty], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename || `CategorisedLMD.${buildCategory}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.message || "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  // who is logged in? (cookie is not httpOnly, so we can read it)
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_auth=([^;]+)/);
    if (m) setCurrentUser(decodeURIComponent(m[1]));
  }, []);

  // fetch list (debounced)
  useEffect(() => {
    let active = true;
    const fetchList = async () => {
      setLoadingList(true);
      try {
        const r = await fetch(
          `/api/logs/list?q=${encodeURIComponent(query)}`,
          { cache: "no-store" }
        );
        const j = await r.json();
        if (active) setItems(j.items || []);
      } finally {
        if (active) setLoadingList(false);
      }
    };
    const t = setTimeout(fetchList, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  // fetch details for selected item
  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!selected) {
        setDetails(null);
        return;
      }
      setLoadingDetails(true);
      try {
        const r = await fetch(
          `/api/logs/get?brand=${encodeURIComponent(
            selected.brand
          )}&product=${encodeURIComponent(selected.product)}`,
          { cache: "no-store" }
        );
        const j = await r.json();
        if (active) setDetails(j);
      } finally {
        if (active) setLoadingDetails(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [selected]);

  const list = useMemo(() => items, [items]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-rose-100 p-6">
      <div className="mx-auto max-w-6xl bg-white rounded-2xl shadow-xl p-6">
        {/* Header with Audit + Builder (dhruvi-only) */}
        <div className="mb-4 flex flex-wrap items-center gap-2 justify-between">
          <h1 className="text-2xl font-bold text-[#ab1f10]">
            TrueHue — Saved Products Log
          </h1>

          <div className="flex items-center gap-2">
            <button
              className="px-4 py-2 bg-white text-[#ab1f10] border border-[#ab1f10] rounded hover:bg-rose-100"
              onClick={() => router.push("/")}
              type="button"
            >
              Back to Editor
            </button>

            {currentUser === "dhruvi" && (
              <>
                {/* Dhruvi-only: Build & Download Category Dict */}
                <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                  <label className="text-xs font-semibold text-[#ab1f10]">
                    Category
                  </label>
                  <select
                    value={buildCategory}
                    onChange={(e) => setBuildCategory(e.target.value)}
                    className="p-1 border border-rose-200 rounded text-black text-sm"
                  >
                    {/* keep this list in sync with your editor categories */}
                    <option value="matte-lipstick">Matte Lipstick</option>
                    <option value="satin-lipstick">Satin Lipstick</option>
                    <option value="lip-gloss">Lip Gloss / Lip Oil</option>
                    <option value="lip-tint">Lip Tint / Lip Stain</option>
                    <option value="lip-balm">Lip Balm</option>
                    <option value="cream-blush">Cream / Liquid Blush</option>
                    <option value="powder-blush">Powder Blush</option>
                    <option value="contour">Contour</option>
                    <option value="cream-eyeshadow">Cream Eyeshadow</option>
                    <option value="powder-eyeshadow">Powder Eyeshadow</option>

                    {/* base categories now available for dict build */}
                    <option value="foundation">Foundation</option>
                    <option value="concealer">Concealer</option>
                    <option value="skin-tint">Skin Tint</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleBuildAndDownloadDict}
                    disabled={building}
                    className={`px-3 py-1 rounded text-white ${
                      building
                        ? "bg-gray-400"
                        : "bg-[#ab1f10] hover:bg-red-700"
                    }`}
                    title="Rebuild the category dict from S3 and download it locally"
                  >
                    {building ? "Building…" : "Build & Download"}
                  </button>
                </div>

                <button
                  className="px-4 py-2 bg-white text-[#ab1f10] border border-[#ab1f10] rounded hover:bg-rose-100"
                  onClick={() => router.push("/audit")}
                  type="button"
                  title="View shade saves by user & date"
                >
                  Audit
                </button>

                {/* ✅ NEW: View Analytics Button (only for Dhruvi) */}
                <button
                  className="px-4 py-2 bg-[#ab1f10] text-white rounded hover:bg-red-700"
                  onClick={() => router.push("/analytics")}
                  type="button"
                  title="View user analytics and premium data"
                >
                  View Analytics
                </button>
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-3 mb-4">
          <input
            className="w-full p-3 border border-rose-200 rounded text-black"
            placeholder="Search by brand or product…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: results */}
          <div className="md:col-span-1">
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-rose-50 px-3 py-2 text-sm text-[#ab1f10] font-semibold">
                Results {loadingList ? "…loading" : `(${list.length})`}
              </div>
              <ul className="max-h-[60vh] overflow-auto divide-y">
                {list.map((it) => {
                  const isSel =
                    selected &&
                    it.brand === selected.brand &&
                    it.product === selected.product;
                  return (
                    <li
                      key={`${it.brand}:::${it.product}`}
                      className={`px-3 py-2 cursor-pointer hover:bg-rose-50 ${
                        isSel ? "bg-rose-100" : ""
                      }`}
                      onClick={() => setSelected(it)}
                    >
                      <div className="text-sm font-semibold text-black">
                        {it.product}
                      </div>
                      <div className="text-xs text-gray-600">{it.brand}</div>
                    </li>
                  );
                })}
                {!loadingList && list.length === 0 && (
                  <li className="px-3 py-6 text-sm text-gray-500 text-center">
                    No matches.
                  </li>
                )}
              </ul>
            </div>
          </div>

          {/* Right: details */}
          <div className="md:col-span-2">
            {!selected && (
              <div className="text-gray-600">
                Select a product to view details.
              </div>
            )}
            {selected && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xl font-semibold text-black">
                      {selected.product}
                    </div>
                    <div className="text-sm text-gray-600">
                      {selected.brand}
                    </div>
                    {details?.meta?.lastSavedBy && (
                      <div className="text-xs text-gray-600">
                        Saved by{" "}
                        <span className="font-medium">
                          {details.meta.lastSavedBy}
                        </span>
                        {details.meta.lastSavedAt
                          ? ` on ${new Date(
                              details.meta.lastSavedAt
                            ).toLocaleString()}`
                          : ""}
                      </div>
                    )}
                  </div>
                  <button
                    className="px-4 py-2 bg-[#ab1f10] text-white rounded hover:bg-red-700"
                    onClick={() => {
                      router.push(
                        `/?brand=${encodeURIComponent(
                          selected.brand
                        )}&product=${encodeURIComponent(
                          selected.product
                        )}&from=logs`
                      );
                    }}
                  >
                    Edit in Editor
                  </button>
                </div>

                <div className="text-xs text-gray-600">
                  {details?.meta?.hasLinks ? "Links ✓" : "Links —"} &nbsp;·&nbsp;
                  {details?.meta?.hasPrice ? "Prices ✓" : "Prices —"} &nbsp;·&nbsp;
                  {details?.meta?.hasType ? "Type ✓" : "Type —"}
                </div>

                <div className="border rounded-lg p-3 bg-rose-50">
                  {loadingDetails && (
                    <div className="text-sm text-gray-600">
                      Loading details…
                    </div>
                  )}
                  {!loadingDetails && details && (
                    <div className="space-y-3">
                      {details.shades.length === 0 && (
                        <div className="text-sm text-gray-600">
                          No shades found.
                        </div>
                      )}
                      {details.shades.map((s, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center bg-white rounded p-2"
                        >
                          <div className="col-span-2">
                            <div className="text-sm font-semibold text-black">
                              {s.name}
                            </div>
                            <div className="text-xs text-gray-600">
                              {s.hex}
                            </div>
                          </div>
                          <div
                            className="w-10 h-10 rounded border"
                            style={{ backgroundColor: s.hex }}
                          />
                          <div className="text-xs text-gray-700">
                            {s.skintone ? `Tone: ${s.skintone}` : "-"}{" "}
                            {s.undertone ? `· UT: ${s.undertone}` : ""}
                          </div>
                          <div className="text-xs truncate">
                            {s.link || "-"}
                          </div>
                          <div className="text-sm text-right">
                            {s.price ? `₹${s.price}` : "-"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
