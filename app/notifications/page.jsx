'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const GL = {
  card: {
    background: 'rgba(255,255,255,0.58)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1.5px solid rgba(255,255,255,0.8)',
    borderRadius: 18,
    boxShadow: '0 4px 24px rgba(171,31,16,0.07)',
  },
  input: {
    background: 'rgba(255,255,255,0.7)',
    border: '1.5px solid rgba(171,31,16,0.15)',
    borderRadius: 11,
    padding: '13px 15px',
    fontSize: 15,
    fontFamily: "'Inter', sans-serif",
    color: '#1a0a09',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 700,
    color: '#7b241c',
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    marginBottom: 7,
    fontFamily: "'Inter', sans-serif",
  },
  btnPrimary: {
    background: 'linear-gradient(135deg, #c0392b 0%, #ab1f10 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 11,
    padding: '13px 24px',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(171,31,16,0.22)',
    transition: 'opacity 0.15s, transform 0.15s',
    whiteSpace: 'nowrap',
  },
  btnOutline: {
    background: 'rgba(255,255,255,0.7)',
    color: '#ab1f10',
    border: '1.5px solid rgba(171,31,16,0.3)',
    borderRadius: 11,
    padding: '11px 20px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: 700,
    color: '#7b241c',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
};

const STATUS_STYLE = {
  sent:    { background: 'rgba(22,163,74,0.1)',  color: '#15803d', border: '1px solid rgba(22,163,74,0.25)' },
  failed:  { background: 'rgba(220,38,38,0.08)', color: '#b91c1c', border: '1px solid rgba(220,38,38,0.2)' },
  pending: { background: 'rgba(171,31,16,0.06)', color: '#7b241c', border: '1px solid rgba(171,31,16,0.15)' },
  skipped: { background: 'rgba(0,0,0,0.04)',     color: '#6b7280', border: '1px solid rgba(0,0,0,0.1)' },
};

