'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const CARDS = {
  dhruvi: [
    {
      href: '/color-picker',
      label: 'Shade Capture',
      description: 'Pick & upload shades to S3, product database, and Shopify.',
      icon: '🎨',
    },
    {
      href: '/logs',
      label: 'Product Logs',
      description: 'Browse every saved product, view shades, links, and prices.',
      icon: '📦',
    },
    {
      href: '/audit',
      label: 'Audit',
      description: 'See which shades were added by which user on any date.',
      icon: '🔍',
    },
    {
      href: '/analytics',
      label: 'Analytics',
      description: 'User funnel, coin actions, premium products, and steps graph.',
      icon: '📊',
    },
  ],
  aastha: [
    {
      href: '/color-picker',
      label: 'Shade Capture',
      description: 'Pick & upload shades to S3, product database, and Shopify.',
      icon: '🎨',
    },
    {
      href: '/logs',
      label: 'Product Logs',
      description: 'Browse every saved product, view shades, links, and prices.',
      icon: '📦',
    },
  ],
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)th_auth=([^;]+)/);
    if (!m) {
      router.push('/login');
      return;
    }
    setUser(decodeURIComponent(m[1]));
  }, [router]);

  const logout = () => {
    document.cookie = 'th_auth=; Max-Age=0; Path=/; SameSite=Lax';
    localStorage.removeItem('th_user');
    router.push('/login');
  };

  if (!user) return null;

  const cards = CARDS[user] ?? CARDS.aastha;

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
          border-radius: 20px;
          padding: 32px 28px;
          text-align: left;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: 0 4px 24px rgba(171,31,16,0.07);
        }
        .dash-card:hover {
          transform: translateY(-6px) scale(1.015);
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
      <div style={{
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
        padding: '64px 32px 28px',
        textAlign: 'center',
        animation: 'fadeUp 0.4s ease both',
        position: 'relative',
        zIndex: 1,
      }}>
        <h1 style={{
          fontSize: 'clamp(28px, 4.5vw, 48px)',
          fontWeight: 700,
          color: '#1a0a09',
          margin: 0,
          lineHeight: 1.15,
          letterSpacing: '-0.5px',
        }}>
          Welcome back, {user} 👋
        </h1>
        <p style={{
          marginTop: 10,
          fontSize: 15,
          color: '#9b4a42',
          fontWeight: 400,
        }}>
          What would you like to work on today?
        </p>
      </div>

      {/* Cards grid */}
      <div style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '12px 24px 80px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 22,
        position: 'relative',
        zIndex: 1,
      }}>
        {cards.map((card, i) => (
          <button
            key={card.href}
            className="dash-card"
            onClick={() => router.push(card.href)}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <span style={{ fontSize: 34 }}>{card.icon}</span>

            <span style={{
              fontSize: 20,
              fontWeight: 700,
              color: '#ab1f10',
              lineHeight: 1.2,
              letterSpacing: '-0.3px',
            }}>
              {card.label}
            </span>

            <span style={{
              fontSize: 13.5,
              color: '#6b4242',
              lineHeight: 1.6,
              fontWeight: 400,
            }}>
              {card.description}
            </span>

            <span style={{
              marginTop: 6,
              fontSize: 13,
              fontWeight: 600,
              color: '#ab1f10',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              opacity: 0.85,
            }}>
              Open →
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}