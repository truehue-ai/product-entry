'use client';

import ProductAnalyticsDashboard from '../components/ProductAnalyticsDashboard';

export default function ProductAnalyticsPage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)',
      fontFamily: "'Inter', sans-serif",
      padding: '32px',
    }}>
      <h1 style={{
        fontSize: 26,
        fontWeight: 700,
        color: '#ab1f10',
        margin: '0 0 22px',
        letterSpacing: '-0.4px',
      }}>
        Product Search Analytics
      </h1>
      <ProductAnalyticsDashboard />
    </main>
  );
}