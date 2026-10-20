"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  GL, C1, C2, GOOD, BAD, useRangeParam, useMetaSnapshot, useDhruvi, useMoney, fmtPct, fmtRoas, fmtInt, withMetrics, agoText,
  notReported, listReports, NA, NA_TEXT, RoasValue, sliceBreakdowns, entityRows,
  PageShell, RangeBar, Section, Segmented, TipBox, TipRow, LegendDot, Legend, Empty,
} from "../shared";

// Persona: who buys from our Meta ads (ad insights breakdowns for the selected range) and how that compares with
// our Instagram followers (follower_demographics). Only aggregate Meta / Instagram data — no per-user data,
// follower interests or "accounts they follow" (the APIs don't offer them).

// ── Every threshold on this page — tune here ──
const RULES = {
  roasTarget: 1.5,
  lowDataSpend: 300,                       // below this spend (₹) ROAS is grey with "low data" instead of green / red
  topN: 3,                                 // persona cards per list
  roasRank: { minPurchases: 3, minSpend: 300 }, // a segment needs this much before it can rank by ROAS
  cut: { minSpend: 500, maxRoas: 1.0 },    // "worst segments": spent this much with 0 purchases or ROAS below this
  gap: { minShare: 5, ratio: 2 },          // follower vs buyer gap: one share ≥ 5% and at least 2× the other
};

const GENDER = { female: "Women", male: "Men", unknown: "Unknown gender", F: "Women", M: "Men", U: "Unknown gender" };
const DIMS = [["ageGender", "Age + gender"], ["region", "Region"], ["device", "Device"], ["placement", "Placement"]];
const DIM_LABEL = { ageGender: "Age + gender", region: "Region", device: "Device", placement: "Placement", age: "Age", gender: "Gender" };
const segName = (dim, x) => (dim === "ageGender" ? `${GENDER[x.gender] || x.gender} ${x.age}` : x.key);
// Meta doesn't report conversions (purchases / purchase value) by region — region only ever shows click performance
const CLICKS_ONLY = new Set(["region"]);
const roasProps = { target: RULES.roasTarget, lowRoas: RULES.cut.maxRoas, lowDataSpend: RULES.lowDataSpend };
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export default function PersonaPage() {
  return (
    <Suspense fallback={null}>
      <Persona />
    </Suspense>
  );
}

