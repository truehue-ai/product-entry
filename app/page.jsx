'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout as logoutSession } from './components/currentUser';

// Home: tools grouped into categories. `users` = who sees the tool; `forUser` swaps the label / description per user.
const ALL = ['dhruvi'];
const CATEGORIES = [
  {
    key: 'products',
    label: 'Product Database',
    icon: '🗄️',
    sub: 'Add, check and track products',
    tools: [
      { href: '/shade-capture', label: 'Shade Capture', icon: '🎨', users: ['dhruvi', 'aastha'],
        description: 'To-do queue and capture for India & USA: pick shades, save, make live.' },
      { href: '/logs', label: 'Product Logs', icon: '📦', users: ['dhruvi', 'aastha'],
        description: 'Every saved product by brand: shades, links, prices.' },
      { href: '/activity', label: 'Activity', icon: '🗓️', users: ['dhruvi', 'aastha'],
        description: "Aastha's products per day, monthly average and pay.",
        forUser: { aastha: { label: 'My Activity', description: 'Your products per day, monthly average and pay.' } } },
      { href: '/audit', label: 'Audit', icon: '🔍', users: ALL,
        description: 'Which shades were added by whom, on any date.' },
    ],
  },
  {
    key: 'ads',
    label: 'Ads & Marketing',
    icon: '📣',
    sub: 'Paid ads, buyers and content planning',
    tools: [
      { href: '/meta-ads', label: 'Meta Ads', icon: '📣', users: ['dhruvi', 'riddhi', 'jagat'],
        description: "Today's actions, spend, revenue and ROAS vs target." },
      { href: '/meta-ads/persona', label: 'Meta Persona', icon: '🧑‍🤝‍🧑', users: ALL,
        description: 'Who buys from our ads, vs our Instagram followers.' },
      { href: '/marketing', label: 'Marketing Organiser', icon: '🎬', users: ALL,
        description: 'Weekly Instagram and ad plan, ad quota and Inspo library.' },
      { href: '/ads-platform-metrics', label: 'Ads Platform Metrics', icon: '🎯', users: ['dhruvi', 'jagat'],
        description: 'Is the community ready to sell ad placements to brands.' },
    ],
  },
  {
    key: 'analytics',
    label: 'App Analytics',
    icon: '📊',
    sub: 'How people use the app',
    tools: [
      { href: '/analytics/usage', label: 'User Metrics', icon: '📈', users: ['dhruvi', 'jagat'],
        description: 'Daily / weekly / monthly actives, retention, premium users.' },
      { href: '/analytics', label: 'Analytics', icon: '📊', users: ['dhruvi', 'jagat'],
        description: 'User funnel, coin actions, premium products, steps graph.' },
      { href: '/product-analytics', label: 'Product Analytics', icon: '🧴', users: ['dhruvi', 'jagat'],
        description: 'Brand & product search demand, buy-now clicks, skintones.' },
    ],
  },
  {
    key: 'app',
    label: 'In the App',
    icon: '✨',
    sub: 'What users see and receive',
    tools: [
      { href: '/articles', label: 'The Edit', icon: '✨', users: ALL,
        description: 'Create and preview personalised beauty articles.' },
      { href: '/notifications', label: 'Notifications', icon: '🔔', users: ALL,
        description: 'Send push notifications to all users.' },
    ],
  },
];

