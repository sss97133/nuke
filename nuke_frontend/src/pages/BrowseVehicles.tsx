import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSearch, type BrowseParams, type BrowseResult, type BrowseStatsData } from '../components/layout/hooks/useSearch';

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

interface TreemapNode {
  name: string;
  count: number;
  value: number;
  median_price?: number;
  min_price?: number;
  max_price?: number;
  sold_count?: number;
  auction_count?: number;
  avg_bids?: number;
  avg_watchers?: number;
}

// ────────────────────────────────────────────────────────────
// FORMATTERS
// ────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) => n != null ? n.toLocaleString() : '--';

const fmtPrice = (n: number | null | undefined) => {
  if (!n) return '--';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + Math.round(n / 1_000) + 'K';
  return '$' + n.toLocaleString();
};

const fmtPriceFull = (n: number | null | undefined) => {
  if (!n) return '--';
  return '$' + n.toLocaleString();
};

// ────────────────────────────────────────────────────────────
// DATA HOOKS
// ────────────────────────────────────────────────────────────

function useBrands() {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc('treemap_by_brand').then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  return { data, loading };
}

function useModels(make: string | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!make) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    supabase.rpc('treemap_models_by_brand', { p_make: make }).then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [make]);
  return { data, loading };
}

// ────────────────────────────────────────────────────────────
// BREADCRUMB
// ────────────────────────────────────────────────────────────

const Breadcrumb: React.FC<{ make: string; model: string }> = ({ make, model }) => {
  const crumbs: { label: string; to: string }[] = [
    { label: 'ALL MAKES', to: '/browse' },
  ];
  if (make) {
    crumbs.push({ label: make.toUpperCase(), to: `/browse?make=${encodeURIComponent(make)}` });
  }
  if (model) {
    crumbs.push({ label: model.toUpperCase(), to: `/browse?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}` });
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '10px 16px',
      background: '#000',
      color: '#fff',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.12em',
      fontFamily: 'Arial, sans-serif',
      textTransform: 'uppercase',
    }}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <React.Fragment key={c.to}>
            {i > 0 && <span style={{ color: '#555', margin: '0 2px' }}>/</span>}
            {isLast ? (
              <span>{c.label}</span>
            ) : (
              <Link to={c.to} style={{ color: '#888', textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={e => (e.currentTarget.style.color = '#888')}
              >{c.label}</Link>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ────────────────────────────────────────────────────────────
// SEARCH INPUT
// ────────────────────────────────────────────────────────────

const SearchInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <div style={{ padding: '12px 16px', borderBottom: '2px solid #ebebeb' }}>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        padding: '8px 12px',
        border: '2px solid #ebebeb',
        borderRadius: 0,
        background: '#f5f5f5',
        fontFamily: 'Arial, sans-serif',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        outline: 'none',
        color: '#000',
        boxSizing: 'border-box',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = '#000')}
      onBlur={e => (e.currentTarget.style.borderColor = '#ebebeb')}
    />
  </div>
);

// ────────────────────────────────────────────────────────────
// MAKE CELL — shows make name, count, top 3 models
// ────────────────────────────────────────────────────────────

const MakeCell: React.FC<{ node: TreemapNode; topModels: TreemapNode[] | null }> = ({ node, topModels }) => {
  return (
    <Link
      to={`/browse?make=${encodeURIComponent(node.name)}`}
      style={{
        border: '2px solid #ebebeb',
        background: '#f5f5f5',
        display: 'flex',
        flexDirection: 'column',
        textDecoration: 'none',
        color: '#000',
        padding: 14,
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer',
        minHeight: 100,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#000')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#ebebeb')}
    >
      {/* Make initial / logo placeholder */}
      <div style={{
        width: 32,
        height: 32,
        background: '#000',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, sans-serif',
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.04em',
        marginBottom: 10,
        flexShrink: 0,
      }}>
        {node.name.charAt(0).toUpperCase()}
      </div>

      {/* Make name */}
      <div style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        lineHeight: 1.2,
        marginBottom: 6,
      }}>
        {node.name}
      </div>

      {/* Count */}
      <div style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 11,
        color: '#666',
        lineHeight: 1.5,
      }}>
        <span>{fmt(node.count)} vehicles</span>
      </div>

      {/* Median price */}
      {node.median_price && (
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 10,
          color: '#999',
          marginTop: 2,
        }}>
          median {fmtPrice(node.median_price)}
        </div>
      )}

      {/* Top 3 models */}
      {topModels && topModels.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid #e0e0e0', paddingTop: 8 }}>
          {topModels.slice(0, 3).map(m => (
            <div key={m.name} style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#888',
              lineHeight: 1.8,
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                marginRight: 8,
              }}>{m.name}</span>
              <span style={{ fontFamily: "'Courier New', monospace", color: '#aaa', flexShrink: 0 }}>{fmt(m.count)}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
};

// ────────────────────────────────────────────────────────────
// MODEL CELL — shows model name, count, median price
// ────────────────────────────────────────────────────────────

const ModelCell: React.FC<{ node: TreemapNode; make: string }> = ({ node, make }) => {
  return (
    <Link
      to={`/browse?make=${encodeURIComponent(make)}&model=${encodeURIComponent(node.name)}`}
      style={{
        border: '2px solid #ebebeb',
        background: '#f5f5f5',
        display: 'flex',
        flexDirection: 'column',
        textDecoration: 'none',
        color: '#000',
        padding: 14,
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer',
        minHeight: 80,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#000')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#ebebeb')}
    >
      {/* Model name */}
      <div style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        lineHeight: 1.2,
        marginBottom: 6,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {node.name}
      </div>

      {/* Count */}
      <div style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 11,
        color: '#666',
        lineHeight: 1.5,
      }}>
        {fmt(node.count)} vehicles
      </div>

      {/* Prices */}
      <div style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 10,
        color: '#999',
        marginTop: 4,
        lineHeight: 1.5,
      }}>
        {node.median_price && <div>median {fmtPrice(node.median_price)}</div>}
      </div>

      {/* Sold ratio */}
      {node.sold_count != null && node.auction_count != null && node.auction_count > 0 && (
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 9,
          color: '#aaa',
          marginTop: 4,
        }}>
          {Math.round((node.sold_count / node.auction_count) * 100)}% sold ({fmt(node.sold_count)}/{fmt(node.auction_count)})
        </div>
      )}
    </Link>
  );
};

