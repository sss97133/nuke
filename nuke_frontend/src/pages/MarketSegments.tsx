import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

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
  status?: 'active' | 'draft' | 'archived';
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
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const getDefinitionSubcategory = (r: SegmentIndexRow) => {
  const hasYear = r.year_min !== null || r.year_max !== null;
  const hasMakes = Array.isArray(r.makes) && r.makes.length > 0;
  const hasKeywords = Array.isArray(r.model_keywords) && r.model_keywords.length > 0;

  if (hasYear && !hasMakes && !hasKeywords) return 'Year-defined';
  if (!hasYear && hasMakes && !hasKeywords) return 'Make-defined';
  if (!hasYear && !hasMakes && hasKeywords) return 'Keyword-defined';
  if (hasYear || hasMakes || hasKeywords) return 'Hybrid';
  return 'Uncategorized';
};

export default function MarketSegments() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SegmentIndexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [managerFilter, setManagerFilter] = useState<'all' | 'ai' | 'human'>('all');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session?.user));
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data, error } = await supabase
          .from('market_segments_index')
          .select(
            'segment_id, slug, name, description, manager_type, status, year_min, year_max, makes, model_keywords, vehicle_count, market_cap_usd, change_7d_pct, change_30d_pct, subcategory_count, subcategories'
          )
          .order('market_cap_usd', { ascending: false });

        if (error) throw error;
        const normalized = (data || []).map((r: any) => ({
          segment_id: r.segment_id,
          slug: r.slug,
          name: r.name,
          description: r.description ?? null,
          manager_type: r.manager_type,
          status: r.status ?? undefined,
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
        })) as SegmentIndexRow[];
        setRows(normalized);
      } catch (e: any) {
        console.error('Failed to load market segments:', e);
        setError(e?.message || 'Failed to load market segments');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (managerFilter !== 'all' && r.manager_type !== managerFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, managerFilter]);

  const grouped = useMemo(() => {
    const buckets: Record<string, SegmentIndexRow[]> = {};
    for (const r of filtered) {
      const key = getDefinitionSubcategory(r);
      (buckets[key] ||= []).push(r);
    }

    const order = ['Make-defined', 'Year-defined', 'Keyword-defined', 'Hybrid', 'Uncategorized'];
    const ordered: Record<string, SegmentIndexRow[]> = {};
    for (const k of order) {
      if (buckets[k]?.length) ordered[k] = buckets[k];
    }
    for (const k of Object.keys(buckets)) {
      if (!(k in ordered)) ordered[k] = buckets[k];
    }
    return ordered;
  }, [filtered]);

  const tileBg = (pct: number | null) => {
    if (pct === null) return 'rgba(0,0,0,0.03)';
    if (pct > 0) return 'rgba(16, 185, 129, 0.14)';
    if (pct < 0) return 'rgba(220, 38, 38, 0.14)';
    return 'rgba(0,0,0,0.03)';
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading market segments...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            flexWrap: 'wrap',
            lineHeight: '12px'
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '14pt' }}>Market Segments</h1>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 200 }}>
              Browse segments and index stats. Trading is intentionally not enabled here yet.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-secondary" onClick={() => navigate('/')}>
              Back
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
              Portfolio
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: '16px', padding: '12px', border: '2px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ fontWeight: 800, marginBottom: '6px' }}>Error</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{error}</div>
          </div>
        )}

        <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search segments..."
            style={{
              border: '2px solid var(--border)',
              borderRadius: '4px',
              padding: '8px',
              minWidth: '280px',
              background: 'var(--white)',
              color: 'var(--text)'
            }}
          />
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
            Manager
            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value as any)}
              style={{
                border: '2px solid var(--border)',
                borderRadius: '4px',
                padding: '6px',
                background: 'var(--white)',
                color: 'var(--text)'
              }}
            >
              <option value="all">All</option>
              <option value="ai">AI</option>
              <option value="human">Human</option>
            </select>
          </div>
        </div>

        {!error && rows.length === 0 && (
          <div style={{ marginTop: '18px', padding: '14px', border: '2px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ fontWeight: 900, marginBottom: '6px' }}>No segments returned</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
              This usually means there are no segments with status = active, or your database permissions/policies are preventing reads of the
              market segments index view.
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {!hasSession && (
                <button className="button button-secondary" onClick={() => navigate('/login')}>
                  Sign in
                </button>
              )}
              <button className="button button-secondary" onClick={() => navigate('/')}>
                Home
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: '18px', display: 'grid', gap: '18px' }}>
          {Object.entries(grouped).map(([groupName, items]) => (
            <div key={groupName}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 900, marginBottom: '10px' }}>
                {groupName} <span style={{ fontWeight: 400 }}>({items.length})</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                {items.map((r) => (
                  <button
                    key={r.segment_id}
                    onClick={() => navigate(`/market/segments/${r.slug}`)}
                    style={{
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '14px',
                      border: '2px solid var(--border)',
                      borderRadius: '4px',
                      background: tileBg(r.change_7d_pct),
                      transition: 'transform 0.12s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                    title="Open segment"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={{ fontWeight: 900 }}>{r.name}</div>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{r.manager_type.toUpperCase()}</div>
                    </div>

                    <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                      {r.vehicle_count.toLocaleString()} vehicles • {formatUSD0(r.market_cap_usd)} in play
                    </div>

                    <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>7d</div>
                      <div style={{ fontWeight: 900 }}>{formatPct(r.change_7d_pct)}</div>
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>30d</div>
                      <div style={{ fontWeight: 900 }}>{formatPct(r.change_30d_pct)}</div>
                    </div>

                    <div style={{ marginTop: '10px', fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                      <div>
                        <strong>Year</strong>: {r.year_min ?? '—'} to {r.year_max ?? '—'}
                      </div>
                      <div>
                        <strong>Makes</strong>: {r.makes?.length ? r.makes.join(', ') : 'Any'}
                      </div>
                      <div>
                        <strong>Keywords</strong>: {r.model_keywords?.length ? r.model_keywords.join(', ') : 'None'}
                      </div>
                      <div>
                        <strong>Subcategories</strong>:{' '}
                        {r.subcategory_count && r.subcategory_count > 0 ? (
                          <span>
                            {(r.subcategories || []).slice(0, 3).map((sc) => sc.name).join(', ')}
                            {r.subcategory_count > 3 ? ` (+${r.subcategory_count - 3} more)` : ''}
                          </span>
                        ) : (
                          'None'
                        )}
                      </div>
                    </div>

                    {r.description && (
                      <div style={{ marginTop: '10px', fontSize: '9pt', color: 'var(--text-muted)' }}>{r.description}</div>
                    )}

                    <div style={{ marginTop: '10px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                      Slug: <strong style={{ color: 'var(--text)' }}>{r.slug}</strong>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


