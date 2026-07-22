'use client';

import { useEffect, useState } from 'react';

export default function BrandSelect({ value, onChange }) {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('https://api.th-fargate.in/get_product_analytics_brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(data => setBrands(data?.brands || []))
      .catch(() => setBrands([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '10px 14px',
        borderRadius: 12,
        border: '1.5px solid rgba(171,31,16,0.2)',
        background: '#fff',
        color: '#4a2f2f',
        fontSize: 14,
        fontWeight: 600,
        minWidth: 220,
        cursor: 'pointer',
      }}
    >
      <option value="">{loading ? 'Loading brands…' : 'Select a brand'}</option>
      {brands.map(b => (
        <option key={b} value={b}>{b.replace(/-/g, ' ')}</option>
      ))}
    </select>
  );
}