// ────────────────────────────────────────────────────────────
// LEVEL 0 — ALL MAKES GRID
// ────────────────────────────────────────────────────────────

const MakesGrid: React.FC = () => {
  const { data: brands, loading } = useBrands();
  const [filter, setFilter] = useState('');
  const [topModelsMap, setTopModelsMap] = useState<Record<string, TreemapNode[]>>({});

  // Fetch top models for each visible make (batched, top 20 makes)
  useEffect(() => {
    if (!brands) return;
    let cancelled = false;
    const topMakes = brands.slice(0, 20);
    Promise.all(
      topMakes.map(b =>
        supabase.rpc('treemap_models_by_brand', { p_make: b.name })
          .then(({ data }) => ({ make: b.name, models: (data as TreemapNode[] || []).slice(0, 3) }))
      )
    ).then(results => {
      if (cancelled) return;
      const map: Record<string, TreemapNode[]> = {};
      results.forEach(r => { map[r.make] = r.models; });
      setTopModelsMap(map);
    });
    return () => { cancelled = true; };
  }, [brands]);

  const filtered = useMemo(() => {
    if (!brands) return [];
    if (!filter) return brands;
    const q = filter.toLowerCase();
    return brands.filter(b => b.name.toLowerCase().includes(q));
  }, [brands, filter]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          letterSpacing: '0.08em',
          color: '#666',
        }}>LOADING MAKES...</div>
      </div>
    );
  }

  return (
    <>
      <SearchInput value={filter} onChange={setFilter} placeholder="FILTER MAKES..." />

      {/* Summary */}
      <div style={{
        padding: '8px 16px',
        fontFamily: "'Courier New', monospace",
        fontSize: 10,
        color: '#999',
        letterSpacing: '0.04em',
        borderBottom: '1px solid #ebebeb',
      }}>
        {filtered.length} MAKES
        {filter && ` MATCHING "${filter.toUpperCase()}"`}
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 2,
        padding: 2,
      }}>
        {filtered.map(node => (
          <MakeCell key={node.name} node={node} topModels={topModelsMap[node.name] || null} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>NO MAKES FOUND</div>
          <div style={{ fontSize: 10, color: '#666' }}>
            Try a different search term.
          </div>
        </div>
      )}
    </>
  );
};

