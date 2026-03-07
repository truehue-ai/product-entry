"use client";

import { useEffect, useMemo, useState } from "react";
import StepsAnalyticsGraph from "../analytics/stepsAnalyticsGraph";
import { useRouter } from "next/navigation";

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
    padding: "13px 15px",
    fontSize: 15,
    fontFamily: "'Inter', sans-serif",
    color: "#1a0a09",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#7b241c",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    marginBottom: 7,
  },
  btnPrimary: {
    background: "linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 11,
    padding: "11px 20px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(171,31,16,0.22)",
    transition: "opacity 0.15s, transform 0.15s",
    whiteSpace: "nowrap",
  },
  btnOutline: {
    background: "rgba(255,255,255,0.7)",
    color: "#ab1f10",
    border: "1.5px solid rgba(171,31,16,0.3)",
    borderRadius: 11,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
    transition: "background 0.15s",
    whiteSpace: "nowrap",
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 700,
    color: "#7b241c",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 16,
  },
};

function fmtDate(value) {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : isNaN(Date.parse(String(value))) ? null : Date.parse(String(value));
  if (!n) return "-";
  try { return new Date(n).toLocaleString(); } catch { return "-"; }
}

// Small stat card used in steps insights
function StatCard({ title, value, sub, children }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.72)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.08)", padding: "18px 20px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      {value !== undefined && <div style={{ fontSize: 28, fontWeight: 800, color: "#1a0a09", lineHeight: 1.1, marginBottom: 4 }}>{value}</div>}
      {sub && <div style={{ fontSize: 12, color: "#9b4a42", marginBottom: children ? 10 : 0 }}>{sub}</div>}
      {children}
    </div>
  );
}

// Small user ID pill list
function UserIdList({ ids }) {
  if (!ids?.length) return <div style={{ fontSize: 13, color: "#9b4a42" }}>None yet.</div>;
  return (
    <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
      {ids.map((num, i) => (
        <div key={i} style={{ background: "rgba(171,31,16,0.05)", borderRadius: 7, padding: "5px 10px", fontSize: 13, color: "#1a0a09", fontWeight: 500 }}>{num}</div>
      ))}
    </div>
  );
}

