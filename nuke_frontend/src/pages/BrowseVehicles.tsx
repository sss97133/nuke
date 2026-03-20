import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useSearch, type BrowseParams, type BrowseResult, type BrowseStatsData } from '../components/layout/hooks/useSearch';

const PAGE_SIZE = 50;

const fmt = (n: number | null | undefined) => n != null ? n.toLocaleString() : '—';
const fmtPrice = (n: number | null | undefined) => {
  if (!n) return '—';
  return '$' + n.toLocaleString();
};

const ERA_LABELS: Record<string, string> = {
  'pre-war': 'PRE-WAR', 'post-war': 'POST-WAR', 'classic': 'CLASSIC',
  'malaise': 'MALAISE', 'modern-classic': 'MODERN CLASSIC',
  'modern': 'MODERN', 'contemporary': 'CONTEMPORARY',
};

/* ═══════════════════════════════════════════
   STATS BAR — black, pipe-separated
   ═══════════════════════════════════════════ */
const StatsBar: React.FC<{ make: string; stats: BrowseStatsData | null }> = ({ make, stats }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '10px 16px',
    background: 'var(--text)',
    color: 'var(--surface-elevated)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    flexWrap: 'wrap',
  }}>
    <span>{make || 'ALL VEHICLES'}</span>
    {stats && (
      <>
        <span style={{ color: '#444' }}>|</span>
        <span>{fmt(stats.total)} VEHICLES</span>
        <span style={{ color: '#444' }}>|</span>
        <span>{fmt(stats.with_images)} WITH IMAGES</span>
        <span style={{ color: '#444' }}>|</span>
        <span>{fmt(stats.with_price)} WITH PRICE</span>
        {stats.avg_price && (
          <>
            <span style={{ color: '#444' }}>|</span>
            <span style={{ fontFamily: "'Courier New', monospace" }}>
              AVG {fmtPrice(Math.round(stats.avg_price))}
            </span>
          </>
        )}
      </>
    )}
  </div>
);

/* ═══════════════════════════════════════════
   VIEW TOGGLES — connected buttons
   ═══════════════════════════════════════════ */
type ViewMode = 'grid' | 'list';