// ────────────────────────────────────────────────────────────
// LEVEL 1 — MODELS GRID FOR A MAKE
// ────────────────────────────────────────────────────────────

const ModelsGrid: React.FC<{ make: string }> = ({ make }) => {
  const { data: models, loading } = useModels(make);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!models) return [];
    if (!filter) return models;
    const q = filter.toLowerCase();
    return models.filter(m => m.name.toLowerCase().includes(q));
  }, [models, filter]);

  const totalVehicles = models?.reduce((s, m) => s + m.count, 0) || 0;

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          letterSpacing: '0.08em',
          color: '#666',
        }}>LOADING MODELS...</div>
      </div>
    );
  }

  return (
    <>
      <SearchInput value={filter} onChange={setFilter} placeholder={`FILTER ${make.toUpperCase()} MODELS...`} />

      {/* Summary */}
      <div style={{
        padding: '8px 16px',
        fontFamily: "'Courier New', monospace",
        fontSize: 10,
        color: '#999',
        letterSpacing: '0.04em',
        borderBottom: '1px solid #ebebeb',
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <span>{filtered.length} MODELS</span>
        <span>{fmt(totalVehicles)} VEHICLES</span>
        {filter && <span>MATCHING "{filter.toUpperCase()}"</span>}
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 2,
        padding: 2,
      }}>
        {filtered.map(node => (
          <ModelCell key={node.name} node={node} make={make} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>NO MODELS FOUND</div>
          <div style={{ fontSize: 10, color: '#666' }}>
            Try a different search term.
          </div>
        </div>
      )}
    </>
  );
};

// ────────────────────────────────────────────────────────────
// LEVEL 2 — VEHICLE LIST FOR MAKE + MODEL
// ────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const VehicleResultCard: React.FC<{ v: BrowseResult }> = ({ v }) => {
  const title = [v.year, v.make, v.model].filter(Boolean).join(' ');
  return (
    <Link
      to={`/vehicle/${v.id}`}
      style={{
        border: '2px solid #ebebeb',
        background: '#f5f5f5',
        display: 'flex',
        flexDirection: 'column',
        textDecoration: 'none',
        color: '#000',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        overflow: 'hidden',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#000')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#ebebeb')}
    >
      <div style={{
        width: '100%',
        height: 120,
        background: v.primary_image_url
          ? `url(${v.primary_image_url}) center/cover`
          : '#ebebeb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: '2px solid #ebebeb',
      }}>
        {!v.primary_image_url && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#999',
          }}>NO IMAGE</span>
        )}
      </div>
      <div style={{ padding: 10 }}>
        <div style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {title || 'UNKNOWN'}
        </div>
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 10,
          color: '#666',
          lineHeight: 1.5,
          marginTop: 4,
        }}>
          {fmtPriceFull(v.sold_price)}
          {v.source ? ` \u00b7 ${v.source.toUpperCase()}` : ''}
        </div>
      </div>
    </Link>
  );
};

