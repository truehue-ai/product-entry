'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_SOURCES = [
  'matte-lipstick', 'satin-lipstick', 'lip-gloss', 'lip-tint',
  'cream-blush', 'powder-blush', 'cream-eyeshadow', 'powder-eyeshadow',
  'concealer', 'foundation',
];

const LMD_CATEGORIES = [
  'daily-neutrals', 'perfect-pinks', 'reds-and-browns',
  'bold-and-deep', 'bright-and-fun',
];

const PRICE_BUCKETS = ['0', '500', '1000', '1500', '2000', '3500', '4500'];

const PICK_OPTIONS    = ['natural', 'pink', 'bold'];
const SK_CATEGORIES   = ['L', 'M', 'D'];
const UNDERTONES      = ['warm', 'cool', 'neutral'];
const ARTICLE_CATEGORIES = ['festival', 'trend', 'seasonal', 'everyday'];

const BLANK_TEMPLATE = {
  id: '',
  title: '',
  category: 'festival',
  tags: [],
  publish_date: new Date().toISOString().split('T')[0],
  is_premium: false,
  is_article_of_the_day: false,
  featured_image: '',
  slots: {},
  sections: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToken() {
  const m = document.cookie.match(/(?:^|;\s*)th_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ section, index, total, onChange, onDelete, onMoveUp, onMoveDown }) {
  const isFirst = index === 0;
  const isLast  = index === total - 1;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.65)',
      border: '1.5px solid rgba(255,255,255,0.9)',
      borderRadius: 14,
      padding: '18px 20px',
      position: 'relative',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            background: section.type === 'product_card' ? 'rgba(171,31,16,0.12)' :
                        section.type === 'tip'          ? 'rgba(100,160,255,0.15)' :
                                                          'rgba(100,200,140,0.15)',
            color: section.type === 'product_card' ? '#ab1f10' :
                   section.type === 'tip'          ? '#1a4fa0' : '#1a7a4a',
            padding: '3px 10px', borderRadius: 20,
          }}>
            {section.type === 'product_card' ? '🛍 Product Slot' :
             section.type === 'tip'          ? '💡 Tip' : '📝 Richtext'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => !isFirst && onMoveUp(index)} disabled={isFirst}
            style={{ ...iconBtn, opacity: isFirst ? 0.3 : 1 }}>↑</button>
          <button onClick={() => !isLast && onMoveDown(index)} disabled={isLast}
            style={{ ...iconBtn, opacity: isLast ? 0.3 : 1 }}>↓</button>
          <button onClick={() => onDelete(index)}
            style={{ ...iconBtn, color: '#c02020', borderColor: 'rgba(200,40,40,0.25)' }}>✕</button>
        </div>
      </div>

      {/* Content by type */}
      {section.type === 'richtext' && (
        <textarea
          value={section.content || ''}
          onChange={e => onChange(index, { ...section, content: e.target.value })}
          placeholder="Write your editorial copy here…"
          rows={4}
          style={inputStyle}
        />
      )}

      {section.type === 'subheading' && (
        <input
          value={section.content || ''}
          onChange={e => onChange(index, { ...section, content: e.target.value })}
          placeholder="e.g. The secret to long-lasting colour…"
          style={{ ...inputStyle, fontSize: 16, fontWeight: 600 }}
        />
      )}

      {section.type === 'image' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>Image URL</label>
            <input
              value={section.url || ''}
              onChange={e => onChange(index, { ...section, url: e.target.value })}
              placeholder="https://..."
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Caption (optional)</label>
            <input
              value={section.caption || ''}
              onChange={e => onChange(index, { ...section, caption: e.target.value })}
              placeholder="e.g. Model wearing Dior 012 Rosewood"
              style={inputStyle}
            />
          </div>
          {section.url && (
            <img src={section.url} alt="" style={{ width: '100%', borderRadius: 12, objectFit: 'cover', maxHeight: 200 }} onError={e => e.target.style.display='none'} />
          )}
        </div>
      )}

      {section.type === 'product_card' && (
        <ProductSlotEditor
          section={section}
          index={index}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function ProductSlotEditor({ section, index, onChange }) {
  const resolver = section.resolver || 'LMD_lookup';
  const params   = section.params   || {};

  function update(patch) {
    onChange(index, { ...section, ...patch });
  }

  function updateParams(pPatch) {
    onChange(index, { ...section, params: { ...params, ...pPatch } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Heading */}
      <div>
        <label style={labelStyle}>Section Heading</label>
        <input
          value={section.heading || ''}
          onChange={e => update({ heading: e.target.value })}
          placeholder="e.g. Your Lip Pick"
          style={inputStyle}
        />
      </div>

      {/* Slot ID (auto from heading) */}
      <div>
        <label style={labelStyle}>Slot ID <span style={{ color: '#9b4a42', fontWeight: 400 }}>(auto-generated, editable)</span></label>
        <input
          value={section.slot || ''}
          onChange={e => update({ slot: e.target.value })}
          placeholder="e.g. lip_pick"
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }}
        />
      </div>

      {/* Resolver toggle */}
      <div>
        <label style={labelStyle}>Resolver Type</label>
        <div style={{ display: 'flex', gap: 10 }}>
          {['LMD_lookup', 'shade_rec'].map(r => (
            <button
              key={r}
              onClick={() => update({ resolver: r, params: {} })}
              style={{
                padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                background: resolver === r ? '#ab1f10' : 'rgba(255,255,255,0.7)',
                color:      resolver === r ? 'white'   : '#ab1f10',
                border:     resolver === r ? '1.5px solid #ab1f10' : '1.5px solid rgba(171,31,16,0.3)',
              }}
            >
              {r === 'LMD_lookup' ? '📊 LMD Lookup' : '🎯 Shade Rec'}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: '#9b4a42', margin: '6px 0 0', fontWeight: 400 }}>
          {resolver === 'LMD_lookup'
            ? 'Pull all products from the categorised_LMD database for this user\'s depth tier.'
            : 'Pick a specific brand/product — system finds the best shade for this user\'s undertone.'}
        </p>
      </div>

      {/* LMD params */}
      {resolver === 'LMD_lookup' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Product Source</label>
            <select value={params.source || ''} onChange={e => updateParams({ source: e.target.value })} style={selectStyle}>
              <option value="">Select…</option>
              {PRODUCT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={params.category || ''} onChange={e => updateParams({ category: e.target.value })} style={selectStyle}>
              <option value="">Select…</option>
              {LMD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Price Bucket (max ₹)</label>
            <select value={params.price_bucket || ''} onChange={e => updateParams({ price_bucket: e.target.value })} style={selectStyle}>
              <option value="">Select…</option>
              {PRICE_BUCKETS.map(b => <option key={b} value={b}>{b === '0' ? 'Budget tier' : `Tier ${b}`}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Max Products</label>
            <input
                type="number"
                min="1"
                max="20"
                value={params.max_products || 5}
                onChange={e => updateParams({ max_products: parseInt(e.target.value) || 5 })}
                style={inputStyle}
            />
            </div>
        </div>
      )}

      {/* Shade rec params */}
      {resolver === 'shade_rec' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Product Type</label>
            <select value={params.product_type || ''} onChange={e => updateParams({ product_type: e.target.value })} style={selectStyle}>
              <option value="">Select…</option>
              {PRODUCT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Brand</label>
            <input
              value={params.brand || ''}
              onChange={e => updateParams({ brand: e.target.value })}
              placeholder="e.g. nars"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Product Name</label>
            <input
              value={params.product_name || ''}
              onChange={e => updateParams({ product_name: e.target.value })}
              placeholder="e.g. powermatte-lipstick"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Pick</label>
            <select value={params.pick || 'natural'} onChange={e => updateParams({ pick: e.target.value })} style={selectStyle}>
              {PICK_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPanel({ template, apiBase }) {
  const [skCategory, setSkCategory] = useState('M');
  const [undertone, setUndertone]   = useState('warm');
  const [number, setNumber]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState(null);

  async function runPreview() {
    if (!number) { setError('Enter a phone number to preview'); return; }
    setLoading(true); setError(null); setResult(null);

    try {
      const res = await fetch(
        `/api/magazine/article/${template.id}?sk_category=${skCategory}&undertone=${undertone}&number=${encodeURIComponent(number)}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Preview controls */}
      <div style={{
        background: 'rgba(255,255,255,0.65)',
        border: '1.5px solid rgba(255,255,255,0.9)',
        borderRadius: 14, padding: '20px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a0a09' }}>Preview Settings</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Skin Tone (L / M / D)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {SK_CATEGORIES.map(sk => (
                <button key={sk} onClick={() => setSkCategory(sk)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                  background: skCategory === sk ? '#ab1f10' : 'rgba(255,255,255,0.7)',
                  color:      skCategory === sk ? 'white'   : '#ab1f10',
                  border:     skCategory === sk ? '1.5px solid #ab1f10' : '1.5px solid rgba(171,31,16,0.3)',
                }}>{sk}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Undertone</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {UNDERTONES.map(u => (
                <button key={u} onClick={() => setUndertone(u)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s', textTransform: 'capitalize',
                  background: undertone === u ? '#ab1f10' : 'rgba(255,255,255,0.7)',
                  color:      undertone === u ? 'white'   : '#ab1f10',
                  border:     undertone === u ? '1.5px solid #ab1f10' : '1.5px solid rgba(171,31,16,0.3)',
                }}>{u}</button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Phone Number <span style={{ color: '#9b4a42', fontWeight: 400 }}>(test user's selfie)</span></label>
          <input
            value={number}
            onChange={e => setNumber(e.target.value)}
            placeholder="e.g. 9876543210"
            style={inputStyle}
          />
        </div>

        <button
          onClick={runPreview}
          disabled={loading || !template.id || !number}
          style={{
            background: loading ? '#ccc' : '#ab1f10',
            color: 'white', border: 'none', borderRadius: 10,
            padding: '11px 24px', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.16s',
            alignSelf: 'flex-start',
          }}
        >
          {loading ? 'Generating try-ons…' : '▶ Run Preview'}
        </button>

        {error && <div style={{ color: '#c02020', fontSize: 13 }}>{error}</div>}
      </div>

      {/* Preview result */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: '#9b4a42', padding: '4px 0',
          }}>
            Preview — {result.personalized_for?.sk_category} / {result.personalized_for?.undertone}
          </div>

          {result.sections?.map((section, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.6)',
              border: '1.5px solid rgba(255,255,255,0.85)',
              borderRadius: 14, padding: '18px 20px',
            }}>
              {section.type === 'richtext' && (
                <p style={{ fontSize: 14, color: '#1a0a09', lineHeight: 1.7, margin: 0, fontWeight: 400 }}>
                  {section.content}
                </p>
              )}

              {section.type === 'tip' && (
                <div style={{
                  background: 'rgba(100,160,255,0.1)', borderLeft: '3px solid #4a80d0',
                  borderRadius: '0 10px 10px 0', padding: '12px 16px',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1a4fa0', letterSpacing: '0.04em' }}>TIP</span>
                  <p style={{ fontSize: 13, color: '#1a0a09', margin: '4px 0 0', lineHeight: 1.6 }}>{section.content}</p>
                </div>
              )}

              {section.type === 'product_card' && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ab1f10', marginBottom: 14 }}>
                    {section.heading}
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {(section.products || []).map((product, pi) => (
                      <div key={pi} style={{
                        background: 'rgba(255,255,255,0.8)',
                        border: '1.5px solid rgba(255,255,255,0.9)',
                        borderRadius: 12, overflow: 'hidden',
                        width: 160, flexShrink: 0,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                      }}>
                        {product.try_on_image && (
                          <img
                            src={product.try_on_image.image}
                            alt={product.shade_name}
                            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                          />
                        )}
                        <div style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <div style={{
                              width: 14, height: 14, borderRadius: '50%',
                              background: product.shade_hex_code,
                              border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0,
                            }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#1a0a09', lineHeight: 1.3 }}>
                              {product.shade_name}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: '#9b4a42', marginBottom: 2 }}>{product.brand}</div>
                          {product.price && (
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#ab1f10' }}>₹{product.price}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '9px 13px', borderRadius: 9,
  border: '1.5px solid rgba(171,31,16,0.2)',
  background: 'rgba(255,255,255,0.8)',
  fontSize: 14, color: '#1a0a09', outline: 'none',
  fontFamily: "'Inter', sans-serif",
  resize: 'vertical',
};

const selectStyle = {
  ...inputStyle, resize: 'none', cursor: 'pointer',
};

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 700,
  color: '#9b4a42', textTransform: 'uppercase',
  letterSpacing: '0.05em', marginBottom: 6,
};

const iconBtn = {
  width: 30, height: 30, borderRadius: 7,
  border: '1.5px solid rgba(171,31,16,0.25)',
  background: 'rgba(255,255,255,0.7)',
  color: '#ab1f10', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', transition: 'all 0.15s',
};

// ─── Main Editor Page ─────────────────────────────────────────────────────────

export default function ArticleEditorPage() {
  const router   = useRouter();
  const params   = useParams();
  const isNew    = !params?.id || params.id === 'new';
  const articleId = isNew ? null : params.id;

  const apiBase = '/api/magazine';

  const [template, setTemplate] = useState(BLANK_TEMPLATE);
  const [loading, setLoading]   = useState(!isNew);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState(null);
    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const [activeTab, setActiveTab] = useState(searchParams?.get('tab') === 'preview' ? 'preview' : 'build');// 'build' | 'preview'
  const [tagInput, setTagInput]   = useState('');

  // Load existing article
  useEffect(() => {
    if (!isNew && articleId) {
      fetch(`${apiBase}/article/${articleId}?raw=1`)
        .then(r => r.json())
        .then(data => { setTemplate({ ...BLANK_TEMPLATE, ...data, tags: data.tags || [] }); setLoading(false); })
        .catch(() => { setError('Failed to load article'); setLoading(false); });
    }
  }, [articleId]);

  // Auto-generate ID from title (new articles only)
  function handleTitleChange(title) {
    setTemplate(prev => ({
      ...prev,
      title,
      ...(isNew ? { id: slugify(title) } : {}),
    }));
  }

  // Section operations
  function addSection(type) {
    const newSection = type === 'product_card'
      ? { type, heading: '', slot: `slot_${uid()}`, resolver: 'LMD_lookup', params: {} }
      : type === 'image'
      ? { type, url: '', caption: '' }
      : type === 'subheading'
      ? { type, content: '' }
      : { type, content: '' };
    setTemplate(prev => ({ ...prev, sections: [...prev.sections, newSection] }));
  }

  function updateSection(index, updated) {
    setTemplate(prev => {
      const sections = [...prev.sections];
      sections[index] = updated;
      return { ...prev, sections };
    });
  }

  function deleteSection(index) {
    setTemplate(prev => ({ ...prev, sections: prev.sections.filter((_, i) => i !== index) }));
  }

  function moveSection(index, direction) {
    setTemplate(prev => {
      const sections = [...prev.sections];
      const target = index + direction;
      if (target < 0 || target >= sections.length) return prev;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...prev, sections };
    });
  }

  // Sync slots from product_card sections
  function buildSlots(sections) {
    const slots = {};
    sections.forEach(sec => {
      if (sec.type === 'product_card' && sec.slot) {
        slots[sec.slot] = {
          resolver: sec.resolver,
          params:   sec.params || {},
        };
      }
    });
    return slots;
  }

  async function uploadFeaturedImage(file) {
    const ext   = file.name.split('.').pop();
    const version = template.featured_image ? `_v${Date.now()}` : '';
    const s3Key = `magazine/${template.id}/image${version}.${ext}`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('key', s3Key);

    const res = await fetch(`/api/magazine/upload-image`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    const { url } = await res.json();
    setTemplate(prev => ({ ...prev, featured_image: url }));
}

  async function saveArticle() {
    setSaving(true); setError(null);
    const payload = { ...template, slots: buildSlots(template.sections) };

    try {
      const url    = isNew ? `${apiBase}` : `${apiBase}/article/${articleId}`;
      const method = isNew ? 'POST' : 'PUT';
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      if (isNew) router.replace(`/articles/${payload.id}/edit`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #fff8f7 0%, #fde8e4 100%)', fontFamily: "'Inter', sans-serif",
      color: '#9b4a42', fontSize: 15 }}>
      Loading article…
    </div>
  );

  return (
    <main style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #fff8f7 0%, #fde8e4 40%, #f9d0cc 100%)',
      fontFamily: "'Inter', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      <style>{`
        * { font-family: 'Inter', sans-serif !important; box-sizing: border-box; }
        input, textarea, select { font-family: 'Inter', sans-serif !important; }
        input:focus, textarea:focus, select:focus { outline: 2px solid rgba(171,31,16,0.3); }
        .back-btn { background: transparent; border: none; color: #ab1f10; font-size: 14px;
          font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;
          padding: 0; opacity: 0.8; transition: opacity 0.15s; }
        .back-btn:hover { opacity: 1; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

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
          <button className="back-btn" onClick={() => router.push('/articles')}>← Articles</button>
          <span style={{ color: 'rgba(171,31,16,0.3)', fontSize: 16 }}>|</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1a0a09', letterSpacing: '-0.3px' }}>
            {isNew ? 'New Article' : template.title || articleId}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 13, color: '#1a7a4a', fontWeight: 600 }}>✓ Saved</span>}
          {error  && <span style={{ fontSize: 13, color: '#c02020', maxWidth: 280 }}>{error}</span>}
          <button
            onClick={saveArticle}
            disabled={saving}
            style={{
              background: saving ? '#ccc' : '#ab1f10',
              color: 'white', border: 'none', borderRadius: 10,
              padding: '9px 22px', fontSize: 14, fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : isNew ? 'Publish Article' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div style={{
        background: 'rgba(255,255,255,0.5)',
        borderBottom: '1px solid rgba(255,255,255,0.7)',
        padding: '0 32px',
        display: 'flex', gap: 0,
      }}>
        {[
          { key: 'build',   label: '🏗 Build' },
          { key: 'preview', label: '👁 Preview' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '12px 22px', fontSize: 14, fontWeight: 600,
              background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #ab1f10' : '2px solid transparent',
              color: activeTab === tab.key ? '#ab1f10' : '#9b4a42',
              cursor: 'pointer', transition: 'all 0.15s',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 80px', position: 'relative', zIndex: 1 }}>

        {/* ── BUILD TAB ── */}
        {activeTab === 'build' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, animation: 'fadeUp 0.3s ease both' }}>

            {/* Metadata card */}
            <div style={{
              background: 'rgba(255,255,255,0.65)',
              border: '1.5px solid rgba(255,255,255,0.9)',
              borderRadius: 16, padding: '24px',
              display: 'flex', flexDirection: 'column', gap: 18,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ab1f10', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Article Details
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Title</label>
                  <input
                    value={template.title}
                    onChange={e => handleTitleChange(e.target.value)}
                    placeholder="e.g. Your Holi Glow Edit"
                    style={{ ...inputStyle, fontSize: 16, fontWeight: 600 }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Article ID <span style={{ color: '#9b4a42', fontWeight: 400 }}>(URL slug)</span></label>
                  <input
                    value={template.id}
                    onChange={e => setTemplate(prev => ({ ...prev, id: e.target.value }))}
                    placeholder="holi-glow-edit-2026"
                    style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Category</label>
                  <select
                    value={template.category}
                    onChange={e => setTemplate(prev => ({ ...prev, category: e.target.value }))}
                    style={selectStyle}
                  >
                    {ARTICLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Publish Date</label>
                  <input
                    type="date"
                    value={template.publish_date}
                    onChange={e => setTemplate(prev => ({ ...prev, publish_date: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>
                        Featured Image
                        {!template.id && <span style={{ color: '#9b4a42', fontWeight: 400 }}> — save article first to enable upload</span>}
                    </label>
                    {template.featured_image && (
                        <div style={{
                        marginBottom: 10, borderRadius: 12, overflow: 'hidden',
                        height: 160, border: '1.5px solid rgba(255,255,255,0.8)',
                        }}>
                        <img
                            key={template.featured_image}
                            src={template.featured_image}
                            alt="Featured"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={e => e.target.style.display = 'none'}
                        />
                        </div>
                    )}
                    <label style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 16px', borderRadius: 10,
                        border: '1.5px dashed rgba(171,31,16,0.3)',
                        background: 'rgba(255,255,255,0.6)',
                        cursor: template.id ? 'pointer' : 'not-allowed',
                        opacity: template.id ? 1 : 0.5,
                        fontSize: 13, color: '#ab1f10', fontWeight: 600,
                    }}>
                        📷 {template.featured_image ? 'Replace Image' : 'Upload Featured Image'}
                        <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        disabled={!template.id}
                        onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                            await uploadFeaturedImage(file);
                            } catch (err) {
                            setError('Image upload failed: ' + err.message);
                            }
                            e.target.value = '';
                        }}
                        />
                    </label>
                    </div>

                <div>
                  <label style={labelStyle}>Tags</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {template.tags.map(tag => (
                      <span key={tag} style={{
                        background: 'rgba(171,31,16,0.1)', color: '#ab1f10',
                        borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}>
                        {tag}
                        <button onClick={() => setTemplate(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ab1f10', fontSize: 12, padding: 0 }}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && tagInput.trim()) {
                          setTemplate(prev => ({ ...prev, tags: [...prev.tags, tagInput.trim()] }));
                          setTagInput('');
                        }
                      }}
                      placeholder="Type tag + Enter"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { key: 'is_premium',            label: '✦ Premium Article' },
                    { key: 'is_article_of_the_day', label: '★ Article of the Day' },
                  ].map(toggle => (
                    <label key={toggle.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <div
                        onClick={() => setTemplate(prev => ({ ...prev, [toggle.key]: !prev[toggle.key] }))}
                        style={{
                          width: 40, height: 22, borderRadius: 11, position: 'relative',
                          background: template[toggle.key] ? '#ab1f10' : 'rgba(0,0,0,0.15)',
                          transition: 'background 0.2s', cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: 3, left: template[toggle.key] ? 21 : 3,
                          width: 16, height: 16, borderRadius: '50%', background: 'white',
                          transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                        }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1a0a09' }}>{toggle.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Sections */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#ab1f10', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Article Sections ({template.sections.length})
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { type: 'richtext',     label: '+ Richtext' },
                    { type: 'subheading',   label: '+ Subheading' },
                    { type: 'tip',          label: '+ Tip' },
                    { type: 'image',        label: '+ Image' },
                    { type: 'product_card', label: '+ Product Slot' },
                  ].map(({ type, label }) => (
                    <button key={type} onClick={() => addSection(type)} style={{
                      padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                      background: type === 'product_card' ? 'rgba(171,31,16,0.1)' : 'rgba(255,255,255,0.7)',
                      color: '#ab1f10',
                      border: '1.5px solid rgba(171,31,16,0.25)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>{label}</button>
                  ))}
                </div>
              </div>

              {template.sections.length === 0 && (
                <div style={{
                  textAlign: 'center', padding: '48px 24px',
                  background: 'rgba(255,255,255,0.5)',
                  border: '1.5px dashed rgba(171,31,16,0.25)',
                  borderRadius: 16, color: '#9b4a42', fontSize: 14,
                }}>
                  No sections yet — add a richtext, tip, or product slot above.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {template.sections.map((section, i) => (
                  <SectionCard
                    key={i}
                    section={section}
                    index={i}
                    total={template.sections.length}
                    onChange={updateSection}
                    onDelete={deleteSection}
                    onMoveUp={idx => moveSection(idx, -1)}
                    onMoveDown={idx => moveSection(idx, 1)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── PREVIEW TAB ── */}
        {activeTab === 'preview' && (
          <div style={{ animation: 'fadeUp 0.3s ease both' }}>
            {!template.id ? (
              <div style={{
                textAlign: 'center', padding: '60px 24px',
                background: 'rgba(255,255,255,0.5)',
                borderRadius: 16, color: '#9b4a42', fontSize: 14,
              }}>
                Save the article first before previewing.
              </div>
            ) : (
              <PreviewPanel template={template} apiBase={apiBase} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}