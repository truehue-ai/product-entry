'use client';

import { useEffect, useMemo, useState } from 'react';
import BrandSelect from './BrandSelect';
import StatBar from './StatBar';
import PieChart from './PieChart';
import SourceBreakdown from './SourceBreakdown';
import {
  aggregateBrand,
  aggregateBySection,
  aggregateByDay,
  emptyBucket,
} from './ProductAnalyticsUtils';

const cardStyle = {
  background: 'rgba(255,255,255,0.65)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1.5px solid rgba(255,255,255,0.85)',
  borderRadius: 18,
  padding: '20px 22px',
  boxShadow: '0 4px 20px rgba(171,31,16,0.06)',
};

const pillBase = {
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 14px',
  borderRadius: 999,
  border: '1.5px solid rgba(171,31,16,0.25)',
  cursor: 'pointer',
  background: 'transparent',
  color: '#ab1f10',
};

const thStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11.5,
  fontWeight: 700,
  color: '#9b4a42',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid rgba(171,31,16,0.1)',
};

const tdStyle = {
  padding: '10px 10px',
  fontSize: 13,
  color: '#4a2f2f',
  borderBottom: '1px solid rgba(171,31,16,0.06)',
};

export default function ProductAnalyticsDashboard() {
  const [brand, setBrand] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!brand) { setData(null); setSelectedProduct(''); return; }
    setLoading(true);
    setSelectedProduct('');
    fetch('https://api.th-fargate.in/get_product_analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand }),
    })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [brand]);

  const dateRange = useMemo(() => ({ start: startDate || null, end: endDate || null }), [startDate, endDate]);

  const productNames = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.products || {}).sort();
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
        <BrandSelect value={brand} onChange={setBrand} />

        {data && (
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            style={{
              padding: '10px 14px', borderRadius: 12, border: '1.5px solid rgba(171,31,16,0.2)',
              background: '#fff', color: '#4a2f2f', fontSize: 14, fontWeight: 600, minWidth: 220, cursor: 'pointer',
            }}
          >
            <option value="">All products ({productNames.length})</option>
            {productNames.map((name) => (
              <option key={name} value={name}>{name.replace(/-/g, ' ')}</option>
            ))}
          </select>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              padding: '9px 10px', borderRadius: 10, border: '1.5px solid rgba(171,31,16,0.2)',
              background: '#fff', color: '#4a2f2f', fontSize: 13, fontFamily: 'inherit',
            }}
          />
          <span style={{ fontSize: 13, color: '#9b4a42' }}>to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              padding: '9px 10px', borderRadius: 10, border: '1.5px solid rgba(171,31,16,0.2)',
              background: '#fff', color: '#4a2f2f', fontSize: 13, fontFamily: 'inherit',
            }}
          />
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); }}
              style={{ ...pillBase, padding: '6px 12px' }}
            >
              Clear dates
            </button>
          )}
        </div>
      </div>

      {!brand && (
        <div style={{ ...cardStyle, textAlign: 'center', color: '#9b4a42', fontSize: 14 }}>
          Pick a brand above to see search, buy-now, and redirect activity.
        </div>
      )}

      {brand && loading && (
        <div style={{ ...cardStyle, textAlign: 'center', color: '#9b4a42', fontSize: 14 }}>
          Loading analytics for {brand.replace(/-/g, ' ')}…
        </div>
      )}

      {brand && !loading && data && Object.keys(data.products || {}).length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: '#9b4a42', fontSize: 14 }}>
          No analytics recorded yet for {brand.replace(/-/g, ' ')}.
        </div>
      )}

      {data && Object.keys(data.products || {}).length > 0 && (
        <>
          {selectedProduct && (
            <button onClick={() => setSelectedProduct('')} style={{ alignSelf: 'flex-start', ...pillBase }}>
              ← All products
            </button>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 20 }}>
            <SourceBreakdown
              data={data}
              sourceKey="user_search"
              label="User Search"
              dateRange={dateRange}
              selectedProduct={selectedProduct}
              onSelectProduct={setSelectedProduct}
            />
            <SourceBreakdown
              data={data}
              sourceKey="discovery"
              label="Discovery"
              dateRange={dateRange}
              selectedProduct={selectedProduct}
              onSelectProduct={setSelectedProduct}
            />
          </div>
        </>
      )}
    </div>
  );
}