// categories with only the tools this user can open (empty ones are hidden)
const categoriesFor = (user) => CATEGORIES
  .map((c) => ({ ...c, tools: c.tools.filter((t) => t.users.includes(user)).map((t) => ({ ...t, ...(t.forUser?.[user] || {}) })) }))
  .filter((c) => c.tools.length);

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_user=([^;]+)/);
    if (!m) {
      router.push('/login');
      return;
    }
    setUser(decodeURIComponent(m[1]));
  }, [router]);

  // the session cookie is HttpOnly — the server clears it
  const logout = () => logoutSession();

  if (!user) return null;

  const categories = categoriesFor(user);

  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)',
      fontFamily: "'Inter', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      <style>{`
        * { font-family: 'Inter', sans-serif !important; }

        .blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(90px);
          opacity: 0.4;
          pointer-events: none;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .dash-card {
          animation: fadeUp 0.5s ease both;
          transition: transform 0.22s ease, box-shadow 0.22s ease;
          cursor: pointer;
          background: rgba(255,255,255,0.55);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1.5px solid rgba(255,255,255,0.8);
          border-radius: 16px;
          padding: 18px 18px;
          text-align: left;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: 0 4px 24px rgba(171,31,16,0.07);
        }
        .dash-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 24px 48px rgba(171,31,16,0.16);
          background: rgba(255,255,255,0.72);
        }

        .logout-btn {
          font-size: 13px;
          font-weight: 600;
          color: #ab1f10;
          background: transparent;
          border: 1.5px solid rgba(171,31,16,0.35);
          border-radius: 8px;
          padding: 7px 18px;
          cursor: pointer;
          transition: background 0.16s, border-color 0.16s;
        }
        .logout-btn:hover {
          background: rgba(171,31,16,0.07);
          border-color: #ab1f10;
        }
      `}</style>

      {/* Background blobs */}
      <div className="blob" style={{ width: 500, height: 500, background: '#f5b7b1', top: '-160px', left: '-140px' }} />
      <div className="blob" style={{ width: 380, height: 380, background: '#fadbd8', bottom: '-100px', right: '-80px' }} />
      <div className="blob" style={{ width: 220, height: 220, background: '#e74c3c', top: '40%', right: '15%', opacity: 0.12 }} />

      {/* Top bar */}
      <div className="m-topbar" style={{
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        background: 'rgba(255,255,255,0.6)',
        borderBottom: '1px solid rgba(255,255,255,0.75)',
        padding: '14px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 1px 12px rgba(171,31,16,0.06)',
      }}>
        <span style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#ab1f10',
          letterSpacing: '-0.4px',
        }}>
          TrueHue
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#7b241c',
            background: 'rgba(171,31,16,0.08)',
            padding: '5px 13px',
            borderRadius: 20,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}>
            {user}
          </span>
          <button className="logout-btn" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      {/* Hero */}
      <div style={{
        padding: '48px 32px 24px',
        textAlign: 'center',
        animation: 'fadeUp 0.4s ease both',
        position: 'relative',
        zIndex: 1,
      }}>
        <h1 style={{
          fontSize: 'clamp(28px, 4.5vw, 44px)',
          fontWeight: 700,
          color: '#1a0a09',
          margin: 0,
          lineHeight: 1.15,
          letterSpacing: '-0.5px',
        }}>
          Welcome back, {user} 👋
        </h1>
        <p style={{ marginTop: 10, fontSize: 15, color: '#9b4a42', fontWeight: 400 }}>
          What would you like to work on today?
        </p>
      </div>

      {/* Today's to-do from Google Calendar — dhruvi only */}
      {user === 'dhruvi' && <TodayTodo />}

      {/* Categories */}
      <div style={{
        maxWidth: 1040,
        margin: '0 auto',
        padding: '8px 24px 80px',
        display: 'flex',
        flexDirection: 'column',
        gap: 30,
        position: 'relative',
        zIndex: 1,
      }}>
        {categories.map((cat, ci) => (
          <section key={cat.key} style={{ animation: 'fadeUp 0.45s ease both', animationDelay: `${ci * 70}ms` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 4px 12px', borderBottom: '1px solid rgba(171,31,16,0.12)', paddingBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#7b241c', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {cat.icon} {cat.label}
              </span>
              <span style={{ fontSize: 12.5, color: '#9b8b88' }}>{cat.sub}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
              {cat.tools.map((tool) => (
                <button key={tool.href} className="dash-card" onClick={() => router.push(tool.href)}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24, lineHeight: 1 }}>{tool.icon}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#ab1f10', letterSpacing: '-0.2px' }}>{tool.label}</span>
                  </span>
                  <span style={{ fontSize: 13, color: '#6b4242', lineHeight: 1.5 }}>{tool.description}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
// ── Today's to-do (dhruvi only): today's events from her Google Calendar, as a checklist ──
const nowIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 16);
const fmt12 = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

function TodayTodo() {
  const [data, setData] = useState(null);
  const [done, setDone] = useState({});
  const [now, setNow] = useState(nowIst());

  useEffect(() => {
    fetch(`/api/calendar/today?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setData(j))
      .catch(() => setData({ error: "Couldn't load today's to-do" }));
    const t = setInterval(() => setNow(nowIst()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ticks are a per-browser convenience, kept per day
  const storeKey = data?.day ? `todo-done-${data.day}` : null;
  useEffect(() => {
    if (!storeKey) return;
    try { setDone(JSON.parse(localStorage.getItem(storeKey) || '{}')); } catch { setDone({}); }
  }, [storeKey]);
  const toggle = (id) => setDone((p) => {
    const next = { ...p, [id]: !p[id] };
    try { if (storeKey) localStorage.setItem(storeKey, JSON.stringify(next)); } catch {}
    return next;
  });

  const events = data?.events || [];
  const finished = events.filter((e) => done[e.id]).length;
  const dayLabel = data?.day
    ? new Date(`${data.day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    : '';

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 24px 22px', position: 'relative', zIndex: 1, animation: 'fadeUp 0.4s ease both' }}>
      <div style={{
        background: 'rgba(255,255,255,0.62)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1.5px solid rgba(255,255,255,0.85)', borderRadius: 18, boxShadow: '0 4px 24px rgba(171,31,16,0.08)', padding: '16px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#7b241c', letterSpacing: '0.08em', textTransform: 'uppercase' }}>✅ Today's to-do</span>
          <span style={{ fontSize: 12.5, color: '#9b8b88' }}>{dayLabel}{events.length ? ` · ${finished} of ${events.length} done` : ''}</span>
          <a href="https://calendar.google.com/calendar/r/day" target="_blank" rel="noreferrer"
            style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, color: '#ab1f10', textDecoration: 'none' }}>Edit in Google Calendar ↗</a>
        </div>

        {!data ? <div style={{ fontSize: 13, color: '#9b8b88' }}>Loading…</div>
          : data.configured === false ? (
            <div style={{ fontSize: 13, color: '#6b4242', lineHeight: 1.6 }}>
              Connect your calendar: Google Calendar → Settings → your calendar → <b>Integrate calendar</b> → copy
              <b> Secret address in iCal format</b>, and add it to the app's environment as <code>GOOGLE_CALENDAR_ICS_URL</code>.
            </div>
          ) : data.error && !events.length ? <div style={{ fontSize: 13, color: '#c0392b' }}>{data.error}</div>
          : !events.length ? <div style={{ fontSize: 13, color: '#9b8b88' }}>Nothing on your calendar today.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {events.map((e) => {
                const isNow = !e.allDay && e.start <= now && (!e.end || now < e.end);
                const past = !e.allDay && e.end && e.end <= now;
                return (
                  <label key={e.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                    background: isNow ? 'rgba(171,31,16,0.08)' : 'transparent', opacity: done[e.id] ? 0.45 : past ? 0.7 : 1,
                  }}>
                    <input type="checkbox" checked={!!done[e.id]} onChange={() => toggle(e.id)} style={{ width: 16, height: 16, accentColor: '#ab1f10' }} />
                    <span style={{ minWidth: 128, fontSize: 13, color: '#7b6b6b', fontVariantNumeric: 'tabular-nums' }}>
                      {e.allDay ? 'All day' : `${fmt12(e.start)}${e.end ? ` – ${fmt12(e.end)}` : ''}`}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#1a0a09', textDecoration: done[e.id] ? 'line-through' : 'none' }}>{e.title}</span>
                    {isNow && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#fff', background: '#ab1f10', borderRadius: 999, padding: '2px 9px' }}>NOW</span>}
                  </label>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