// ── Filter definitions ─────────────────────────────────────────────────────
// test(stepSet: Set<string>, stepCounts: Map<string, number>) => boolean
const FILTERS = [
  // Model fine-tune
  { id: 'never-fine-tune',       label: 'Never fine-tuned model',     group: 'Model Fine-Tune', test: (s)    => !s.has('model-fine-tune') },
  { id: 'has-fine-tune',         label: 'Has fine-tuned model',        group: 'Model Fine-Tune', test: (s)    => s.has('model-fine-tune') },
  // Coins
  { id: 'bought-coins-any',      label: 'Bought coins (any)',          group: 'Coins',           test: (_, c) => (c.get('bought-coins') || 0) >= 1 },
  { id: 'bought-coins-once',     label: 'Bought coins (exactly once)', group: 'Coins',           test: (_, c) => (c.get('bought-coins') || 0) === 1 },
  { id: 'bought-coins-multiple', label: 'Bought coins (2+ times)',     group: 'Coins',           test: (_, c) => (c.get('bought-coins') || 0) >= 2 },
  { id: 'never-bought-coins',    label: 'Never bought coins',          group: 'Coins',           test: (s)    => !s.has('bought-coins') },
  // Purchases
  { id: 'bought-shade-guide',        label: 'Bought Shade Guide',        group: 'Purchases', test: (s) => s.has('bought-shade-guide') },
  { id: 'never-bought-shade-guide',  label: 'Never bought Shade Guide',  group: 'Purchases', test: (s) => !s.has('bought-shade-guide') },
  { id: 'bought-premium',            label: 'Has bought premium',         group: 'Purchases', test: (s) => s.has('bought-premium') },
  { id: 'never-bought-premium',      label: 'Never bought premium',       group: 'Purchases', test: (s) => !s.has('bought-premium') },
  // Feature usage
  { id: 'used-shade-finder',     label: 'Used Shade Finder',           group: 'Feature Usage', test: (s) => s.has('shade-finder') || s.has('use-coins-shade-finder') },
  { id: 'never-shade-finder',    label: 'Never used Shade Finder',     group: 'Feature Usage', test: (s) => !s.has('shade-finder') && !s.has('use-coins-shade-finder') },
  { id: 'used-product-finder',   label: 'Used Product Finder',         group: 'Feature Usage', test: (s) => s.has('product-finder') || s.has('use-coins-product-finder') },
  { id: 'used-shade-guide',      label: 'Opened Shade Guide',          group: 'Feature Usage', test: (s) => s.has('shade-guide') },
  { id: 'scrolled-shade-guide',  label: 'Scrolled in Shade Guide',     group: 'Feature Usage', test: (s) => s.has('shade-guide-action-scroll') },
  { id: 'clicked-shade-guide',   label: 'Clicked in Shade Guide',      group: 'Feature Usage', test: (s) => s.has('shade-guide-action-clicked') },
  // Logins
  { id: 'login-once',            label: 'Logged in once only',          group: 'Logins', test: (_, c) => (c.get('login') || 0) === 1 },
  { id: 'login-multiple',        label: 'Logged in 2+ times',           group: 'Logins', test: (_, c) => (c.get('login') || 0) >= 2 },
  { id: 'not-logged-in-today',   label: 'Not logged in today',          group: 'Logins', test: (_, __, dates) => !dates.loginDates.has(todayKey()) },
  { id: 'not-logged-in-3days',   label: 'Not logged in (3+ days)',      group: 'Logins', test: (_, __, dates) => dates.lastLoginMs === null || (Date.now() - dates.lastLoginMs) >= 3 * 86400000 },
  { id: 'not-logged-in-5days',   label: 'Not logged in (5+ days)',      group: 'Logins', test: (_, __, dates) => dates.lastLoginMs === null || (Date.now() - dates.lastLoginMs) >= 5 * 86400000 },
];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseLoginDates(steps) {
  // steps is raw items array from API: [{ step: "login : 13/02/2026, 02:29:20", at: null }]
  const loginDates = new Set();
  let lastLoginMs = null;

  for (const s of steps) {
    const raw = s.step || '';
    const nameEnd = raw.indexOf(' : ');
    if (nameEnd === -1) continue;
    const stepName = raw.substring(0, nameEnd).trim();
    if (stepName !== 'login') continue;

    const timeStr = raw.substring(nameEnd + 3).trim(); // "13/02/2026, 02:29:20"
    const [datePart, timePart] = timeStr.split(', ');
    if (!datePart || !timePart) continue;
    const [dd, mm, yyyy] = datePart.split('/').map(Number);
    const [hh, min, ss]  = timePart.split(':').map(Number);
    const ms = new Date(yyyy, mm - 1, dd, hh, min, ss).getTime();
    if (isNaN(ms)) continue;

    const key = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    loginDates.add(key);
    if (lastLoginMs === null || ms > lastLoginMs) lastLoginMs = ms;
  }

  return { loginDates, lastLoginMs };
}

const TABS = [
  { id: 'home',       label: 'Home',       icon: '🏠' },
  { id: 'shade',      label: 'Shade',      icon: '🎨' },
  { id: 'product',    label: 'Product',    icon: '🛍️' },
  { id: 'learn',      label: 'Learn',      icon: '📖' },
  { id: 'favourites', label: 'Favourites', icon: '❤️' },
  { id: 'profile',    label: 'Profile',    icon: '👤' },
  { id: 'account',    label: 'Account',    icon: '⚙️' },
];

