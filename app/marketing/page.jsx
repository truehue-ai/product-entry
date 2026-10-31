"use client";

// Marketing Organiser (dhruvi only): Instagram planner, Ads planner, Inspo library and Settings.
// Data lives in S3 (see app/api/marketing/store.js); the tab and week are kept in the URL.

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { istToday, weekStart } from "./lib";
import { GL, Panel, Shell, Toast, useOrganiser } from "./ui";
import OrganicTab from "./OrganicTab";
import AdsTab from "./AdsTab";
import InspoTab from "./InspoTab";
import SettingsPanel from "./SettingsPanel";

const TABS = ["organic", "ads", "inspo", "settings"];

export default function MarketingPage() {
  return (
    <Suspense fallback={null}>
      <Organiser />
    </Suspense>
  );
}

function Organiser() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [me, setMe] = useState(null);
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_user=([^;]+)/);
    if (!m) { router.push("/login"); return; }
    setMe(decodeURIComponent(m[1]));
  }, [router]);

  const allowed = me === "dhruvi";
  const { data, error, load, api, patchLocal, saving, toast, setToast } = useOrganiser(allowed);

  const tab = TABS.includes(sp.get("tab")) ? sp.get("tab") : "organic";
  const w = sp.get("w");
  const ws = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? weekStart(w) : weekStart(istToday());
  const setParams = (patch) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) if (v == null) q.delete(k); else q.set(k, v);
    router.replace(`${pathname}?${q}`, { scroll: false });
  };
  const setTab = (t) => setParams({ tab: t });
  const setWs = (d) => setParams({ w: d === weekStart(istToday()) ? null : d });

  if (!me) return null;
  if (!allowed) {
    return (
      <Shell tab={tab} setTab={() => {}}>
        <Panel><div style={{ fontSize: 16 }}>You don't have access to the Marketing Organiser.</div></Panel>
      </Shell>
    );
  }

  let body;
  if (error) {
    body = <Panel><div style={{ color: "#b91c1c", fontSize: 16, marginBottom: 12 }}>{error}</div><button style={GL.btnOutline} onClick={load}>Try again</button></Panel>;
  } else if (!data) {
    body = <div style={{ ...GL.sub, fontSize: 16, padding: 20 }}>Loading…</div>;
  } else {
    const items = { organic: data.items?.organic || [], ads: data.items?.ads || [] };
    const common = { config: data.config, inspo: data.inspo || [], api };
    body = tab === "organic" ? <OrganicTab {...common} items={items.organic} patchLocal={patchLocal} reload={load} ws={ws} setWs={setWs} />
      : tab === "ads" ? <AdsTab {...common} ads={items.ads} ws={ws} setWs={setWs} />
      : tab === "inspo" ? <InspoTab config={data.config} inspo={data.inspo || []} items={items} api={api} />
      : <SettingsPanel config={data.config} api={api} setToast={setToast} />;
  }

  return (
    <Shell tab={tab} setTab={setTab} saving={saving}>
      {body}
      <Toast text={toast} onClose={() => setToast("")} />
    </Shell>
  );
}
