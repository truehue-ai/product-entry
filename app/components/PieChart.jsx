'use client';

const PALETTE = ['#ab1f10', '#c4713a', '#d4a24a', '#8b5a3c', '#6b3018', '#c0392b', '#a8724a', '#7b4b2a'];

export default function PieChart({ data, size = 160 }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  if (total === 0) {
    return <p style={{ fontSize: 12.5, color: '#bbb' }}>No data yet</p>;
  }

  const radius = size / 2;
  const center = radius;
  let cumulative = 0;

  const slices = entries.map(([label, value], i) => {
    const fraction = value / total;
    const startAngle = cumulative * 2 * Math.PI;
    cumulative += fraction;
    const endAngle = cumulative * 2 * Math.PI;

    const x1 = center + radius * Math.sin(startAngle);
    const y1 = center - radius * Math.cos(startAngle);
    const x2 = center + radius * Math.sin(endAngle);
    const y2 = center - radius * Math.cos(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;

    // Single-slice (100%) case needs a full circle, not a degenerate arc
    const path = fraction >= 0.999
      ? `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center - 0.001} ${center - radius} Z`
      : `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return { label, value, path, color: PALETTE[i % PALETTE.length], pct: Math.round(fraction * 100) };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {slices.map((s) => (
          <path key={s.label} d={s.path} fill={s.color} stroke="#fff" strokeWidth={1.5} />
        ))}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {slices.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: '#4a2f2f', textTransform: 'capitalize' }}>{s.label}</span>
            <span style={{ color: '#9b4a42' }}>{s.value} ({s.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}