const FILTER_GROUPS = ['Model Fine-Tune', 'Coins', 'Purchases', 'Feature Usage', 'Logins'];

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <span style={{ ...s, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

function FilterChip({ filter, active, count, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(171,31,16,0.1)' : 'rgba(255,255,255,0.65)',
        border: active ? '1.5px solid rgba(171,31,16,0.45)' : '1.5px solid rgba(171,31,16,0.12)',
        borderRadius: 22,
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? '#ab1f10' : '#7b241c',
        cursor: 'pointer',
        fontFamily: "'Inter', sans-serif",
        transition: 'all 0.14s',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        whiteSpace: 'nowrap',
      }}
    >
      {filter.label}
      {count != null && (
        <span style={{
          background: active ? '#ab1f10' : 'rgba(171,31,16,0.12)',
          color: active ? '#fff' : '#ab1f10',
          borderRadius: 10,
          padding: '1px 7px',
          fontSize: 11,
          fontWeight: 700,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function NotificationsPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_auth=([^;]+)/);
    if (!m) { router.push('/login'); return; }
    const u = decodeURIComponent(m[1]);
    if (u !== 'dhruvi') { router.push('/'); return; }
    setUser(u);
  }, [router]);

  // All token users
  const [tokenUsers, setTokenUsers]   = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Steps per user: Map<id, { stepSet, stepCounts }>
  const [stepsData, setStepsData]       = useState(null);
  const [loadingSteps, setLoadingSteps] = useState(false);

  // Filters
  const [activeFilters, setActiveFilters] = useState([]);

  // Compose
  const [targetTab, setTargetTab] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody]   = useState('');
  const [sending, setSending] = useState(false);

  // Results
  const [results, setResults]         = useState([]);
  const [showResults, setShowResults] = useState(false);

  // ── Fetch token users ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoadingUsers(true);
      try {
        const [r1, r2] = await Promise.all([
          fetch('/api/analytics/users', { cache: 'no-store' }),
          fetch('/api/analytics/users?mode=full', { cache: 'no-store' }),
        ]);
        const j1 = await r1.json();
        const j2 = await r2.json();
        const tokenList = j1.usersWithPushTokens || [];
        const nameMap = new Map((j2.users || []).map(u => [u.id, u.name || '']));
        if (active) setTokenUsers(tokenList.map(u => ({ ...u, name: nameMap.get(u.id) || '' })));
      } catch {
        if (active) setTokenUsers([]);
      } finally {
        if (active) setLoadingUsers(false);
      }
    })();
    return () => { active = false; };
  }, [user]);

  // ── Load steps (lazy) ──────────────────────────────────────────────────
  const loadStepsData = async () => {
    if (stepsData !== null || loadingSteps) return;
    setLoadingSteps(true);
    try {
      const perUser = new Map();
      await Promise.all(
        tokenUsers.map(async (u) => {
          try {
            const r = await fetch(`/api/analytics/users?id=${encodeURIComponent(u.id)}`, { cache: 'no-store' });
            const j = await r.json();
            const steps = j?.user?.steps?.items || [];
            const parseStepName = (raw) => {
              if (!raw) return '';
              const idx = raw.indexOf(' : ');
              return idx !== -1 ? raw.substring(0, idx).trim() : raw.trim();
            };
            const stepNames = steps.map(s => parseStepName(s.step));
            const stepSet    = new Set(stepNames);
            const stepCounts = new Map();
            for (const name of stepNames) stepCounts.set(name, (stepCounts.get(name) || 0) + 1);
            const loginDateInfo = parseLoginDates(steps);
            perUser.set(u.id, { stepSet, stepCounts, ...loginDateInfo });
          } catch {
            perUser.set(u.id, { stepSet: new Set(), stepCounts: new Map() });
          }
        })
      );
      setStepsData(perUser);
    } finally {
      setLoadingSteps(false);
    }
  };

  // ── Derived: filtered users + per-filter counts ────────────────────────
  const filteredUsers = useMemo(() => {
    if (activeFilters.length === 0) return tokenUsers;
    if (!stepsData) return tokenUsers;
    return tokenUsers.filter((u) => {
      const d = stepsData.get(u.id);
      if (!d) return false;
      return activeFilters.every((fid) => {
          const f = FILTERS.find(x => x.id === fid);
          return f ? f.test(d.stepSet, d.stepCounts, d) : true;
        });
    });
  }, [tokenUsers, activeFilters, stepsData]);

  const filterCounts = useMemo(() => {
    if (!stepsData) return {};
    const out = {};
    for (const f of FILTERS) {
      out[f.id] = tokenUsers.filter(u => {
        const d = stepsData.get(u.id);
        return d ? f.test(d.stepSet, d.stepCounts, d) : false;
      }).length;
    }
    return out;
  }, [stepsData, tokenUsers]);

  const toggleFilter = (id) =>
    setActiveFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // ── Send logic ─────────────────────────────────────────────────────────
  const sentCount    = results.filter(r => r.status === 'sent').length;
  const failedCount  = results.filter(r => r.status === 'failed').length;
  const pendingCount = results.filter(r => r.status === 'pending').length;

  const runSend = async (targets) => {
    setSending(true);
    setShowResults(true);
    setResults(targets.map(u => ({ id: u.id, status: 'pending', detail: '' })));
    const out = [];
    for (const u of targets) {
      try {
        const r = await fetch('/api/send-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: u.id, title: title.trim().replace(/\$name\$/gi, u.name || 'there'), body: body.trim().replace(/\$name\$/gi, u.name || 'there'), data: targetTab ? { tab: targetTab } : {} }),
        });
        const j = await r.json();
        out.push({ id: u.id, status: (r.ok && j.ok) ? 'sent' : 'failed', detail: j.error || (r.ok ? '' : `HTTP ${r.status}`) });
      } catch (e) {
        out.push({ id: u.id, status: 'failed', detail: e?.message || 'Network error' });
      }
      setResults([...out, ...targets.slice(out.length).map(u2 => ({ id: u2.id, status: 'pending', detail: '' }))]);
    }
    setResults(out);
    setSending(false);
  };

  const sendToFiltered = async () => {
    if (!title.trim()) { alert('Title is required.'); return; }
    if (!body.trim())  { alert('Message body is required.'); return; }
    if (filteredUsers.length === 0) { alert('No matching users.'); return; }
    const label = activeFilters.length > 0 ? 'filtered' : 'all';
    if (!window.confirm(`Send "${title}" to ${filteredUsers.length} ${label} user${filteredUsers.length !== 1 ? 's' : ''}?`)) return;
    await runSend(filteredUsers);
  };

  const sendTest = async () => {
    if (!title.trim()) { alert('Title is required.'); return; }
    if (!body.trim())  { alert('Message body is required.'); return; }
    setSending(true);
    setShowResults(true);
    setResults([{ id: '7383231612', status: 'pending', detail: '' }]);
    const testUser = tokenUsers.find(u => u.id === '7383231612');
    const testName = testUser?.name || 'there';
    try {
      const r = await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: '7383231612', title: title.trim().replace(/\$name\$/gi, testName), body: body.trim().replace(/\$name\$/gi, testName), data: targetTab ? { tab: targetTab } : {} }),
      });
      const j = await r.json();
      setResults([{ id: '7383231612', status: (r.ok && j.ok) ? 'sent' : 'failed', detail: j.error || '' }]);
    } catch (e) {
      setResults([{ id: '7383231612', status: 'failed', detail: e?.message || 'Network error' }]);
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  const isFiltered = activeFilters.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)', fontFamily: "'Inter', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        .th-input:focus { border-color: #ab1f10 !important; box-shadow: 0 0 0 3px rgba(171,31,16,0.1) !important; }
        .th-btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .th-btn-outline:hover { background: rgba(171,31,16,0.06) !important; border-color: #ab1f10 !important; }
        .th-btn-ghost:hover  { background: rgba(171,31,16,0.06) !important; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(171,31,16,0.2); border-radius: 4px; }
      `}</style>

      {/* ── Top Nav ── */}
      <div style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', background: 'rgba(255,255,255,0.65)', borderBottom: '1px solid rgba(255,255,255,0.8)', padding: '16px 36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 40, boxShadow: '0 1px 12px rgba(171,31,16,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="th-btn-ghost" onClick={() => router.push('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: '#ab1f10', padding: '8px 14px', borderRadius: 9 }}>← Home</button>
          <div style={{ width: 1, height: 20, background: 'rgba(171,31,16,0.2)' }} />
          <button className="th-btn-ghost" onClick={() => router.push('/analytics')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: '#7b241c', padding: '8px 14px', borderRadius: 9 }}>Analytics</button>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#ab1f10', letterSpacing: '-0.3px' }}>🔔 Notification Center</span>
        <div style={{ width: 160 }} />
      </div>

      <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1000, margin: '0 auto' }}>

        {/* ── Audience Filters ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: stepsData ? 4 : 0 }}>
            <div style={{ ...GL.sectionHeader, marginBottom: 0 }}>
              Audience Filter
              {isFiltered && (
                <span style={{ marginLeft: 10, fontWeight: 400, color: '#b08080', textTransform: 'none', fontSize: 12 }}>
                  · {activeFilters.length} active · <b style={{ color: '#ab1f10' }}>{filteredUsers.length}</b> of {tokenUsers.length} match
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {isFiltered && (
                <button onClick={() => setActiveFilters([])} style={{ background: 'none', border: 'none', fontSize: 13, color: '#ab1f10', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                  Clear all
                </button>
              )}
              {!stepsData ? (
                <button
                  className="th-btn-outline"
                  style={{ ...GL.btnOutline, padding: '8px 16px', fontSize: 13, opacity: (loadingSteps || loadingUsers || tokenUsers.length === 0) ? 0.55 : 1 }}
                  onClick={loadStepsData}
                  disabled={loadingSteps || loadingUsers || tokenUsers.length === 0}
                >
                  {loadingSteps ? `Loading steps…` : 'Load step data'}
                </button>
              ) : (
                <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 20, padding: '4px 12px' }}>
                  ✓ Steps loaded
                </span>
              )}
            </div>
          </div>

          {!stepsData && (
            <p style={{ fontSize: 13, color: '#9b4a42', marginTop: 10, marginBottom: 0 }}>
              Click "Load step data" to enable filtering by behaviour — fetches each user's steps from S3.
            </p>
          )}

          {stepsData && (
            <div style={{ marginTop: 4 }}>
              {FILTER_GROUPS.map(group => (
                <div key={group} style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#b08080', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>{group}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {FILTERS.filter(f => f.group === group).map(f => (
                      <FilterChip
                        key={f.id}
                        filter={f}
                        active={activeFilters.includes(f.id)}
                        count={filterCounts[f.id] ?? null}
                        onClick={() => toggleFilter(f.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {isFiltered && (
                <div style={{ marginTop: 18, background: 'rgba(171,31,16,0.04)', border: '1.5px solid rgba(171,31,16,0.1)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#7b241c', lineHeight: 1.6 }}>
                  <b>{filteredUsers.length}</b> user{filteredUsers.length !== 1 ? 's' : ''} match all filters:&nbsp;
                  <span style={{ fontStyle: 'italic' }}>{activeFilters.map(id => FILTERS.find(f => f.id === id)?.label).join(' AND ')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Compose ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div style={{ ...GL.sectionHeader }}>Compose Notification</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div>
              <label style={GL.label}>Navigate to Tab</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setTargetTab(prev => prev === tab.id ? '' : tab.id)}
                    style={{
                      background: targetTab === tab.id ? 'rgba(171,31,16,0.1)' : 'rgba(255,255,255,0.65)',
                      border: targetTab === tab.id ? '1.5px solid rgba(171,31,16,0.45)' : '1.5px solid rgba(171,31,16,0.12)',
                      borderRadius: 22,
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: targetTab === tab.id ? 700 : 500,
                      color: targetTab === tab.id ? '#ab1f10' : '#7b241c',
                      cursor: 'pointer',
                      fontFamily: "'Inter', sans-serif",
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>
              {targetTab && (
                <div style={{ fontSize: 12, color: '#9b4a42', marginTop: 8 }}>
                  Tapping the notification will open the <b>{targetTab}</b> tab.
                  {!targetTab && ' No tab selected — app will open to default screen.'}
                </div>
              )}
            </div>

            <div>
              <label style={GL.label}>Title</label>
              <input className="th-input" style={GL.input} placeholder="e.g. New shades just dropped ✨" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} />
              <div style={{ fontSize: 12, color: '#b08080', marginTop: 5, textAlign: 'right' }}>{title.length}/80</div>
            </div>

            <div>
              <label style={GL.label}>Message</label>
              <textarea className="th-input" style={{ ...GL.input, resize: 'vertical', minHeight: 100, lineHeight: 1.6 }} placeholder="e.g. Check out the latest lip shades from NARS — available now on TrueHue." value={body} onChange={e => setBody(e.target.value)} maxLength={256} />
              <div style={{ fontSize: 12, color: '#b08080', marginTop: 5, textAlign: 'right' }}>{body.length}/256</div>
            </div>

            {(title || body) && (
              <div style={{ background: 'rgba(171,31,16,0.04)', border: '1.5px solid rgba(171,31,16,0.1)', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontSize: 28, flexShrink: 0 }}>🔔</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a0a09', marginBottom: 3 }}>{title.replace(/\$name\$/gi, '[Name]') || <span style={{ color: '#b08080', fontStyle: 'italic' }}>No title</span>}</div>
                  <div style={{ fontSize: 13, color: '#7b241c', lineHeight: 1.5 }}>{body.replace(/\$name\$/gi, '[Name]') || <span style={{ color: '#b08080', fontStyle: 'italic' }}>No message</span>}</div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#9b4a42', fontWeight: 500 }}>
                {loadingUsers ? 'Loading recipients…' : isFiltered
                  ? <><b style={{ color: '#ab1f10' }}>{filteredUsers.length}</b> of {tokenUsers.length} users match filters</>
                  : <>{tokenUsers.length} recipient{tokenUsers.length !== 1 ? 's' : ''} with push tokens</>
                }
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="th-btn-outline" style={{ ...GL.btnOutline, opacity: sending ? 0.55 : 1, cursor: sending ? 'not-allowed' : 'pointer' }} onClick={sendTest} disabled={sending}>
                  🧪 Test (7383231612)
                </button>
                <button
                  className="th-btn-primary"
                  style={{ ...GL.btnPrimary, opacity: (sending || loadingUsers || filteredUsers.length === 0) ? 0.55 : 1, cursor: (sending || loadingUsers || filteredUsers.length === 0) ? 'not-allowed' : 'pointer' }}
                  onClick={sendToFiltered}
                  disabled={sending || loadingUsers || filteredUsers.length === 0}
                >
                  {sending
                    ? `Sending… (${sentCount + failedCount}/${filteredUsers.length})`
                    : isFiltered ? `Send to ${filteredUsers.length} filtered` : `Send to All (${filteredUsers.length})`
                  }
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recipients list ── */}
        <div style={{ ...GL.card, padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ ...GL.sectionHeader, marginBottom: 0 }}>
              {isFiltered ? 'Filtered Recipients' : 'All Recipients'}
              <span style={{ fontWeight: 400, color: '#b08080', marginLeft: 8 }}>({filteredUsers.length}{isFiltered && tokenUsers.length !== filteredUsers.length ? ` of ${tokenUsers.length}` : ''})</span>
            </div>
            {loadingUsers && <span style={{ fontSize: 13, color: '#9b4a42' }}>Loading…</span>}
          </div>

          {!loadingUsers && filteredUsers.length === 0 && (
            <div style={{ fontSize: 14, color: '#9b4a42', padding: '12px 0' }}>
              {isFiltered ? 'No users match the selected filters.' : 'No users with push tokens found.'}
            </div>
          )}

          {filteredUsers.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 110px 90px', gap: 14, padding: '0 14px', fontSize: 11, fontWeight: 700, color: '#9b4a42', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                <span>User</span><span>Token</span><span>Unique steps</span><span style={{ textAlign: 'right' }}>Status</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
                {filteredUsers.map((u) => {
                  const result = results.find(r => r.id === u.id);
                  const d = stepsData?.get(u.id);
                  return (
                    <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 110px 90px', gap: 14, alignItems: 'center', background: 'rgba(255,255,255,0.65)', borderRadius: 11, padding: '12px 14px', border: '1px solid rgba(171,31,16,0.06)' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a0a09' }}>{u.id}</span>
                      <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#7b241c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.token || <span style={{ color: '#c0b0b0', fontStyle: 'italic' }}>token not parsed</span>}
                      </span>
                      <span style={{ fontSize: 12, color: '#9b4a42' }}>{d ? `${d.stepSet.size} steps` : '—'}</span>
                      <div style={{ textAlign: 'right' }}>
                        {result ? <StatusPill status={result.status} /> : <span style={{ fontSize: 12, color: '#c0b0b0' }}>—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Send results summary ── */}
        {showResults && results.length > 0 && (
          <div style={{ ...GL.card, padding: 28 }}>
            <div style={{ ...GL.sectionHeader }}>Send Results</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: failedCount > 0 ? 20 : 0 }}>
              <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 12, padding: '14px 22px', flex: 1, minWidth: 120, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#15803d' }}>{sentCount}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sent</div>
              </div>
              <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 12, padding: '14px 22px', flex: 1, minWidth: 120, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#b91c1c' }}>{failedCount}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Failed</div>
              </div>
              {pendingCount > 0 && (
                <div style={{ background: 'rgba(171,31,16,0.04)', border: '1px solid rgba(171,31,16,0.12)', borderRadius: 12, padding: '14px 22px', flex: 1, minWidth: 120, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#7b241c' }}>{pendingCount}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#7b241c', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pending</div>
                </div>
              )}
            </div>
            {failedCount > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Failed Users</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {results.filter(r => r.status === 'failed').map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(220,38,38,0.05)', borderRadius: 10, padding: '10px 14px', border: '1px solid rgba(220,38,38,0.12)' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a0a09' }}>{r.id}</span>
                      <span style={{ fontSize: 12, color: '#b91c1c' }}>{r.detail || 'Unknown error'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}