const ViewToggles: React.FC<{ active: ViewMode; onChange: (m: ViewMode) => void }> = ({ active, onChange }) => {
  const modes: { id: ViewMode; label: string }[] = [
    { id: 'grid', label: 'GRID' },
    { id: 'list', label: 'LIST' },
  ];
  return (
    <div style={{ display: 'flex', gap: 0 }}>
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '6px 12px',
            border: '2px solid',
            borderColor: active === m.id ? 'var(--text)' : 'var(--border, #bdbdbd)',
            background: active === m.id ? 'var(--text)' : 'var(--surface, #fff)',
            color: active === m.id ? 'var(--surface-elevated)' : 'var(--text, #000)',
            cursor: 'pointer',
            marginRight: -2,
            position: 'relative',
            zIndex: active === m.id ? 1 : 0,
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════
   TOOLBAR — view toggles + sort
   ═══════════════════════════════════════════ */
const Toolbar: React.FC<{
  viewMode: ViewMode;
  onViewChange: (m: ViewMode) => void;
  sortBy: string;
  sortDir: string;
  onSortChange: (sb: string, sd: string) => void;
  imagesOnly: boolean;
  onImagesToggle: () => void;
  total: number;
  loaded: number;
}> = ({ viewMode, onViewChange, sortBy, sortDir, onSortChange, imagesOnly, onImagesToggle, total, loaded }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: '2px solid var(--border, #bdbdbd)',
    flexWrap: 'wrap',
    gap: 8,
  }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <ViewToggles active={viewMode} onChange={onViewChange} />
      <span style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 9,
        color: 'var(--text-secondary, #666)',
        letterSpacing: '0.04em',
      }}>
        {loaded > 0 ? `${fmt(loaded)} OF ${fmt(total)}` : ''}
      </span>
    </div>

    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary, #777)',
      }}>SORT:</span>
      <select
        value={`${sortBy}-${sortDir}`}
        onChange={(e) => {
          const [sb, sd] = e.target.value.split('-');
          onSortChange(sb, sd);
        }}
        style={{
          padding: '3px 8px',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          border: '2px solid var(--border, #bdbdbd)',
          background: 'var(--surface, #fff)',
          color: 'var(--text, #000)',
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

      <button
        onClick={onImagesToggle}
        style={{
          padding: '3px 10px',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontFamily: 'Arial, sans-serif',
          border: '2px solid',
          borderColor: imagesOnly ? 'var(--text)' : 'var(--border, #bdbdbd)',
          background: imagesOnly ? 'var(--text)' : 'var(--surface, #fff)',
          color: imagesOnly ? 'var(--surface-elevated)' : 'var(--text, #000)',
          cursor: 'pointer',
        }}
      >
        {imagesOnly ? 'IMAGES ONLY' : 'SHOW ALL'}
      </button>
    </div>
  </div>
);

/* ═══════════════════════════════════════════
   FILTER ROW — label + pills
   ═══════════════════════════════════════════ */
const FilterRow: React.FC<{
  label: string;
  items: Array<{ key: string; display: string; count?: number }>;
  activeKey: string;
  onToggle: (key: string) => void;
  maxVisible?: number;
}> = ({ label, items, activeKey, onToggle, maxVisible = 10 }) => {
  if (items.length === 0) return null;
  const visible = items.slice(0, maxVisible);
  const overflow = items.length - maxVisible;
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '10px 16px',
      borderBottom: '2px solid var(--surface-alt, #ebebeb)',
      flexWrap: 'wrap',
      alignItems: 'center',
    }}>
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary, #777)',
        marginRight: 4,
        whiteSpace: 'nowrap',
      }}>{label}</span>
      {visible.map((item) => {
        const isActive = activeKey.toLowerCase() === item.key.toLowerCase();
        return (
          <button
            key={item.key}
            onClick={() => onToggle(item.key)}
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '3px 8px',
              border: '2px solid',
              borderColor: isActive ? 'var(--accent, #ff5f00)' : 'var(--border, #ccc)',
              background: 'var(--surface, #fff)',
              color: isActive ? 'var(--accent, #ff5f00)' : 'var(--text-secondary, #444)',
              cursor: 'pointer',
              transition: 'border-color 0.12s, color 0.12s',
              whiteSpace: 'nowrap',
            }}
          >
            {item.display}
            {item.count != null && (
              <span style={{
                marginLeft: 4,
                fontFamily: "'Courier New', monospace",
                opacity: 0.5,
              }}>{fmt(item.count)}</span>
            )}
          </button>
        );
      })}
      {overflow > 0 && (
        <span style={{
          fontSize: 9,
          color: 'var(--text-secondary, #777)',
          letterSpacing: '0.04em',
        }}>+{overflow}</span>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════
   RESULT CARD — grid mode
   ═══════════════════════════════════════════ */
const ResultCard: React.FC<{ v: BrowseResult; hideMake?: boolean }> = ({ v, hideMake }) => {
  const title = hideMake
    ? [v.year, v.model].filter(Boolean).join(' ')
    : [v.year, v.make, v.model].filter(Boolean).join(' ');
  return (
    <Link
      to={`/vehicle/${v.id}`}
      style={{
        border: '2px solid var(--surface-alt, #ebebeb)',
        background: 'var(--surface, #fff)',
        display: 'flex',
        flexDirection: 'column',
        textDecoration: 'none',
        color: 'var(--text, #000)',
        transition: 'border-color 0.12s',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent, #ff5f00)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--surface-alt, #ebebeb)')}
    >
      <div style={{
        width: '100%',
        height: 110,
        background: v.primary_image_url
          ? `url(${v.primary_image_url}) center/cover`
          : 'var(--surface-alt, #ebebeb)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: '2px solid var(--surface-alt, #ebebeb)',
      }}>
        {!v.primary_image_url && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary, #999)',
          }}>NO IMAGE</span>
        )}
      </div>
      <div style={{ padding: 10 }}>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {title || 'UNKNOWN'}
        </div>
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 9,
          color: 'var(--text-secondary, #777)',
          lineHeight: 1.4,
          marginTop: 4,
        }}>
          {fmtPrice(v.sold_price)}
          {v.status ? ` · ${v.status.toUpperCase()}` : ''}
          {v.source ? ` · ${v.source.toUpperCase()}` : ''}
        </div>
      </div>
    </Link>
  );
};

/* ═══════════════════════════════════════════
   RESULT ROW — list mode
   ═══════════════════════════════════════════ */
