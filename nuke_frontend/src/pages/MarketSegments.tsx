import React, { useMemo, useState } from 'react';
import { PrefetchLink as Link } from '../components/PrefetchLink';
import { usePageTitle } from '../hooks/usePageTitle';
import './MarketPages.css';
import { useAuth } from '../hooks/useAuth';
import { useMarketSegments, type SegmentIndexRow } from '../hooks/useMarketSegments';


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
  usePageTitle('Market segments');
  const { user } = useAuth();
  const hasSession = Boolean(user);
  const { data: rows = [], isLoading: loading, error: queryError, isFetching, refetch } = useMarketSegments();
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

  return (
    <div className="market-definitions-page">
      <header className="market-definitions-header">
        <div>
          <h1>Market segments</h1>
          <p>Browse retained definitions by year, make and model keywords.</p>
        </div>
        <nav aria-label="Market navigation">
          <Link to="/market" className="button">Browse vehicles</Link>
          <Link to="/?tab=garage" className="button">Your Garage</Link>
        </nav>
      </header>
      {loading && <p role="status">Loading segment definitions…</p>}
      {error && <div role="alert" className="market-reader-error">
        <span>Segment definitions could not be refreshed: {error} {rows.length > 0 ? 'Showing the last successful definitions.' : ''}</span>
        <button className="button" disabled={isFetching} onClick={() => void refetch()}>Retry segments</button>
      </div>}
      <p className="market-page-note">This index does not supply measured vehicle coverage or price changes. Open a definition to browse matching captured vehicles.</p>
      <div className="market-definition-filters">
        <label>Search definitions
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or description" />
        </label>
        <label>Manager
          <select value={managerFilter} onChange={e => setManagerFilter(e.target.value as 'all' | 'ai' | 'human')}>
            <option value="all">All</option><option value="ai">AI</option><option value="human">Human</option>
          </select>
        </label>
      </div>
      {!loading && !error && rows.length === 0 && <section className="card market-definition-empty">
        <h2>No segment definitions returned</h2>
        <p>There are no definitions available from this read.</p>
        {!hasSession && <Link to="/login" className="button">Sign in</Link>}
      </section>}
      {!loading && rows.length > 0 && filtered.length === 0 && <section className="card market-definition-empty">
        <h2>No definitions match these filters</h2>
        <button className="button" onClick={() => { setQuery(''); setManagerFilter('all'); }}>Clear filters</button>
      </section>}
      {Object.entries(grouped).map(([groupName, items]) => <section key={groupName} className="market-definition-group">
        <h2>{groupName} <span>({items.length})</span></h2>
        <div className="market-definition-grid">
          {items.map(row => <Link key={row.segment_id} to={`/market/segments/${row.slug}`} className="card market-definition-card">
            <div className="market-definition-title"><strong>{row.name}</strong><span>{row.manager_type === 'ai' ? 'AI managed' : row.manager_type === 'human' ? 'Human managed' : 'Manager not reported'}</span></div>
            <dl>
              <dt>Years</dt><dd>{row.year_min == null && row.year_max == null ? 'Any year' : `${row.year_min ?? 'Any'}–${row.year_max ?? 'Any'}`}</dd>
              <dt>Makes</dt><dd>{row.makes?.length ? row.makes.join(', ') : 'Any make'}</dd>
              <dt>Model keywords</dt><dd>{row.model_keywords?.length ? row.model_keywords.join(', ') : 'Any model'}</dd>
            </dl>
            {row.description && <p>{row.description}</p>}
            <span className="market-definition-open">Browse matching vehicles →</span>
          </Link>)}
        </div>
      </section>)}
    </div>
  );
}