const VehicleList: React.FC<{ make: string; model: string }> = ({ make, model }) => {
  const search = useSearch();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('sold_price');
  const [sortDir, setSortDir] = useState('desc');
  const [allResults, setAllResults] = useState<BrowseResult[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  const buildParams = useCallback((p: number): BrowseParams => ({
    page: p,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
    make,
    model,
    hasImage: false,
  }), [make, model, sortBy, sortDir]);

  // Reset on filter change
  useEffect(() => {
    setPage(1);
    setAllResults([]);
    isInitialLoad.current = true;
    search.executeBrowse(buildParams(1));
  }, [make, model, sortBy, sortDir]);

  // Append results
  useEffect(() => {
    if (search.browseLoading) return;
    const rows = search.browseResults;
    if (isInitialLoad.current) {
      setAllResults(rows);
      isInitialLoad.current = false;
    } else {
      setAllResults(prev => {
        const ids = new Set(prev.map(r => r.id));
        return [...prev, ...rows.filter(r => !ids.has(r.id))];
      });
    }
    setLoadingMore(false);
  }, [search.browseResults, search.browseLoading]);

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !search.browseLoading && !loadingMore && allResults.length < search.totalCount) {
        const nextPage = page + 1;
        setPage(nextPage);
        setLoadingMore(true);
        isInitialLoad.current = false;
        search.executeBrowse(buildParams(nextPage));
      }
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [allResults.length, search.totalCount, search.browseLoading, loadingMore, page, buildParams]);

  const total = search.totalCount;
  const loading = search.browseLoading && allResults.length === 0;

  return (
    <>
      {/* Sort bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '2px solid #ebebeb',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 10,
          color: '#999',
          letterSpacing: '0.04em',
        }}>
          {total > 0 ? `${fmt(allResults.length)} OF ${fmt(total)} VEHICLES` : ''}
        </span>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#777',
          }}>SORT:</span>
          <select
            value={`${sortBy}-${sortDir}`}
            onChange={e => {
              const [sb, sd] = e.target.value.split('-');
              setSortBy(sb);
              setSortDir(sd);
            }}
            style={{
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              border: '2px solid #ebebeb',
              borderRadius: 0,
              background: '#f5f5f5',
              color: '#000',
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
            }}
          >
            <option value="sold_price-desc">PRICE HIGH</option>
            <option value="sold_price-asc">PRICE LOW</option>
            <option value="year-desc">YEAR NEW</option>
            <option value="year-asc">YEAR OLD</option>
            <option value="created_at-desc">RECENT</option>
          </select>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            color: '#666',
          }}>LOADING VEHICLES...</div>
        </div>
      ) : allResults.length === 0 && !search.browseLoading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>NO VEHICLES FOUND</div>
          <div style={{ fontSize: 10, color: '#666' }}>
            No {make} {model} vehicles in the database yet.
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 2,
          padding: 2,
        }}>
          {allResults.map(v => (
            <VehicleResultCard key={v.id} v={v} />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {/* Loading more */}
      {(loadingMore || search.browseLoading) && allResults.length > 0 && (
        <div style={{
          padding: 20,
          textAlign: 'center',
          fontFamily: "'Courier New', monospace",
          fontSize: 9,
          letterSpacing: '0.08em',
          color: '#666',
        }}>LOADING MORE...</div>
      )}

      {/* End marker */}
      {allResults.length >= total && total > 0 && !search.browseLoading && (
        <div style={{
          padding: '20px 0 40px',
          textAlign: 'center',
          fontFamily: "'Courier New', monospace",
          fontSize: 9,
          letterSpacing: '0.08em',
          color: '#999',
        }}>{fmt(total)} VEHICLES -- END</div>
      )}
    </>
  );
};

// ════════════════════════════════════════════════════════════
// MAIN BROWSE PAGE — TOPOLOGY EXPLORER
// ════════════════════════════════════════════════════════════

const BrowseVehicles: React.FC = () => {
  const [searchParams] = useSearchParams();
  const make = searchParams.get('make') || '';
  const model = searchParams.get('model') || '';

  // Determine depth: 0 = all makes, 1 = models for a make, 2 = vehicles for make+model
  const depth = model ? 2 : make ? 1 : 0;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f5f5',
      fontFamily: 'Arial, sans-serif',
    }}>
      {/* Breadcrumb nav */}
      <Breadcrumb make={make} model={model} />

      {/* Content by depth */}
      {depth === 0 && <MakesGrid />}
      {depth === 1 && <ModelsGrid make={make} />}
      {depth === 2 && <VehicleList make={make} model={model} />}
    </div>
  );
};

export default BrowseVehicles;
