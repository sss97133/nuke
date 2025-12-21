import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SimpleETFDetails from '../components/market/SimpleETFDetails';

type SegmentSubcategory = {
  id: string;
  segment_id: string;
  slug: string;
  name: string;
  description: string | null;
};

type SegmentIndexRow = {
  segment_id: string;
  slug: string;
  name: string;
  description: string | null;
  manager_type: 'ai' | 'human';
  year_min: number | null;
  year_max: number | null;
  makes: string[] | null;
  model_keywords: string[] | null;
  vehicle_count: number;
  market_cap_usd: number;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  subcategory_count?: number;
  subcategories?: SegmentSubcategory[];
};

const formatUSD0 = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

function slugify(s: string) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export default function MarketSegmentDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [segment, setSegment] = useState<SegmentIndexRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const [subcatName, setSubcatName] = useState('');
  const [subcatDescription, setSubcatDescription] = useState('');
  const [subcatSaving, setSubcatSaving] = useState(false);
  const [subcatError, setSubcatError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionUserId(data.session?.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (!slug) return;

        const { data, error } = await supabase
          .from('market_segments_index')
          .select(
            'segment_id, slug, name, description, manager_type, year_min, year_max, makes, model_keywords, vehicle_count, market_cap_usd, change_7d_pct, change_30d_pct, subcategory_count, subcategories'
          )
          .eq('slug', slug)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setSegment(null);
          return;
        }

        const r: any = data;
        setSegment({
          segment_id: r.segment_id,
          slug: r.slug,
          name: r.name,
          description: r.description ?? null,
          manager_type: r.manager_type,
          year_min: r.year_min ?? null,
          year_max: r.year_max ?? null,
          makes: r.makes ?? null,
          model_keywords: r.model_keywords ?? null,
          vehicle_count: Number(r.vehicle_count || 0),
          market_cap_usd: Number(r.market_cap_usd || 0),
          change_7d_pct: r.change_7d_pct === null ? null : Number(r.change_7d_pct),
          change_30d_pct: r.change_30d_pct === null ? null : Number(r.change_30d_pct),
          subcategory_count: r.subcategory_count === null || r.subcategory_count === undefined ? undefined : Number(r.subcategory_count),
          subcategories: Array.isArray(r.subcategories) ? (r.subcategories as SegmentSubcategory[]) : undefined
        });
      } catch (e: any) {
        console.error('Failed to load segment detail:', e);
        setError(e?.message || 'Failed to load segment detail');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const handleAddSubcategory = async () => {
    if (!segment) return;
    const name = subcatName.trim();
    const description = subcatDescription.trim() || null;
    const nextSlug = slugify(name);

    if (!name) {
      setSubcatError('Name is required');
      return;
    }
    if (!nextSlug) {
      setSubcatError('Name cannot produce a valid slug');
      return;
    }

    try {
      setSubcatSaving(true);
      setSubcatError(null);

      const { data, error } = await supabase
        .from('market_segment_subcategories')
        .insert({
          segment_id: segment.segment_id,
          slug: nextSlug,
          name,
          description,
          status: 'active'
        })
        .select('id, segment_id, slug, name, description')
        .single();

      if (error) throw error;
      const created = data as SegmentSubcategory;
      const prev = Array.isArray(segment.subcategories) ? segment.subcategories : [];
      const next = [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
      setSegment({ ...segment, subcategories: next, subcategory_count: next.length });
      setSubcatName('');
      setSubcatDescription('');
    } catch (e: any) {
      console.error('Failed to create subcategory:', e);
      setSubcatError(e?.message || 'Failed to create subcategory');
    } finally {
      setSubcatSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading segment...
      </div>
    );
  }

  if (!segment) {
    // Show simplified contract details even if segment query failed
    if (slug) {
      return <SimpleETFDetails segmentSlug={slug} />;
    }
    
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Segment not found.
        <div style={{ marginTop: '10px' }}>
          <button className="button button-secondary" onClick={() => navigate('/market')}>
            Back to Market
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '14pt' }}>{segment.name}</h1>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{segment.manager_type.toUpperCase()}</div>
            </div>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              Slug: <strong style={{ color: 'var(--text)' }}>{segment.slug}</strong>
            </div>
            {segment.description && (
              <div style={{ marginTop: '8px', fontSize: '9pt', color: 'var(--text-muted)' }}>{segment.description}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/segments')}>
              Back
            </button>
            <button className="button button-secondary" onClick={() => navigate('/')}>
              Home
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '12px', border: '2px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ fontWeight: 800, marginBottom: '6px' }}>Error</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{error}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Index</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Vehicles</span>
                <strong>{segment.vehicle_count.toLocaleString()}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>In play</span>
                <strong>{formatUSD0(segment.market_cap_usd)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>7d</span>
                <strong>{formatPct(segment.change_7d_pct)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>30d</span>
                <strong>{formatPct(segment.change_30d_pct)}</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Definition</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '8px', fontSize: '9pt' }}>
              <div>
                <strong>Year</strong>: {segment.year_min ?? '—'} to {segment.year_max ?? '—'}
              </div>
              <div>
                <strong>Makes</strong>: {segment.makes?.length ? segment.makes.join(', ') : 'Any'}
              </div>
              <div>
                <strong>Keywords</strong>: {segment.model_keywords?.length ? segment.model_keywords.join(', ') : 'None'}
              </div>
              <div style={{ marginTop: '6px', color: 'var(--text-muted)' }}>
                Next step: add “constituents” listing + time-series index chart once you confirm the index math.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Subcategories</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '10px' }}>
              {Array.isArray(segment.subcategories) && segment.subcategories.length > 0 ? (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {segment.subcategories.map((sc) => (
                    <div
                      key={sc.id}
                      style={{
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        padding: '10px',
                        background: 'var(--white)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                        <div style={{ fontWeight: 900 }}>{sc.name}</div>
                        <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{sc.slug}</div>
                      </div>
                      {sc.description && (
                        <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>{sc.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>No subcategories yet.</div>
              )}

              {sessionUserId ? (
                <div style={{ borderTop: '2px solid var(--border)', paddingTop: '10px' }}>
                  <div style={{ fontWeight: 900, marginBottom: '6px', fontSize: '9pt' }}>Add subcategory</div>
                  {subcatError && (
                    <div style={{ marginBottom: '8px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                      Error: <strong style={{ color: 'var(--text)' }}>{subcatError}</strong>
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <input
                      value={subcatName}
                      onChange={(e) => setSubcatName(e.target.value)}
                      placeholder="Name (e.g. Commuter, Luxury, Track)"
                      style={{
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        padding: '8px',
                        background: 'var(--white)',
                        color: 'var(--text)'
                      }}
                    />
                    <textarea
                      value={subcatDescription}
                      onChange={(e) => setSubcatDescription(e.target.value)}
                      placeholder="Description (optional)"
                      rows={3}
                      style={{
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        padding: '8px',
                        background: 'var(--white)',
                        color: 'var(--text)',
                        resize: 'vertical'
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                        Slug preview: <strong style={{ color: 'var(--text)' }}>{slugify(subcatName.trim()) || '—'}</strong>
                      </div>
                      <button className="button button-secondary" onClick={handleAddSubcategory} disabled={subcatSaving}>
                        {subcatSaving ? 'Saving...' : 'Add'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                  Sign in to add subcategories.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