function Persona() {
  const user = useDhruvi();
  const data = useMetaSnapshot(user === "dhruvi");
  const rp = useRangeParam(data.snap);
  const { snap, error } = data;
  const money = useMoney(snap?.account?.currency);
  const [dim, setDim] = useState("ageGender");
  const [sort, setSort] = useState({ key: "purchases", dir: -1 });

  // every range is cut from the one cached snapshot — switching tabs never calls Meta
  const view = useMemo(() => (snap && !rp.range.error ? buildView(snap, rp.range) : null), [snap, rp.range]);

  if (!user) return null;
  if (user !== "dhruvi") return <PageShell title="Persona"><div style={{ ...GL.card, padding: 18, fontSize: 14, color: "#7b241c" }}>Only dhruvi can view this.</div></PageShell>;

  const rows = view ? [...view.dims[dim]].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
  }) : [];
  const clicksView = view ? view.clicksOnly[dim] : false;
  const COLS = clicksView
    ? [["name", "Segment"], ["spend", "Spend"], ["linkClicks", "Link clicks"], ["linkCtr", "CTR (link)"], ["linkCpc", "CPC (link)"], ["spendShare", "% of spend"]]
    : [["name", "Segment"], ["spend", "Spend"], ["linkClicks", "Link clicks"], ["purchases", "Purchases"], ["share", "% of purch."],
      ["revenue", "Revenue"], ["roas", "ROAS"], ["cpp", "Cost / purchase"]];
  const fmtCol = (k, r) => {
    if (k === "roas") return <RoasValue row={r} {...roasProps} />;
    if (k === "share" ? r.purchases == null : notReported(r, k)) return <NA />;
    return {
      name: r.name, spend: money(r.spend), linkClicks: fmtInt(r.linkClicks), purchases: fmtInt(r.purchases), share: fmtPct(r.share, 0),
      revenue: money(r.revenue), cpp: money(r.cpp), linkCtr: fmtPct(r.linkCtr), linkCpc: money(r.linkCpc, 2), spendShare: fmtPct(r.spendShare, 1),
    }[k];
  };

  return (
    <PageShell title="Persona">
      <RangeBar rp={rp} data={data} />
      {error && <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#c0392b" }}>{error}</div>}

      <div style={{ fontSize: 13, fontWeight: 800, color: "#ab1f10", margin: "6px 4px -6px" }}>A · Who buys (from ad insights)</div>

      {view && (
        view.totalPurchases === 0 ? (
          <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#7b6b6b" }}>No purchases in this range yet, so there's no buyer persona to show. Try a longer range.</div>
        ) : (
          <>
            <div className="ma-grid-2">
              <Section title="Top segments by purchases" sub="Age + gender segments with the most purchases">
                {view.topByPurchases.map((x) => <PersonaCard key={x.key} x={x} traits={view.traits} money={money} />)}
              </Section>
              <Section title="Top segments by ROAS" sub={`Needs ${RULES.roasRank.minPurchases}+ purchases and ${money(RULES.roasRank.minSpend)}+ spend`}>
                {view.topByRoas.length ? view.topByRoas.map((x) => <PersonaCard key={x.key} x={x} traits={view.traits} money={money} />)
                  : <Empty>No segment has enough purchases yet.</Empty>}
              </Section>
            </div>
            <div style={{ fontSize: 11.5, color: "#9b8b88", margin: "-8px 4px 0" }}>
              Meta reports age + gender separately from region, device and placement, so the "most buyers" and "most ad clicks" lines on each card are across everyone, not just that segment. Region uses clicks because Meta doesn't report purchases by region.
            </div>

            <Section title="Worst segments to cut" sub={`Spent ${money(RULES.cut.minSpend)}+ with 0 purchases, or ROAS below ${RULES.cut.maxRoas}`}>
              {view.worst.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
                  {view.worst.slice(0, 12).map((x) => (
                    <div key={`${x.dim}-${x.key}`} style={{ background: "rgba(220,38,38,0.07)", borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#9b8b88", textTransform: "uppercase" }}>{DIM_LABEL[x.dim]}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1a0a09", textTransform: "capitalize", overflowWrap: "anywhere" }}>{x.name}</div>
                      <div style={{ fontSize: 12.5, color: BAD }}>
                        {x.purchases === 0 ? `${money(x.spend)} spent, 0 purchases` : `ROAS ${fmtRoas(x.roas)} on ${money(x.spend)} spent`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty>Nothing above the threshold — no obvious segment to cut.</Empty>}
            </Section>

            <Heatmap cells={view.heat} money={money} />

            <Section title="Segments" sub={clicksView ? `Meta doesn't report purchases by ${DIM_LABEL[dim].toLowerCase()}. Showing click performance instead. Tap a column to sort.` : "Tap a column to sort."} right={<Segmented value={dim} onChange={setDim} options={DIMS} />}>
              <div className="m-scroll-x" style={{ overflow: "auto", maxHeight: 520, borderRadius: 12, border: "1px solid rgba(171,31,16,0.08)", background: "rgba(255,255,255,0.6)" }}>
                <table className="ma">
                  <thead>
                    <tr>
                      {COLS.map(([k, label]) => (
                        <th key={k} className={`sortable ${k === "name" ? "l name" : ""}`}
                          onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? -p.dir : k === "name" ? 1 : -1 }))}>
                          {label}{sort.key === k ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}>
                        {COLS.map(([k]) => (
                          <td key={k} className={k === "name" ? "l name" : ""}
                            style={k === "name" ? { textTransform: "capitalize", fontWeight: 600 } : undefined}>
                            {fmtCol(k, r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!rows.length && <tr><td className="l" colSpan={COLS.length} style={{ color: "#9b8b88", padding: 16 }}>No data in this range.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )
      )}

      <div style={{ fontSize: 13, fontWeight: 800, color: "#ab1f10", margin: "6px 4px -6px" }}>B · Our Instagram followers</div>
      <InstagramSection buyers={view} />
    </PageShell>
  );
}

// ── Section A numbers ──
function buildView(snap, range) {
  const b = sliceBreakdowns(snap, range.since, range.until);
  const sumOf = (list, k) => (list || []).reduce((t, x) => t + (x[k] || 0), 0);
  const totalPurchases = sumOf(b.age, "purchases") || sumOf(entityRows(snap, range, "campaign"), "purchases");
  // dimensions without conversion data: always region, plus any where Meta reported no purchases at all
  const clicksOnly = Object.fromEntries(["ageGender", "region", "device", "placement", "age", "gender"]
    .map((d) => [d, CLICKS_ONLY.has(d) || ((b[d] || []).length > 0 && !listReports(b[d], "purchases"))]));
  const prep = (dim) => {
    const list = (b[dim] || []).filter((x) => x.spend > 0 || x.purchases > 0);
    const spendTotal = sumOf(list, "spend"), clickTotal = sumOf(list, "linkClicks");
    return list.map((x) => {
      // region: drop whatever conversion numbers came back — Meta doesn't report them there
      const y = clicksOnly[dim] ? { ...x, purchases: null, revenue: null } : x;
      const m = withMetrics(y);
      return {
        ...m, dim, name: segName(dim, x),
        share: y.purchases == null ? null : totalPurchases ? (y.purchases / totalPurchases) * 100 : 0,
        spendShare: spendTotal ? (x.spend / spendTotal) * 100 : null,
        clickShare: x.linkClicks != null && clickTotal ? (x.linkClicks / clickTotal) * 100 : null,
      };
    });
  };
  const dims = Object.fromEntries(["ageGender", "region", "device", "placement", "age", "gender"].map((d) => [d, prep(d)]));

  const topBy = (list, k) => [...list].sort((a, b2) => (b2[k] ?? -1) - (a[k] ?? -1));
  const enough = (x) => x.spend >= Math.max(RULES.roasRank.minSpend, RULES.lowDataSpend);
  const topByPurchases = clicksOnly.ageGender ? [] : topBy(dims.ageGender.filter((x) => x.purchases > 0), "purchases").slice(0, RULES.topN);
  const topByRoas = clicksOnly.ageGender ? [] : topBy(dims.ageGender.filter((x) => x.purchases >= RULES.roasRank.minPurchases && enough(x)), "roas").slice(0, RULES.topN);
  // traits for the cards: most buyers by device / placement; region by ad clicks (no purchase data there)
  const buyerTrait = (d) => {
    if (clicksOnly[d]) return null;
    const t = topBy(dims[d].filter((x) => x.purchases > 0), "purchases")[0];
    return t ? { name: t.name, share: t.share, of: "purchases" } : null;
  };
  const clickTrait = (d) => {
    const t = topBy(dims[d].filter((x) => x.linkClicks > 0), "linkClicks")[0];
    return t ? { name: t.name, share: t.clickShare, of: "ad clicks", ctr: t.linkCtr } : null;
  };
  const traits = { device: buyerTrait("device"), placement: buyerTrait("placement"), region: clickTrait("region") };

  const worst = ["ageGender", "device", "placement"]
    .filter((d) => !clicksOnly[d])
    .flatMap((d) => dims[d])
    .filter((x) => x.spend >= Math.max(RULES.cut.minSpend, RULES.lowDataSpend) && (x.purchases === 0 || (x.roas != null && x.roas < RULES.cut.maxRoas)))
    .sort((a, b2) => b2.spend - a.spend);

  // age × gender heatmap
  const ages = [...new Set(dims.ageGender.map((x) => x.age))].sort();
  const genders = ["female", "male", "unknown"].filter((g) => dims.ageGender.some((x) => x.gender === g));
  const heat = { ages, genders, cell: Object.fromEntries(dims.ageGender.map((x) => [`${x.age}|${x.gender}`, x])) };

  return { totalPurchases, dims, clicksOnly, topByPurchases, topByRoas, traits, worst, heat };
}

function PersonaCard({ x, traits, money }) {
  const buyers = [traits.device, traits.placement].filter(Boolean);
  return (
    <div style={{ background: "rgba(255,255,255,0.7)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#1a0a09" }}>{x.name}</div>
      <div style={{ fontSize: 13, color: "#374151" }}>
        <b>{fmtPct(x.share, 0)}</b> of purchases · ROAS <RoasValue row={x} {...roasProps} />
        {" "}· {money(x.cpp)} per purchase · {money(x.spend)} spent
      </div>
      {buyers.length > 0 && (
        <div style={{ fontSize: 12, color: "#7b6b6b", textTransform: "capitalize" }}>
          Most buyers: {buyers.map((v) => `${v.name} (${fmtPct(v.share, 0)})`).join(" · ")}
        </div>
      )}
      {traits.region && (
        <div style={{ fontSize: 12, color: "#7b6b6b" }}>
          Most ad clicks from <b style={{ textTransform: "capitalize" }}>{traits.region.name}</b> ({fmtPct(traits.region.share, 0)} of link clicks, CTR {fmtPct(traits.region.ctr)})
        </div>
      )}
    </div>
  );
}

// Diverging around the ROAS target: orange below, grey at target, blue above
function heatColor(roas, target) {
  if (roas == null) return "rgba(0,0,0,0.03)";
  const d = Math.max(-1, Math.min(1, (roas - target) / target));
  if (Math.abs(d) < 0.08) return "rgba(120,120,120,0.16)";
  return d > 0 ? `rgba(42,120,214,${0.15 + 0.65 * d})` : `rgba(235,104,52,${0.15 + 0.65 * -d})`;
}

function Heatmap({ cells, money }) {
  if (!cells.ages.length) return null;
  return (
    <Section title="ROAS by age × gender" sub={`Blue = above the ${RULES.roasTarget} target, grey ≈ target, orange = below. Each cell shows ROAS and spend; under ₹${RULES.lowDataSpend} spent is "low data" and left uncoloured.`}>
      <div className="m-scroll-x" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 4, fontSize: 13, minWidth: 320, width: "100%", fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th />
              {cells.genders.map((g) => <th key={g} style={{ fontSize: 11, fontWeight: 700, color: "#7b6b6b", textTransform: "uppercase", padding: 4 }}>{GENDER[g]}</th>)}
            </tr>
          </thead>
          <tbody>
            {cells.ages.map((a) => (
              <tr key={a}>
                <td style={{ fontSize: 12, fontWeight: 700, color: "#374151", paddingRight: 6, whiteSpace: "nowrap" }}>{a}</td>
                {cells.genders.map((g) => {
                  const x = cells.cell[`${a}|${g}`];
                  const na = x && notReported(x, "roas");
                  const low = x && x.spend < RULES.lowDataSpend;
                  const roas = x?.spend > 0 && !na && !low ? x.roas ?? 0 : null;
                  const strong = roas != null && Math.abs(roas - RULES.roasTarget) / RULES.roasTarget > 0.6;
                  const title = !x ? "No delivery" : na ? `${GENDER[g]} ${a}: ROAS ${NA_TEXT}, ${money(x.spend)} spent`
                    : `${GENDER[g]} ${a}: ROAS ${fmtRoas(x.roas)}, ${fmtInt(x.purchases)} purchases, ${money(x.spend)} spent${low ? " — low data" : ""}`;
                  return (
                    <td key={g} title={title}
                      style={{ background: low ? "rgba(0,0,0,0.04)" : heatColor(roas, RULES.roasTarget), borderRadius: 8, padding: "8px 6px", textAlign: "center", color: strong ? "#fff" : "#1a0a09" }}>
                      {x?.spend > 0 ? (
                        <>
                          <div style={{ fontWeight: 800, color: low ? "#9b8b88" : undefined }}>{na ? <NA /> : fmtRoas(x.roas ?? 0)}</div>
                          <div style={{ fontSize: 11, opacity: 0.85, color: low ? "#9b8b88" : undefined }}>{money(x.spend)}{low ? " · low data" : ""}</div>
                        </>
                      ) : <span style={{ color: "#c0b0b0" }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── Section B: Instagram ──
function InstagramSection({ buyers }) {
  const [ig, setIg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/meta-ads/instagram?t=${Date.now()}`, { cache: "no-store" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setIg(j);
    } catch (e) {
      setMsg(e?.message || "Could not load Instagram data");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/meta-ads/instagram", { method: "POST" });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setMsg(j.connected ? "✓ Instagram data updated" : "");
      await load();
    } catch (e) {
      setMsg(e?.message || "Instagram refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const ageMin = ig?.fetchedAt ? (Date.now() - Date.parse(ig.fetchedAt)) / 60000 : null;
  const cooldown = ig?.connected && ageMin != null && ageMin < (ig.cooldownMin || 30) ? Math.ceil((ig.cooldownMin || 30) - ageMin) : 0;
  const button = (
    <button className="th-btn-outline" style={{ ...GL.btnOutline, opacity: busy || cooldown ? 0.55 : 1 }} disabled={busy || cooldown > 0} onClick={refresh}>
      {busy ? "Checking Instagram…" : cooldown ? `↻ Refresh in ${cooldown} min` : "↻ Refresh Instagram"}
    </button>
  );

  if (loading && !ig) return <div style={{ ...GL.card, padding: 16, fontSize: 13, color: "#7b6b6b" }}>Loading…</div>;

  if (!ig?.exists || !ig.connected) {
    return (
      <Section title="Connect Instagram to unlock" sub="Compare our Instagram followers with the people who buy from our ads." right={button}>
        <div style={{ fontSize: 13.5, color: "#374151", lineHeight: 1.6 }}>
          {ig?.exists
            ? <>We couldn't read follower demographics{ig.reason ? <> — <span style={{ color: "#92400e" }}>{ig.reason}</span></> : null}.</>
            : <>Instagram data hasn't been fetched yet. Click <b>Refresh Instagram</b> to try.</>}
          <div style={{ marginTop: 10, background: "rgba(171,31,16,0.05)", borderRadius: 10, padding: "10px 12px" }}>
            To unlock this section, the Meta system user token (stored in SSM, see <code>META_TOKEN_PARAM</code>) needs these permissions:
            <ul style={{ margin: "6px 0 6px 18px", padding: 0 }}>
              <li><code>instagram_basic</code></li>
              <li><code>instagram_manage_insights</code></li>
              <li><code>pages_read_engagement</code></li>
            </ul>
            and the Instagram professional account must be linked to a Facebook Page that the system user has access to.
            Optionally set <code>META_IG_USER_ID</code> to point at the account directly. Follower demographics also need at least 100 followers.
          </div>
        </div>
        {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.startsWith("✓") ? GOOD : "#c0392b" }}>{msg}</div>}
      </Section>
    );
  }

  return <InstagramConnected ig={ig} buyers={buyers} button={button} msg={msg} ageMin={ageMin} />;
}

// share of total, keyed by a normalised name
function shares(list, keyOf) {
  const g = {};
  let total = 0;
  for (const x of list || []) { const k = keyOf(x); if (!k) continue; g[k] = (g[k] || 0) + x.value; total += x.value; }
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, total ? (v / total) * 100 : 0]));
}

function InstagramConnected({ ig, buyers, button, msg, ageMin }) {
  const d = ig.demographics || {};
  const compare = useMemo(() => {
    const out = {};
    const buyerShares = (dim, keyOf) => shares((buyers?.dims[dim] || []).map((x) => ({ ...x, value: x.purchases })), keyOf);
    const build = (folShares, buyShares, labelOf) => {
      const keys = [...new Set([...Object.keys(folShares), ...Object.keys(buyShares)])];
      return keys.map((k) => {
        const f = folShares[k] || 0, b = buyShares[k] || 0;
        const gap = f >= RULES.gap.minShare && f >= RULES.gap.ratio * b ? "follow" : b >= RULES.gap.minShare && b >= RULES.gap.ratio * f ? "buy" : null;
        return { key: k, name: labelOf(k), followers: f, buyers: b, gap };
      }).sort((a, b2) => Math.max(b2.followers, b2.buyers) - Math.max(a.followers, a.buyers));
    };
    out.age = build(shares(d.age, (x) => x.dims[0]), buyerShares("age", (x) => x.key), (k) => k);
    out.gender = build(shares(d.gender, (x) => ({ F: "female", M: "male", U: "unknown" }[x.dims[0]] || x.dims[0])), buyerShares("gender", (x) => x.key), (k) => GENDER[k] || k);
    // IG cities ("Mumbai, Maharashtra") rolled up to states, to compare with ad regions
    const stateName = {};
    const fol = shares(d.city, (x) => { const st = String(x.dims[0] || "").split(",").pop().trim(); stateName[norm(st)] ||= st; return norm(st); });
    // Meta has no purchases by region, so regions compare followers with ad link clicks instead
    const clk = shares((buyers?.dims.region || []).map((x) => ({ ...x, value: x.linkClicks })), (x) => { stateName[norm(x.key)] ||= x.key; return norm(x.key); });
    out.region = build(fol, clk, (k) => stateName[k] || k).map((r) => ({ ...r, gap: null })).slice(0, 15);
    return out;
  }, [d, buyers]);

  const countries = useMemo(() => {
    const s = shares(d.country, (x) => x.dims[0]);
    return Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [d]);

  const online = ig.online ? Array.from({ length: 24 }, (_, h) => ({ hour: h, followers: Number(ig.online[String(h)]) || 0 })) : null;
  const gaps = ["age", "gender"].flatMap((dim) => compare[dim].filter((x) => x.gap).map((x) => ({ ...x, dim })));
  const noBuyers = !buyers || buyers.totalPurchases === 0;

  return (
    <>
      <Section title={`@${ig.account.username || "instagram"}`}
        sub={`${ig.account.followers ? `${fmtInt(ig.account.followers)} followers · ` : ""}follower data ${agoText(ageMin)} · lifetime demographics from Instagram`}
        right={button}>
        {msg && <div style={{ fontSize: 13, fontWeight: 600, color: msg.startsWith("✓") ? GOOD : "#c0392b" }}>{msg}</div>}
        {noBuyers && <div style={{ fontSize: 12.5, color: "#92400e" }}>No purchases in the selected range, so there's nothing to compare followers with — pick a longer range.</div>}
        {!noBuyers && (
          <div className="ma-grid-2">
            <GapList title="Follow us, but don't buy" color={C1} items={gaps.filter((x) => x.gap === "follow")}
              empty="No big group of followers that isn't buying." />
            <GapList title="Buy, but don't follow us" color={C2} items={gaps.filter((x) => x.gap === "buy")}
              empty="Buyers look like our followers." />
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "#9b8b88" }}>
          A gap = one share is at least {RULES.gap.minShare}% and {RULES.gap.ratio}× the other. Follower shares cover all followers (lifetime);
          buyer shares are purchases from our ads in the selected range. Instagram only lists the top cities, so regions are rolled up from those.
        </div>
      </Section>

      <div className="ma-grid-3">
        <CompareBars title="Age" rows={compare.age} />
        <CompareBars title="Gender" rows={compare.gender} />
        <CompareBars title="Region (state)" rows={compare.region} otherLabel="Ad link clicks"
          sub="Share of followers vs share of ad link clicks — Meta doesn't report purchases by region" />
      </div>

      <div className="ma-grid-2">
        <Section title="Followers by country" sub="Top countries, share of followers">
          {countries.length ? countries.map(([c, v]) => (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 40, fontWeight: 700, color: "#374151" }}>{c}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(0,0,0,0.05)" }}>
                <div style={{ width: `${v}%`, height: "100%", borderRadius: 4, background: C1 }} />
              </div>
              <span style={{ width: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtPct(v, 1)}</span>
            </div>
          )) : <Empty>No country data.</Empty>}
        </Section>
        <Section title="When followers are online" sub="Average followers online per hour, as reported by Instagram (Instagram may report these hours in US Pacific time, not IST).">
          {online ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={online} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} interval={3} tickFormatter={(h) => `${h}h`} />
                <YAxis tick={{ fontSize: 11, fill: "#7b6b6b" }} tickLine={false} axisLine={false} width={44} />
                <Tooltip cursor={{ fill: "rgba(171,31,16,0.05)" }} content={({ active, payload }) => active && payload?.length ? (
                  <TipBox title={`${payload[0].payload.hour}:00`}><TipRow color={C1} label="Followers online" value={fmtInt(payload[0].payload.followers)} /></TipBox>
                ) : null} />
                <Bar dataKey="followers" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>Instagram didn't return online-follower data for this account.</Empty>}
        </Section>
      </div>
    </>
  );
}

function GapList({ title, color, items, empty }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: "#1a0a09", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{title}
      </div>
      {items.length ? items.map((x) => (
        <div key={`${x.dim}-${x.key}`} style={{ fontSize: 13, color: "#374151" }}>
          <b style={{ textTransform: "capitalize" }}>{x.name}</b> <span style={{ color: "#9b8b88" }}>({x.dim})</span>:{" "}
          {fmtPct(x.followers, 0)} of followers vs {fmtPct(x.buyers, 0)} of buyers
        </div>
      )) : <div style={{ fontSize: 13, color: "#9b8b88" }}>{empty}</div>}
    </div>
  );
}

// Followers vs buyers share per group, as paired bars
function CompareBars({ title, rows, otherLabel = "Buyers", sub = "Share of followers vs share of buyers" }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.followers, r.buyers]));
  return (
    <Section title={title} sub={sub}>
      <Legend><LegendDot color={C1} label="Followers" bar /><LegendDot color={C2} label={otherLabel} bar /></Legend>
      {rows.length ? rows.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(70px, 34%) 1fr", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <div style={{ color: "#1a0a09", textTransform: "capitalize", overflowWrap: "anywhere" }}>
            {r.name}
            {r.gap && <div style={{ fontSize: 10.5, fontWeight: 700, color: r.gap === "follow" ? C1 : "#c2410c" }}>{r.gap === "follow" ? "follow, don't buy" : "buy, don't follow"}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[["followers", C1], ["buyers", C2]].map(([k, c]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }} title={`${k === "followers" ? "Followers" : otherLabel}: ${fmtPct(r[k], 1)}`}>
                <div style={{ flex: 1, height: 7, borderRadius: 4, background: "rgba(0,0,0,0.04)" }}>
                  <div style={{ width: `${(r[k] / max) * 100}%`, height: "100%", borderRadius: 4, background: c }} />
                </div>
                <span style={{ width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#374151" }}>{fmtPct(r[k], 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )) : <Empty>No data.</Empty>}
    </Section>
  );
}
