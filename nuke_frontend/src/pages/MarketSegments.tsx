import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMarketSegments, type SegmentIndexRow } from '../hooks/useMarketSegments';


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
  const { user } = useAuth();
  const hasSession = Boolean(user);
  const { data: rows = [], isLoading: loading, error: queryError } = useMarketSegments();
  const error = queryError ? (queryError as Error).message : null;
  const [query, setQuery] = useState('');
  const [managerFilter, setManagerFilter] = useState<'all' | 'ai' | 'human'>('all');

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
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ height: 28, background: 'var(--surface)', marginBottom: 24, width: 220 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} style={{ border: '2px solid var(--border)', padding: 16, background: 'var(--surface)' }}>
                <div style={{ height: 14, background: 'var(--border)', marginBottom: 10, width: '60%' }} />
                <div style={{ height: 24, background: 'var(--border)', marginBottom: 8, width: '40%' }} />
                <div style={{ height: 10, background: 'var(--border)', width: '75%' }} />
              </div>
            ))}
          </div>
        </div>
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
            <h1 style={{ margin: 0, fontSize: '19px' }}>Market Segments</h1>
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 200 }}>
              Browse segments and index stats. Trading is intentionally not enabled here yet.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Link to="/" className="button button-secondary" style={{ textDecoration: 'none', color: 'inherit' }}>
              Back
            </Link>
            <Link to="/market/portfolio" className="button button-secondary" style={{ textDecoration: 'none', color: 'inherit' }}>
              Portfolio
            </Link>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: '16px', padding: '12px', border: '2px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ fontWeight: 800, marginBottom: '6px' }}>Error</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{error}</div>
          </div>
        )}

        <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search segments..."
            style={{
              border: '2px solid var(--border)', padding: '8px',
              minWidth: '280px',
              background: 'var(--white)',
              color: 'var(--text)'
            }}
          />
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
            Manager
            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value as any)}
              style={{
                border: '2px solid var(--border)', padding: '6px',
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
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '14px' }}>
              This usually means there are no segments with status = active, or your database permissions/policies are preventing reads of the
              market segments index view.
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {!hasSession && (
                <Link to="/login" className="button button-secondary" style={{ textDecoration: 'none', color: 'inherit' }}>
                  Sign in
                </Link>
              )}
              <Link to="/" className="button button-secondary" style={{ textDecoration: 'none', color: 'inherit' }}>
                Home
              </Link>
            </div>
          </div>
        )}

        <div style={{ marginTop: '18px', display: 'grid', gap: '18px' }}>
          {Object.entries(grouped).map(([groupName, items]) => (
            <div key={groupName}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 900, marginBottom: '10px' }}>
                {groupName} <span style={{ fontWeight: 400 }}>({items.length})</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                {items.map((r) => (
                  <Link
                    key={r.segment_id}
                    to={`/market/segments/${r.slug}`}
                    style={{
                      textDecoration: 'none', color: 'inherit',
                      textAlign: 'left',
                      padding: '14px',
                      border: '2px solid var(--border)', background: tileBg(r.change_7d_pct),
                      transition: 'transform 0.12s ease',
                      display: 'block'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                    title="Open segment"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={{ fontWeight: 900 }}>{r.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{r.manager_type.toUpperCase()}</div>
                    </div>

                    <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {r.vehicle_count.toLocaleString()} vehicles • {formatUSD0(r.market_cap_usd)} in play
                    </div>

                    <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>7d</div>
                      <div style={{ fontWeight: 900 }}>{formatPct(r.change_7d_pct)}</div>
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>30d</div>
                      <div style={{ fontWeight: 900 }}>{formatPct(r.change_30d_pct)}</div>
                    </div>

                    {r.description && (
                      <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '16px' }}>{r.description}</div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


