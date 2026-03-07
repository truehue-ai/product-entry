'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const USERS = {
  aastha: 'aastha-truehue',
  dhruvi: 'dhruvi-truehue',
} as const;

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState<'aastha' | 'dhruvi' | ''>('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [showPw, setShowPw] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!user) return setErr('Pick a user');
    if (password !== USERS[user]) return setErr('Invalid password');

    document.cookie = `th_auth=${user}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax`;
    localStorage.setItem('th_user', user);
    router.push('/');
  };

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)',
      fontFamily: "'Inter', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      <style>{`
        * { font-family: 'Inter', sans-serif !important; }

        /* Blurred background blobs */
        .blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.45;
          pointer-events: none;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .login-card {
          animation: fadeUp 0.5s ease both;
        }

        .field-input {
          width: 100%;
          padding: 13px 16px;
          border-radius: 12px;
          border: 1.5px solid rgba(171,31,16,0.18);
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(8px);
          font-size: 14px;
          font-weight: 500;
          color: #1a0a09;
          outline: none;
          transition: border-color 0.18s, box-shadow 0.18s;
          appearance: none;
          box-sizing: border-box;
        }
        .field-input:focus {
          border-color: #ab1f10;
          box-shadow: 0 0 0 3px rgba(171,31,16,0.1);
          background: rgba(255,255,255,0.85);
        }
        .field-input::placeholder { color: #b89490; }

        .submit-btn {
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: none;
          background: linear-gradient(135deg, #c0392b 0%, #ab1f10 100%);
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          transition: opacity 0.18s, transform 0.18s, box-shadow 0.18s;
          box-shadow: 0 6px 24px rgba(171,31,16,0.28);
        }
        .submit-btn:hover {
          opacity: 0.93;
          transform: translateY(-1px);
          box-shadow: 0 10px 32px rgba(171,31,16,0.35);
        }
        .submit-btn:active {
          transform: translateY(0);
        }

        .pw-wrap { position: relative; }
        .pw-toggle {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #9b4a42;
          font-size: 13px;
          font-weight: 500;
          padding: 0;
        }
      `}</style>

      {/* Background blobs */}
      <div className="blob" style={{ width: 420, height: 420, background: '#f5b7b1', top: '-120px', left: '-100px' }} />
      <div className="blob" style={{ width: 320, height: 320, background: '#fadbd8', bottom: '-80px', right: '-60px' }} />
      <div className="blob" style={{ width: 200, height: 200, background: '#e74c3c', bottom: '20%', left: '10%', opacity: 0.15 }} />

      {/* Card */}
      <div className="login-card" style={{
        width: '100%',
        maxWidth: 420,
        background: 'rgba(255,255,255,0.55)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 24,
        border: '1.5px solid rgba(255,255,255,0.75)',
        boxShadow: '0 20px 60px rgba(171,31,16,0.12), 0 2px 8px rgba(171,31,16,0.06)',
        padding: '40px 36px',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* Logo mark */}
        <div style={{ marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #c0392b, #ab1f10)',
            boxShadow: '0 4px 14px rgba(171,31,16,0.3)',
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 20 }}>✦</span>
          </div>
          <h1 style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            color: '#1a0a09',
            letterSpacing: '-0.5px',
            lineHeight: 1.2,
          }}>
            TrueHue
          </h1>
          <p style={{
            margin: '6px 0 0',
            fontSize: 13,
            color: '#9b4a42',
            fontWeight: 400,
          }}>
            Internal tools — sign in to continue
          </p>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* User select */}
          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: '#7b241c',
              marginBottom: 7,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              User
            </label>
            <div style={{ position: 'relative' }}>
              <select
                className="field-input"
                value={user}
                onChange={(e) => setUser(e.target.value as any)}
                style={{ paddingRight: 36, cursor: 'pointer' }}
              >
                <option value="">Select user…</option>
                <option value="aastha">aastha</option>
                <option value="dhruvi">dhruvi</option>
              </select>
              {/* custom chevron */}
              <span style={{
                position: 'absolute', right: 14, top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none', color: '#ab1f10', fontSize: 12,
              }}>▾</span>
            </div>
          </div>

          {/* Password */}
          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: '#7b241c',
              marginBottom: 7,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              Password
            </label>
            <div className="pw-wrap">
              <input
                type={showPw ? 'text' : 'password'}
                className="field-input"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: 56 }}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw(v => !v)}
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Error */}
          {err && (
            <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: '#c0392b',
              background: 'rgba(192,57,43,0.08)',
              border: '1px solid rgba(192,57,43,0.2)',
              borderRadius: 8,
              padding: '10px 14px',
            }}>
              {err}
            </div>
          )}

          <button type="submit" className="submit-btn">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}