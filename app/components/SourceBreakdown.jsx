'use client';

import { useMemo } from 'react';
import StatBar from './StatBar';
import PieChart from './PieChart';
import {
  aggregateBrand,
  aggregateBySection,
  aggregateByDay,
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

export default function SourceBreakdown({ data, sourceKey, label, dateRange, selectedProduct, onSelectProduct }) {
  const { brandTotal, perProduct } = useMemo(() => {
    return aggregateBrand(data, sourceKey, dateRange);
  }, [data, sourceKey, dateRange]);

  const sectionBreakdown = useMemo(() => {
    return aggregateBySection(data, sourceKey, selectedProduct || undefined, dateRange);
  }, [data, sourceKey, selectedProduct, dateRange]);

  const dayTrend = useMemo(() => {
    if (!selectedProduct) return {};
    return aggregateByDay(data, sourceKey, selectedProduct, dateRange);
  }, [data, sourceKey, selectedProduct, dateRange]);

  const productBucket = selectedProduct ? perProduct[selectedProduct] : null;
  const activeBucket = productBucket || brandTotal;
  const isDiscovery = sourceKey === 'discovery';
  const searchLabel = isDiscovery ? 'Discoveries' : 'Searches';
  const productsLabel = isDiscovery ? 'Products Discovered' : 'Products Searched';

  const productRows = useMemo(() => {
    return Object.entries(perProduct)
      .map(([name, bucket]) => ({ name, bucket }))
      .filter(({ bucket }) => bucket.searches > 0 || bucket.buy_now > 0 || bucket.views > 0)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#ab1f10' }}>{label}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{searchLabel}</p>
          <p style={{ margin: '6px 0 0', fontSize: 24, fontWeight: 800, color: '#ab1f10' }}>{activeBucket.searches}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9b4a42' }}>{activeBucket.search_users.length} unique users</p>
        </div>
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Buy Now</p>
          <p style={{ margin: '6px 0 0', fontSize: 24, fontWeight: 800, color: '#ab1f10' }}>{activeBucket.buy_now}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9b4a42' }}>
            {activeBucket.searches > 0 ? Math.round((activeBucket.buy_now / activeBucket.searches) * 100) : 0}% of {searchLabel.toLowerCase()}
          </p>
        </div>
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Redirects</p>
          <p style={{ margin: '6px 0 0', fontSize: 24, fontWeight: 800, color: '#ab1f10' }}>{activeBucket.views}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9b4a42' }}>
            {activeBucket.buy_now > 0 ? Math.round((activeBucket.views / activeBucket.buy_now) * 100) : 0}% of buy-now clicks
          </p>
        </div>
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#9b4a42', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {selectedProduct ? 'Shades Tried' : productsLabel}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 24, fontWeight: 800, color: '#ab1f10' }}>
            {selectedProduct ? Object.keys(activeBucket.shades).length : productRows.length}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#4a2f2f' }}>Time of Day</h3>
          {['morning', 'afternoon', 'evening', 'night'].map(section => (
            <StatBar key={section} label={section} value={sectionBreakdown[section]?.searches || 0} max={maxSection} />
          ))}
        </div>
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#4a2f2f' }}>Skin Tone</h3>
          <PieChart data={activeBucket.skintones} />
        </div>
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#4a2f2f' }}>Undertone</h3>
          <PieChart data={activeBucket.undertones} />
        </div>
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#4a2f2f' }}>Retailer Redirects</h3>
          <PieChart data={activeBucket.retailers} />
        </div>
      </div>

      {!selectedProduct ? (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#4a2f2f' }}>{productsLabel}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Product</th>
                  <th style={thStyle}>Searches</th>
                  <th style={thStyle}>Buy Now</th>
                  <th style={thStyle}>Redirects</th>
                  <th style={thStyle}>Users</th>
                </tr>
              </thead>
              <tbody>
                {productRows.map(({ name, bucket }) => (
                  <tr
                    key={name}
                    onClick={() => onSelectProduct(name)}
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
            <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#4a2f2f' }}>Shades</h3>
            {shadeRows.length === 0 && <p style={{ fontSize: 12, color: '#bbb' }}>No shade activity recorded yet</p>}
            {shadeRows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Shade</th>
                      <th style={thStyle}>Selected</th>
                      <th style={thStyle}>Buy Now</th>
                      <th style={thStyle}>Redirects</th>
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
            <p style={{ margin: '10px 0 0', fontSize: 11, color: '#9b4a42' }}>
              Note: Skin Tone / Undertone charts above count every search for this product. Not every search leads to shade activity, so those totals can be higher than what's reflected in the Shades table.
            </p>
          </div>

          <div style={cardStyle}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#4a2f2f' }}>Daily Trend</h3>
            {dayRows.length === 0 && <p style={{ fontSize: 12, color: '#bbb' }}>No day-level data yet</p>}
            {dayRows.map(([day, bucket]) => (
              <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0', borderBottom: '1px solid rgba(171,31,16,0.05)' }}>
                <span style={{ width: 92, fontSize: 12, fontWeight: 600, color: '#6b4242', flexShrink: 0 }}>{day}</span>
                <span style={{ fontSize: 12, color: '#4a2f2f' }}>
                  {bucket.searches} searches · {bucket.buy_now} buy-now · {bucket.views} redirects
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}