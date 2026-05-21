'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORY_COLORS = {
  festival:  { bg: 'rgba(255,180,100,0.18)', text: '#b85c00' },
  trend:     { bg: 'rgba(171,31,16,0.12)',   text: '#ab1f10' },
  seasonal:  { bg: 'rgba(100,160,255,0.15)', text: '#1a4fa0' },
  everyday:  { bg: 'rgba(100,200,140,0.15)', text: '#1a7a4a' },
};

export default function ArticlesPage() {
  const router = useRouter();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    fetchFeed();
  }, []);

  async function fetchFeed() {
    try {
      const res = await fetch('/api/magazine', { cache: 'no-store' });
      const data = await res.json();
      setArticles(data.articles || []);
    } catch (e) {
      setError('Failed to load articles');
    } finally {
      setLoading(false);
    }
  }

  function getToken() {
    const m = document.cookie.match(/(?:^|;\s*)th_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function deleteArticle(id) {
    if (!confirm(`Delete article "${id}"? This cannot be undone.`)) return;
    await fetch(`/api/magazine/article/${id}`, { method: 'DELETE' });
    setArticles(prev => prev.filter(a => a.id !== id));
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)',
      fontFamily: "'Inter', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }

        .blob { position: absolute; border-radius: 50%; filter: blur(90px); opacity: 0.35; pointer-events: none; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .article-row {
          animation: fadeUp 0.4s ease both;
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1.5px solid rgba(255,255,255,0.85);
          border-radius: 16px;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          transition: box-shadow 0.2s ease, transform 0.2s ease;
        }
        .article-row:hover {
          box-shadow: 0 12px 32px rgba(171,31,16,0.1);
          transform: translateY(-2px);
        }

        .btn-primary {
          background: #ab1f10;
          color: white;
          border: none;
          border-radius: 10px;
          padding: 10px 22px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.16s, transform 0.16s;
          letter-spacing: -0.2px;
        }
        .btn-primary:hover { background: #8e1a0d; transform: translateY(-1px); }

        .btn-ghost {
          background: transparent;
          border: 1.5px solid rgba(171,31,16,0.3);
          color: #ab1f10;
          border-radius: 8px;
          padding: 7px 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.16s;
        }
        .btn-ghost:hover { background: rgba(171,31,16,0.07); border-color: #ab1f10; }

        .btn-danger {
          background: transparent;
          border: 1.5px solid rgba(200,40,40,0.25);
          color: #c02020;
          border-radius: 8px;
          padding: 7px 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.16s;
        }
        .btn-danger:hover { background: rgba(200,40,40,0.07); border-color: #c02020; }

        .pill {
          border-radius: 20px;
          padding: 3px 11px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .back-btn {
          background: transparent;
          border: none;
          color: #ab1f10;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0;
          opacity: 0.8;
          transition: opacity 0.15s;
        }
        .back-btn:hover { opacity: 1; }
      `}</style>

      {/* Blobs */}
      <div className="blob" style={{ width: 480, height: 480, background: '#f5b7b1', top: -140, left: -120 }} />
      <div className="blob" style={{ width: 340, height: 340, background: '#fadbd8', bottom: -80, right: -60 }} />

      {/* Top bar */}
      <div style={{
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        background: 'rgba(255,255,255,0.6)',
        borderBottom: '1px solid rgba(255,255,255,0.75)',
        padding: '14px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
        boxShadow: '0 1px 12px rgba(171,31,16,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="back-btn" onClick={() => router.push('/')}>← Dashboard</button>
          <span style={{ color: 'rgba(171,31,16,0.3)', fontSize: 16 }}>|</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#ab1f10', letterSpacing: '-0.3px' }}>
            The Edit — Articles
          </span>
        </div>
        <button className="btn-primary" onClick={() => router.push('/articles/new')}>
          + New Article
        </button>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px', position: 'relative', zIndex: 1 }}>

        {/* Stats row */}
        {!loading && !error && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
            {[
              { label: 'Total Articles', value: articles.length },
              { label: 'Premium', value: articles.filter(a => a.is_premium).length },
              { label: 'Free', value: articles.filter(a => !a.is_premium).length },
              { label: 'Article of the Day', value: articles.filter(a => a.is_article_of_the_day).length },
            ].map((stat, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.55)',
                backdropFilter: 'blur(16px)',
                border: '1.5px solid rgba(255,255,255,0.8)',
                borderRadius: 14,
                padding: '16px 22px',
                minWidth: 130,
                animation: `fadeUp 0.4s ease ${i * 60}ms both`,
              }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#ab1f10', letterSpacing: '-0.5px' }}>{stat.value}</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#9b4a42', marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#9b4a42', fontSize: 15 }}>
            Loading articles…
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#c02020', fontSize: 15 }}>
            {error}
          </div>
        )}

        {!loading && !error && articles.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '80px 0',
            background: 'rgba(255,255,255,0.5)',
            borderRadius: 20,
            border: '1.5px solid rgba(255,255,255,0.8)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✨</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1a0a09', marginBottom: 8 }}>No articles yet</div>
            <div style={{ fontSize: 14, color: '#9b4a42', marginBottom: 24 }}>Create your first personalised beauty editorial</div>
            <button className="btn-primary" onClick={() => router.push('/articles/new')}>
              + Create First Article
            </button>
          </div>
        )}

        {/* Article rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {articles.map((article, i) => {
            const catStyle = CATEGORY_COLORS[article.category] || CATEGORY_COLORS.trend;
            return (
              <div
                key={article.id}
                className="article-row"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {/* Left: info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span className="pill" style={{ background: catStyle.bg, color: catStyle.text }}>
                      {article.category}
                    </span>
                    {article.is_premium && (
                      <span className="pill" style={{ background: 'rgba(201,168,76,0.18)', color: '#8a6a00' }}>
                        ✦ Premium
                      </span>
                    )}
                    {article.is_article_of_the_day && (
                      <span className="pill" style={{ background: 'rgba(171,31,16,0.12)', color: '#ab1f10' }}>
                        ★ Today
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#1a0a09', letterSpacing: '-0.2px', marginBottom: 3 }}>
                    {article.title}
                  </div>
                  <div style={{ fontSize: 12, color: '#9b4a42', fontWeight: 400 }}>
                    {article.id} · {article.publish_date || '—'}
                  </div>
                </div>

                {/* Right: actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    className="btn-ghost"
                    onClick={() => router.push(`/articles/${article.id}/edit`)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => router.push(`/articles/${article.id}/edit?tab=preview`)}
                    >
                    Preview
                    </button>
                  <button
                    className="btn-danger"
                    onClick={() => deleteArticle(article.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}