'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuditPage() {
  const router = useRouter();
  const [user, setUser] = useState('aastha'); // default to aastha as per your example
  const [date, setDate] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState([]);

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/audit/by-user?user=${encodeURIComponent(user)}&date=${encodeURIComponent(date)}`, { cache: 'no-store' });
      if (r.status === 403) {
        alert('Only dhruvi can view this page.');
        router.push('/');
        return;
      }
      const j = await r.json();
      setEntries(j.entries || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-pink-50 p-6">
      <div className="mx-auto max-w-5xl bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-[#ab1f10]">Audit — Shades Added</h1>
          <button
            className="px-4 py-2 bg-white text-[#ab1f10] border border-[#ab1f10] rounded hover:bg-rose-100"
            onClick={() => router.push('/')}
            type="button"
          >
            Home
          </button>
          <button
            className="px-4 py-2 bg-white text-[#ab1f10] border border-[#ab1f10] rounded hover:bg-rose-100"
            onClick={() => router.push('/color-picker')}
          >
            Back to Editor
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-sm font-semibold text-[#ab1f10] mb-1">User</label>
            <select
              className="w-full p-3 border border-rose-200 rounded text-black"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            >
              <option value="aastha">aastha</option>
              <option value="dhruvi">dhruvi</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#ab1f10] mb-1">Date</label>
            <input
              type="date"
              className="w-full p-3 border border-rose-200 rounded text-black"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              className="w-full px-4 py-3 bg-[#ab1f10] text-white rounded hover:bg-red-700"
              onClick={fetchAudit}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Search'}
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-3 bg-rose-50">
          {loading && <div className="text-sm text-gray-600">Loading…</div>}
          {!loading && entries.length === 0 && (
            <div className="text-sm text-gray-600">No entries for this selection.</div>
          )}
          {!loading && entries.length > 0 && (
            <div className="space-y-3">
              {entries.map((e, idx) => (
                <div key={idx} className="bg-white rounded p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-semibold text-black">{e.product}</span>
                      <span className="text-gray-600"> — {e.brand}</span>
                      {e.productType && (
                        <span className="ml-2 text-xs px-2 py-1 rounded bg-rose-100 text-[#ab1f10]">{e.productType}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600">{e.at ? new Date(e.at).toLocaleString() : ''}</div>
                  </div>
                  <div className="mt-2">
                    <div className="text-xs text-gray-700">Added shades:</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {e.added.map((name) => (
                        <span key={name} className="inline-block text-xs px-2 py-1 rounded border border-rose-200">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