const ResultRow: React.FC<{ v: BrowseResult; hideMake?: boolean }> = ({ v, hideMake }) => {
  const title = hideMake
    ? [v.year, v.model].filter(Boolean).join(' ')
    : [v.year, v.make, v.model].filter(Boolean).join(' ');
  return (
    <Link
      to={`/vehicle/${v.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 16px',
        borderBottom: '1px solid var(--surface-alt, #ebebeb)',
        textDecoration: 'none',
        color: 'var(--text, #000)',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-alt, #f0f0f0)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{
        width: 64,
        height: 40,
        flexShrink: 0,
        background: v.primary_image_url
          ? `url(${v.primary_image_url}) center/cover`
          : 'var(--surface-alt, #ebebeb)',
        border: '1px solid var(--surface-alt, #ebebeb)',
      }} />
      <div style={{
        flex: 1,
        fontSize: 10,
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
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {fmtPrice(v.sold_price)}
      </div>
      <div style={{
        fontSize: 9,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary, #777)',
        whiteSpace: 'nowrap',
        minWidth: 60,
        textAlign: 'right',
      }}>
        {v.source || ''}
      </div>
    </Link>
  );
};

/* ═══════════════════════════════════════════
   MAIN BROWSE PAGE
   ═══════════════════════════════════════════ */
const BrowseVehicles: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = useSearch();

  const make = searchParams.get('make') || '';
  const model = searchParams.get('model') || '';
  const era = searchParams.get('era') || '';
  const bodyStyle = searchParams.get('bodyStyle') || '';

  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('sold_price');
  const [sortDir, setSortDir] = useState('desc');
  const [imagesOnly, setImagesOnly] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [allResults, setAllResults] = useState<BrowseResult[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isInitialLoad = useRef(true);

  const buildParams = useCallback((p: number): BrowseParams => {
    const params: BrowseParams = { page: p, pageSize: PAGE_SIZE, sortBy, sortDir };
    if (make) params.make = make;
    if (model) params.model = model;
    if (era) params.era = era;
    if (bodyStyle) params.bodyStyle = bodyStyle;
    if (imagesOnly) params.hasImage = true;
    return params;
  }, [make, model, era, bodyStyle, sortBy, sortDir, imagesOnly]);

  // Reset on filter change
  useEffect(() => {
    setPage(1);
    setAllResults([]);
    isInitialLoad.current = true;
    search.executeBrowse(buildParams(1));
  }, [make, model, era, bodyStyle, sortBy, sortDir, imagesOnly]);

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

  const stats = search.browseStats;
  const total = search.totalCount;
  const loading = search.browseLoading && allResults.length === 0;

  const toggleParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (next.get(key)?.toLowerCase() === value.toLowerCase()) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next);
  };

  // Build filter items from stats
  const modelItems = (stats?.by_model || []).map(m => ({
    key: m.model, display: m.model.length > 22 ? m.model.slice(0, 22) + '…' : m.model, count: m.count,
  }));
  const eraItems = (stats?.by_era || []).map(e => ({
    key: e.era, display: ERA_LABELS[e.era] || e.era.toUpperCase(), count: e.count,
  }));

  return (
    <div style={{ minHeight: '100vh', border: '2px solid var(--border, #bdbdbd)', background: 'var(--surface, #fff)' }}>
      {/* Stats bar */}
      <StatsBar make={make} stats={stats} />

      {/* Toolbar */}
      <Toolbar
        viewMode={viewMode}
        onViewChange={setViewMode}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(sb, sd) => { setSortBy(sb); setSortDir(sd); }}
        imagesOnly={imagesOnly}
        onImagesToggle={() => setImagesOnly(!imagesOnly)}
        total={total}
        loaded={allResults.length}
      />

      {/* Filters */}
      <FilterRow
        label="MODEL"
        items={modelItems}
        activeKey={model}
        onToggle={(m) => toggleParam('model', m)}
        maxVisible={8}
      />
      <FilterRow
        label="ERA"
        items={eraItems}
        activeKey={era}
        onToggle={(e) => toggleParam('era', e)}
      />

      {/* Results */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            color: 'var(--text-secondary, #666)',
          }}>SEARCHING...</div>
        </div>
      ) : allResults.length === 0 && !search.browseLoading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>NO RESULTS</div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-secondary, #666)',
          }}>Try adjusting filters or search for a different make.</div>
        </div>
      ) : viewMode === 'grid' ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 2,
          padding: 2,
        }}>
          {allResults.map((v) => (
            <ResultCard key={v.id} v={v} hideMake={!!make} />
          ))}
        </div>
      ) : (
        <div>
          {allResults.map((v) => (
            <ResultRow key={v.id} v={v} hideMake={!!make} />
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
          color: 'var(--text-secondary, #666)',
        }}>LOADING MORE...</div>
      )}

      {/* End */}
      {allResults.length >= total && total > 0 && !search.browseLoading && (
        <div style={{
          padding: '20px 0 40px',
          textAlign: 'center',
          fontFamily: "'Courier New', monospace",
          fontSize: 9,
          letterSpacing: '0.08em',
          color: 'var(--text-disabled, #999)',
        }}>{fmt(total)} VEHICLES · END</div>
      )}
    </div>
  );
};

export default BrowseVehicles;
