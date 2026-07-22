'use client';

export default function StatBar({ label, value, max, color = '#ab1f10' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ width: 110, fontSize: 12.5, fontWeight: 600, color: '#6b4242', flexShrink: 0, textTransform: 'capitalize' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 10, background: 'rgba(171,31,16,0.08)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ width: 34, fontSize: 12.5, fontWeight: 700, color: '#ab1f10', textAlign: 'right', flexShrink: 0 }}>
        {value}
      </span>
    </div>
  );
}