// Ranked list row (brands/products)
function RankRow({ left, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.65)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(171,31,16,0.06)" }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: "#1a0a09" }}>{left}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#ab1f10" }}>{right}</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();

  const [loadingList, setLoadingList] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [topViewedBrands, setTopViewedBrands] = useState([]);
  const [topViewedProducts, setTopViewedProducts] = useState([]);
  const [topPremiumBrands, setTopPremiumBrands] = useState([]);
  const [topPremiumProducts, setTopPremiumProducts] = useState([]);
  const [premiumUpdatedAt, setPremiumUpdatedAt] = useState(null);
  const [topPerfect5, setTopPerfect5] = useState([]);
  const [topPerfect24, setTopPerfect24] = useState([]);
  const [perfect5UpdatedAt, setPerfect5UpdatedAt] = useState(null);
  const [perfect24UpdatedAt, setPerfect24UpdatedAt] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showImages, setShowImages] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsInsights, setStepsInsights] = useState(null);
  const [activeTab, setActiveTab] = useState("views");
  const [graphData, setGraphData] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);

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
        setGraphLoading(true);
        const g = await fetch("/api/analytics/steps-graph", { cache: "no-store" });
        const gjson = await g.json();
        setGraphData(gjson.graph || null);
      } catch {
        if (!active) return;
      } finally {
        if (active) { setLoadingList(false); setGraphLoading(false); }
      }
    })();
    return () => (active = false);
  }, []);

  useEffect(() => { setShowImages(false); }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    (async () => {
      setLoadingDetail(true);
      try {
        const r = await fetch(`/api/analytics/users?id=${encodeURIComponent(selectedId)}`, { cache: "no-store" });
        const j = await r.json();
        if (active) setDetail(j.user || null);
      } catch {
        if (active) setDetail(null);
      } finally {
        if (active) setLoadingDetail(false);
      }
    })();
    return () => { active = false; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = usersList || [];
    if (q) arr = arr.filter((u) => [String(u.id ?? ""), u.name ?? "", u.number ?? ""].join(" ").toLowerCase().includes(q));
    const getTs = (u) => {
      const v = u?.lastLogin ?? u?.createdAt;
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : isNaN(Date.parse(String(v))) ? null : Date.parse(String(v));
      return n && !Number.isNaN(n) ? n : null;
    };
    return [...arr].sort((a, b) => {
      const ta = getTs(a), tb = getTs(b);
      if (ta != null && tb == null) return -1;
      if (ta == null && tb != null) return 1;
      if (ta != null && tb != null && ta !== tb) return tb - ta;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [usersList, query]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)", fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .th-btn-ghost:hover { background: rgba(171,31,16,0.06) !important; }
        .list-item:hover { background: rgba(171,31,16,0.04) !important; }
        .list-item.selected { background: rgba(171,31,16,0.08) !important; border-left: 4px solid #ab1f10 !important; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
        .tab-btn { background: none; border: none; border-bottom: 3px solid transparent; padding: 10px 18px; font-size: 14px; font-weight: 600; color: #9b4a42; cursor: pointer; transition: all 0.15s; }
        .tab-btn:hover { color: #ab1f10; }
        .tab-btn.active { border-bottom-color: #ab1f10; color: #ab1f10; }
      `}</style>

      {/* ── Top Nav ── */}
      <div style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(255,255,255,0.65)", borderBottom: "1px solid rgba(255,255,255,0.8)", padding: "16px 36px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 12px rgba(171,31,16,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="th-btn-ghost" onClick={() => router.push('/')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#ab1f10", padding: "8px 14px", borderRadius: 9 }}>← Home</button>
          <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
          <button className="th-btn-ghost" onClick={() => router.push('/logs')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>Logs</button>
          <div style={{ width: 1, height: 20, background: "rgba(171,31,16,0.2)" }} />
          <button className="th-btn-ghost" onClick={() => router.push('/audit')} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#7b241c", padding: "8px 14px", borderRadius: 9 }}>Audit</button>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#ab1f10", letterSpacing: "-0.3px" }}>User Analytics</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="th-btn-outline" style={GL.btnOutline}
            onClick={async () => {
              setStepsLoading(true);
              try { const r = await fetch("/api/analytics/steps", { cache: "no-store" }); const j = await r.json(); setStepsInsights(j.insights || null); }
              catch { setStepsInsights(null); } finally { setStepsLoading(false); }
            }}>
            {stepsLoading ? "Analysing…" : "Analyse Steps"}
          </button>
          <button className="th-btn-outline" style={GL.btnOutline}
            onClick={async () => {
              setLoadingList(true);
              try { const r = await fetch("/api/analytics/users?mode=full", { cache: "no-store" }); const j = await r.json(); setUsersList(j.users || []); }
              catch (e) { console.error(e); } finally { setLoadingList(false); }
            }}>
            Sort by Activity
          </button>
        </div>
      </div>

      <div style={{ padding: "28px 28px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── Funnel Graph ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={GL.sectionHeader}>Daily User Funnel & Coin Actions</div>
            {graphLoading && <span style={{ fontSize: 13, color: "#9b4a42" }}>Loading…</span>}
          </div>
          {graphData
            ? <StepsAnalyticsGraph data={graphData} />
            : !graphLoading && <div style={{ fontSize: 14, color: "#9b4a42", padding: "20px 0" }}>No graph data available.</div>}
        </div>

        {/* ── Steps Insights (expanded when loaded) ── */}
        {stepsInsights && (
          <div style={{ ...GL.card, padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={GL.sectionHeader}>Steps Insights</div>
              <span style={{ fontSize: 13, color: "#9b4a42" }}>
                {stepsInsights.usersWithSteps} users · {stepsInsights.timedUsers ? `${stepsInsights.timedUsers} timed` : ""}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
              <StatCard title="Returning Users" value={stepsInsights.retention?.returningUsers}
                sub={`${stepsInsights.retention?.returningRate}% logged in on multiple days`} />

              <StatCard title="Use-Coins Users" value={stepsInsights.useCoins?.totalUsers}
                sub={`${stepsInsights.useCoins?.totalEvents || 0} total actions`} />

              <StatCard title="Most Common Coin Actions">
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                  {(stepsInsights.useCoins?.topTypes || []).slice(0, 5).map((t, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "rgba(171,31,16,0.05)", borderRadius: 7, padding: "5px 10px", fontSize: 13 }}>
                      <span style={{ fontWeight: 500, color: "#1a0a09" }}>{t.type}</span>
                      <span style={{ fontWeight: 700, color: "#ab1f10" }}>{t.count}</span>
                    </div>
                  ))}
                </div>
              </StatCard>

              <StatCard title="Model Fine-Tune" value={stepsInsights.modelFineTune?.totalUsersReached}
                sub={`${stepsInsights.modelFineTune?.totalEvents || 0} total fine-tune actions`} />

              <StatCard title="Shade Guide Scrolls" value={stepsInsights.shadeGuideActions?.scroll?.totalUsers}
                sub={`${stepsInsights.shadeGuideActions?.scroll?.totalEvents || 0} total scroll events`} />

              <StatCard title="Shade Guide Clicks" value={stepsInsights.shadeGuideActions?.clicked?.totalUsers}
                sub={`${stepsInsights.shadeGuideActions?.clicked?.totalEvents || 0} total click events`}>
                <UserIdList ids={stepsInsights.shadeGuideActions?.clicked?.userIds} />
              </StatCard>

              <StatCard title="Subscribers" value={stepsInsights.subscribers?.total}
                sub="Users subscribed to TrueHue">
                <UserIdList ids={stepsInsights.subscribers?.userIds} />
              </StatCard>

              <StatCard title="Users With Coins" value={stepsInsights.usersWithCoins?.total}
                sub="More than 0 coins">
                <UserIdList ids={stepsInsights.usersWithCoins?.userIds} />
              </StatCard>

              <StatCard title="Shade Guide Purchases" value={stepsInsights.usersWithShadeGuide?.total}>
                <UserIdList ids={stepsInsights.usersWithShadeGuide?.userIds} />
              </StatCard>
            </div>
          </div>
        )}

        {/* ── Users + Detail ── */}
        <div style={{ ...GL.card, padding: 0, overflow: "hidden" }}>
          {/* Search + header */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(171,31,16,0.08)", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
              Users <span style={{ fontWeight: 400, color: "#b08080" }}>({filtered.length})</span>
            </div>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15 }}>🔎</span>
              <input className="th-input" style={{ ...GL.input, paddingLeft: 36, fontSize: 14 }}
                placeholder="Search by name, number, or ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", minHeight: 500 }}>

            {/* User list */}
            <div style={{ borderRight: "1px solid rgba(171,31,16,0.08)", overflowY: "auto", maxHeight: "70vh" }}>
              {loadingList && filtered.length === 0 && (
                <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 14, color: "#9b4a42" }}>Loading…</div>
              )}
              {!loadingList && filtered.length === 0 && (
                <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 14, color: "#9b4a42" }}>No matching users.</div>
              )}
              {filtered.map((u) => {
                const isSel = selectedId === u.id;
                return (
                  <div key={u.id}
                    className={`list-item ${isSel ? "selected" : ""}`}
                    onClick={() => setSelectedId(u.id)}
                    style={{ padding: "13px 20px 13px 20px", cursor: "pointer", borderLeft: "4px solid transparent", borderBottom: "1px solid rgba(171,31,16,0.05)", transition: "background 0.12s" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{u.number}</div>
                    {u.name && <div style={{ fontSize: 12, color: "#7b241c", marginTop: 1 }}>{u.name}</div>}
                  </div>
                );
              })}
            </div>

            {/* User detail */}
            <div style={{ padding: 28, overflowY: "auto", maxHeight: "70vh" }}>
              {!selectedId && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 12 }}>
                  <div style={{ fontSize: 32 }}>👈</div>
                  <div style={{ fontSize: 15, color: "#9b4a42", fontWeight: 500 }}>Select a user to view analytics</div>
                </div>
              )}
              {selectedId && loadingDetail && (
                <div style={{ fontSize: 14, color: "#9b4a42", padding: "40px 0", textAlign: "center" }}>Loading details…</div>
              )}
              {selectedId && !loadingDetail && !detail && (
                <div style={{ fontSize: 14, color: "#9b4a42", padding: "40px 0", textAlign: "center" }}>No details available.</div>
              )}
              {selectedId && detail && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                  {/* User header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#1a0a09", marginBottom: 3 }}>{detail.info?.name || "Unnamed User"}</div>
                      <div style={{ fontSize: 14, color: "#7b241c", marginBottom: 2 }}>{detail.info?.number || detail.info?.id || detail.id || "-"}</div>
                      <div style={{ fontSize: 13, color: "#9b4a42" }}>
                        {detail.info?.email || "-"}{detail.info?.phone ? ` · ${detail.info.phone}` : ""}
                      </div>
                      <div style={{ fontSize: 12, color: "#b08080", marginTop: 3 }}>
                        Joined {fmtDate(detail.info?.createdAt)}
                        {detail.info?.lastLogin ? ` · Last login ${fmtDate(detail.info.lastLogin)}` : ""}
                      </div>
                      {(detail.info?.skinTone || detail.info?.undertone) && (
                        <div style={{ fontSize: 12, color: "#7b241c", marginTop: 3 }}>
                          {detail.info.skinTone ? `Skin Tone: ${detail.info.skinTone}` : ""}
                          {detail.info.undertone ? ` · Undertone: ${detail.info.undertone}` : ""}
                        </div>
                      )}
                      <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: "#ab1f10" }}>
                        {detail.wallet?.coins ?? 0} coins{detail.wallet?.subscriber ? " · Subscriber ✓" : ""}
                      </div>
                    </div>
                    <button className="th-btn-outline" style={GL.btnOutline} onClick={() => setShowImages((v) => !v)}>
                      {showImages ? "Hide Images" : "View Images"}
                    </button>
                  </div>

                  {/* Images */}
                  {showImages && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      {[
                        { label: "User Image", src: detail.info?.number && detail.info?.latestVersion ? `https://d2bsc5jetkp62c.cloudfront.net/permanent/shopify/${detail.info.number}/${detail.info.latestVersion}/high_quality_image` : null },
                        { label: "Model Image", src: detail.info?.modelPath ? `https://d2bsc5jetkp62c.cloudfront.net/full_model_pics_jpg/${detail.info.modelPath}` : null },
                      ].map(({ label, src }) => (
                        <div key={label} style={{ background: "rgba(255,255,255,0.6)", borderRadius: 12, border: "1px solid rgba(171,31,16,0.08)", padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#7b241c", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                          {src ? <img src={src} alt={label} style={{ width: "100%", maxWidth: 240, borderRadius: 10, objectFit: "cover" }} />
                            : <div style={{ fontSize: 13, color: "#9b4a42" }}>Not available.</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Steps */}
                  <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.07)", padding: 20 }}>
                    <div style={{ ...GL.sectionHeader }}>Steps Taken ({detail.steps?.count || 0})</div>
                    {!(detail.steps?.items?.length) ? (
                      <div style={{ fontSize: 14, color: "#9b4a42" }}>No steps recorded.</div>
                    ) : (
                      <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                        {detail.steps.items.map((s, idx) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.7)", borderRadius: 9, padding: "9px 14px" }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{s.step}</span>
                            <span style={{ fontSize: 12, color: "#9b4a42" }}>{fmtDate(s.at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Premium products */}
                  <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.07)", padding: 20 }}>
                    <div style={GL.sectionHeader}>Premium Products ({detail.premium?.count || 0})</div>
                    {!(detail.premium?.products?.length) ? (
                      <div style={{ fontSize: 14, color: "#9b4a42" }}>No premium purchases.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {detail.premium.products.map((p, idx) => (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "center", background: "rgba(255,255,255,0.7)", borderRadius: 9, padding: "10px 14px" }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{p.product}</span>
                            <span style={{ fontSize: 13, color: "#7b241c" }}>{p.brand}</span>
                            <span style={{ fontSize: 12, color: "#9b4a42" }}>{fmtDate(p.purchasedAt)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Favourites */}
                  <div style={{ background: "rgba(255,255,255,0.55)", borderRadius: 14, border: "1px solid rgba(171,31,16,0.07)", padding: 20 }}>
                    <div style={GL.sectionHeader}>Favourites ({detail.favourites?.count || 0})</div>
                    {!(detail.favourites?.items?.length) ? (
                      <div style={{ fontSize: 14, color: "#9b4a42" }}>No favourites yet.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {/* Header row */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 80px 1fr auto", gap: 12, padding: "0 14px", fontSize: 11, fontWeight: 700, color: "#9b4a42", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          <span>Name / Brand</span><span></span><span>Hex</span><span>Link</span><span>Price</span>
                        </div>
                        {detail.favourites.items.map((f, idx) => (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 40px 80px 1fr auto", gap: 12, alignItems: "center", background: "rgba(255,255,255,0.7)", borderRadius: 9, padding: "10px 14px" }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{f.name || f.product || "—"}</div>
                              <div style={{ fontSize: 12, color: "#7b241c" }}>{f.brand || "-"}</div>
                            </div>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: f.hex || "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.12)" }} title={f.hex || ""} />
                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "#7b241c" }}>{f.hex || "-"}</span>
                            <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.link ? <a href={f.link} target="_blank" rel="noreferrer" style={{ color: "#ab1f10", textDecoration: "underline" }}>Link ↗</a> : <span style={{ color: "#c0b0b0" }}>—</span>}
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a0a09" }}>{typeof f.price === "number" ? `₹${f.price}` : "—"}</span>
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

        {/* ── Bottom Analytics Tabs ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1.5px solid rgba(171,31,16,0.1)", marginBottom: 24, gap: 4 }}>
            {[{ id: "views", label: "Views" }, { id: "premium", label: "Premium Products" }, { id: "perfect", label: "Perfect Product Premium" }].map((tab) => (
              <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Views Tab */}
          {activeTab === "views" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              <div>
                <div style={GL.sectionHeader}>Top Viewed Brands</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {(topViewedBrands || []).length > 0
                    ? topViewedBrands.map((b, idx) => <RankRow key={idx} left={b.brand} right={b.views} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
              <div>
                <div style={GL.sectionHeader}>Top Viewed Products</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {(topViewedProducts || []).length > 0
                    ? topViewedProducts.map((row, idx) => <RankRow key={idx} left={`${row.brand} — ${row.product}`} right={row.views} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
            </div>
          )}

          {/* Premium Tab */}
          {activeTab === "premium" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={GL.sectionHeader}>Top Premium Brands (grants)</div>
                  {premiumUpdatedAt && <span style={{ fontSize: 12, color: "#9b4a42" }}>Updated {fmtDate(premiumUpdatedAt)}</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {(topPremiumBrands || []).length > 0
                    ? topPremiumBrands.map((b, idx) => <RankRow key={idx} left={b.brand} right={b.count} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
              <div>
                <div style={GL.sectionHeader}>Top Premium Products (grants)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {(topPremiumProducts || []).length > 0
                    ? topPremiumProducts.map((row, idx) => <RankRow key={idx} left={`${row.brand} — ${row.product}`} right={row.count} />)
                    : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                </div>
              </div>
            </div>
          )}

          {/* Perfect Tab */}
          {activeTab === "perfect" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {[
                { label: "Perfect Product Premium (1-hour)", data: topPerfect5, updatedAt: perfect5UpdatedAt, key: "category" },
                { label: "Perfect Product Premium (24-hour)", data: topPerfect24, updatedAt: perfect24UpdatedAt, key: "category" },
              ].map(({ label, data, updatedAt }) => (
                <div key={label}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={GL.sectionHeader}>{label}</div>
                    {updatedAt && <span style={{ fontSize: 12, color: "#9b4a42" }}>Updated {fmtDate(updatedAt)}</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                    {(data || []).length > 0
                      ? data.map((row, idx) => <RankRow key={idx} left={row.category || "Unknown"} right={row.count} />)
                      : <div style={{ fontSize: 14, color: "#9b4a42" }}>No data yet.</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}