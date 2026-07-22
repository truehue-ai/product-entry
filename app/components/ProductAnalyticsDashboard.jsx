'use client';

import { useEffect, useMemo, useState } from 'react';
import BrandSelect from './BrandSelect';
import StatBar from './StatBar';
import PieChart from './PieChart';
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
  const [source, setSource] = useState('all');
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

  const { brandTotal, perProduct } = useMemo(() => {
    if (!data) return { brandTotal: emptyBucket(), perProduct: {} };
    return aggregateBrand(data, source, dateRange);
  }, [data, source, dateRange]);

  const sectionBreakdown = useMemo(() => {
    if (!data) return {};
    return aggregateBySection(data, source, selectedProduct || undefined, dateRange);
  }, [data, source, selectedProduct, dateRange]);

  const dayTrend = useMemo(() => {
    if (!data || !selectedProduct) return {};
    return aggregateByDay(data, source, selectedProduct, dateRange);
  }, [data, source, selectedProduct, dateRange]);

  const productBucket = selectedProduct ? perProduct[selectedProduct] : null;
  const activeBucket = productBucket || brandTotal;

  const productRows = useMemo(() => {
    return Object.entries(perProduct)
      .map(([name, bucket]) => ({ name, bucket }))
      .sort((a, b) => b.bucket.searches - a.bucket.searches);
  }, [perProduct]);

  const maxSection = Math.max(1, ...Object.values(sectionBreakdown).map(b => b.searches));

  const shadeRows = useMemo(() => {
    if (!productBucket) return [];
    return Object.entries(productBucket.shades)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.selected - a.selected);
  }, [productBucket]);

  const dayRows = useMemo(() => {
    return Object.entries(dayTrend).sort((a, b) => a[0].localeCompare(b[0]));
  }, [dayTrend]);

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
            <option value="">All products ({productRows.length})</option>
            {productRows.map(({ name }) => (
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Searches</p>
              <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: '#ab1f10' }}>{activeBucket.searches}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9b4a42' }}>{activeBucket.search_users.length} unique users</p>
            </div>
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Buy Now Clicks</p>
              <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: '#ab1f10' }}>{activeBucket.buy_now}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9b4a42' }}>
                {activeBucket.searches > 0 ? Math.round((activeBucket.buy_now / activeBucket.searches) * 100) : 0}% of searches
              </p>
            </div>
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Retailer Redirects</p>
              <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: '#ab1f10' }}>{activeBucket.views}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9b4a42' }}>
                {activeBucket.buy_now > 0 ? Math.round((activeBucket.views / activeBucket.buy_now) * 100) : 0}% of buy-now clicks
              </p>
            </div>
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {selectedProduct ? 'Shades Tried' : 'Products Searched'}
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: '#ab1f10' }}>
                {selectedProduct ? Object.keys(activeBucket.shades).length : productRows.length}
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#4a2f2f' }}>Searches by Time of Day</h3>
              {['morning', 'afternoon', 'evening', 'night'].map(section => (
                <StatBar key={section} label={section} value={sectionBreakdown[section]?.searches || 0} max={maxSection} />
              ))}
            </div>

            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#4a2f2f' }}>Skin Tone</h3>
              <PieChart data={activeBucket.skintones} />
            </div>

            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#4a2f2f' }}>Undertone</h3>
              <PieChart data={activeBucket.undertones} />
            </div>
            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#4a2f2f' }}>Retailer Redirects</h3>
              <PieChart data={activeBucket.retailers} />
            </div>
          </div>

          {!selectedProduct ? (
            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#4a2f2f' }}>Products</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Product</th>
                      <th style={thStyle}>Searches</th>
                      <th style={thStyle}>Buy Now</th>
                      <th style={thStyle}>Views</th>
                      <th style={thStyle}>Unique Users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map(({ name, bucket }) => (
                      <tr
                        key={name}
                        onClick={() => setSelectedProduct(name)}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(171,31,16,0.04)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ ...tdStyle, fontWeight: 600, textTransform: 'capitalize' }}>{name.replace(/-/g, ' ')}</td>
                        <td style={tdStyle}>{bucket.searches}</td>
                        <td style={tdStyle}>{bucket.buy_now}</td>
                        <td style={tdStyle}>{bucket.views}</td>
                        <td style={tdStyle}>{bucket.search_users.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div style={cardStyle}>
                <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#4a2f2f' }}>
                  Shades — {selectedProduct.replace(/-/g, ' ')}
                </h3>
                {shadeRows.length === 0 && <p style={{ fontSize: 12.5, color: '#bbb' }}>No shade activity recorded yet</p>}
                {shadeRows.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Shade</th>
                          <th style={thStyle}>Selected</th>
                          <th style={thStyle}>Buy Now</th>
                          <th style={thStyle}>Views</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shadeRows.map(row => (
                          <tr key={row.name}>
                            <td style={{ ...tdStyle, fontWeight: 600, textTransform: 'capitalize' }}>{row.name.replace(/-/g, ' ')}</td>
                            <td style={tdStyle}>{row.selected}</td>
                            <td style={tdStyle}>{row.buy_now}</td>
                            <td style={tdStyle}>{row.views}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#4a2f2f' }}>Daily Trend</h3>
                {dayRows.length === 0 && <p style={{ fontSize: 12.5, color: '#bbb' }}>No day-level data yet</p>}
                {dayRows.map(([day, bucket]) => (
                  <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(171,31,16,0.05)' }}>
                    <span style={{ width: 100, fontSize: 12.5, fontWeight: 600, color: '#6b4242', flexShrink: 0 }}>{day}</span>
                    <span style={{ fontSize: 12.5, color: '#4a2f2f' }}>
                      {bucket.searches} searches · {bucket.buy_now} buy-now · {bucket.views} views
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}