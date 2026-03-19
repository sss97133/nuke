import { useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { FeedItem } from '../feed/types';
import ContentCard from '../feed/ContentCard';
import VehicleCardDense from '../vehicles/VehicleCardDense';
import { highlightSearchTerm } from '../../utils/searchHighlight';
import type { SearchResult } from '../../types/search';
import '../../styles/unified-design-system.css';

type SearchFilter =
  | 'all'
  | 'vehicle'
  | 'organization'
  | 'shop'
  | 'part'
  | 'user'
  | 'timeline_event'
  | 'image'
  | 'document'
  | 'auction'
  | 'reference'
  | 'source';

interface SearchResultsProps {
  results: SearchResult[];
  searchSummary: string;
  loading?: boolean;
  activeFilter?: SearchFilter;
  onFilterChange?: (next: SearchFilter) => void;
  totalCount?: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

const SearchResults = ({ results, searchSummary, loading = false, activeFilter, onFilterChange, totalCount, hasMore, onLoadMore, loadingMore }: SearchResultsProps) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('q') || '';
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'map'>('cards');
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'location' | 'price_asc' | 'price_desc' | 'year_desc' | 'year_asc'>('relevance');
  const [internalFilter, setInternalFilter] = useState<SearchFilter>('all');
  const [showBazaar, setShowBazaar] = useState(false);
  const filterBy = activeFilter ?? internalFilter;
  const setFilterBy = onFilterChange ?? setInternalFilter;

  const getResultHref = (result: SearchResult): string | undefined => {
    switch (result.type) {
      case 'vehicle':
        return `/vehicle/${result.id}`;
      case 'organization':
      case 'shop':
        return `/org/${result.id}`;
      case 'user':
        // Check if this is an external identity (BaT member, etc.)
        if (result.id?.startsWith('external_')) {
          const externalId = result.id.replace('external_', '');
          return `/profile/external/${externalId}`;
        }
        // Check if metadata has external_identity_id
        if (result.metadata?.external_identity_id) {
          return `/profile/external/${result.metadata.external_identity_id}`;
        }
        return `/profile/${result.id}`;
      case 'timeline_event':
        return result.metadata?.vehicle_id ? `/vehicle/${result.metadata.vehicle_id}?t=timeline&event=${result.id}` : undefined;
      case 'image':
        return result.metadata?.vehicle_id ? `/vehicle/${result.metadata.vehicle_id}` : `/images/${result.id}`;
      case 'auction':
        return result.metadata?.listing_url ? String(result.metadata.listing_url) : undefined;
      case 'source':
        return result.metadata?.url ? String(result.metadata.url) : (result.metadata?.domain ? `https://${String(result.metadata.domain)}` : undefined);
      default:
        return undefined;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'var(--success)';
      case 'stagnant': return 'var(--error)';
      case 'moderate': return 'var(--warning)';
      case 'for_sale': return 'var(--accent)';
      default: return 'var(--text-secondary)';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'vehicle': return 'V';
      case 'organization': return 'O';
      case 'shop': return 'S';
      case 'part': return 'P';
      case 'timeline_event': return 'E';
      case 'user': return 'U';
      case 'image': return 'IMG';
      case 'document': return 'DOC';
      case 'auction': return 'A';
      case 'reference': return 'REF';
      case 'source': return 'SRC';
      default: return '';
    }
  };

  const typeLabels: Record<string, string> = {
    vehicle: 'Vehicles',
    organization: 'Organizations',
    shop: 'Shops',
    part: 'Parts & Tools',
    user: 'People',
    timeline_event: 'Timeline',
    image: 'Images',
    document: 'Documents',
    auction: 'Auctions',
    reference: 'References',
    source: 'Sources'
  };

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach((result) => {
      counts[result.type] = (counts[result.type] || 0) + 1;
    });
    return counts;
  }, [results]);

  const bazaarGroups = useMemo(() => {
    const groups = [
      {
        id: 'assets',
        title: 'Assets',
        helper: 'Vehicles, auctions, and parts',
        types: ['vehicle', 'auction', 'part'] as SearchFilter[]
      },
      {
        id: 'services',
        title: 'Organizations & Shops',
        helper: 'Builders, sellers, and service providers',
        types: ['organization', 'shop'] as SearchFilter[]
      },
      {
        id: 'people',
        title: 'People',
        helper: 'Members, sellers, and external identities',
        types: ['user'] as SearchFilter[]
      },
      {
        id: 'evidence',
        title: 'Evidence & Activity',
        helper: 'Timeline, docs, images, references',
        types: ['timeline_event', 'document', 'image', 'reference', 'source'] as SearchFilter[]
      }
    ];

    return groups
      .map((group) => {
        const groupResults = results.filter((result) => group.types.includes(result.type as SearchFilter));
        return { ...group, results: groupResults, count: groupResults.length };
      })
      .filter((group) => group.count > 0);
  }, [results]);

  const filteredAndSortedResults = results
    .filter(result => filterBy === 'all' || result.type === filterBy)
    .sort((a, b) => {
      switch (sortBy) {
        case 'relevance':
          return b.relevance_score - a.relevance_score;
        case 'date':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'location':
          if (a.location && !b.location) return -1;
          if (!a.location && b.location) return 1;
          return 0;
        case 'price_asc': {
          const pa = (a.metadata as any)?.sale_price ?? Infinity;
          const pb = (b.metadata as any)?.sale_price ?? Infinity;
          return pa - pb;
        }
        case 'price_desc': {
          const pa = (a.metadata as any)?.sale_price ?? -1;
          const pb = (b.metadata as any)?.sale_price ?? -1;
          return pb - pa;
        }
        case 'year_desc': {
          const ya = (a.metadata as any)?.year ?? 0;
          const yb = (b.metadata as any)?.year ?? 0;
          return yb - ya;
        }
        case 'year_asc': {
          const ya = (a.metadata as any)?.year ?? Infinity;
          const yb = (b.metadata as any)?.year ?? Infinity;
          return ya - yb;
        }
        default:
          return 0;
      }
    });

  const convertToFeedItem = (result: SearchResult): FeedItem => ({
    id: result.id,
    type: result.type as any,
    title: result.title,
    description: result.description,
    image_url: result.image_url,
    user_id: result.metadata?.created_by || '',
    user_name: result.metadata?.owner || result.metadata?.username || 'Unknown User',
    location: result.location,
    metadata: result.metadata,
    created_at: result.created_at
  });

  if (loading) {
    return (
      <div style={{ padding: '0' }}>
        <style>{`
          .sk { background: var(--border); animation: skeleton-shimmer 1.5s infinite; }
          @keyframes skeleton-shimmer {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.8; }
          }
        `}</style>
        {/* Fake summary bar */}
        <div style={{ background: 'var(--bg)', border: '2px solid var(--border)', padding: '10px 14px', marginBottom: '12px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="sk" style={{ height: '14px', width: '80px' }} />
          <div className="sk" style={{ height: '12px', width: '160px' }} />
        </div>
        {/* Skeleton vehicle cards grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '12px',
        }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface)' }}>
              <div className="sk" style={{ height: '160px', width: '100%' }} />
              <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="sk" style={{ height: '13px', width: '70%' }} />
                <div className="sk" style={{ height: '11px', width: '45%' }} />
                <div className="sk" style={{ height: '11px', width: '55%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="search-results" style={{ padding: '0' }}>
      {/* Search Summary header — only show if we have results or a summary message */}
      {(results.length > 0 || searchSummary) && (
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--text)',
          borderRadius: '0px',
          padding: '10px 14px',
          marginBottom: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            {/* Left: result count + summary */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
              {results.length > 0 && (
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)' }}>
                  {filteredAndSortedResults.length}
                </span>
              )}
              {results.length > 0 && totalCount && totalCount > results.length && filterBy === 'all' && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>of {totalCount.toLocaleString()}</span>
              )}
              {results.length > 0 && filterBy !== 'all' && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>of {results.length}</span>
              )}
              {results.length > 0 && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {filterBy === 'all' ? 'results' : (typeLabels[filterBy] || filterBy).toLowerCase()}
                  {searchQuery ? ` for "${searchQuery}"` : ''}
                </span>
              )}
              {results.length === 0 && searchSummary && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{searchSummary}</span>
              )}
            </div>

            {/* Right: type filter pills */}
            {results.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                {filterBy !== 'all' && (
                  <button
                    style={{
                      padding: '3px 8px',
                      fontSize: '7.5pt',
                      fontWeight: 700,
                      border: '2px solid var(--text)',
                      background: 'var(--text)',
                      color: 'var(--bg)',
                      cursor: 'pointer',
                    }}
                    onClick={() => setFilterBy('all')}
                  >
                    All
                  </button>
                )}
                {(['vehicle', 'organization', 'shop', 'auction', 'user', 'part', 'timeline_event', 'image', 'document', 'reference', 'source'] as SearchFilter[]).map(type => {
                  const count = typeCounts[type] || 0;
                  if (count === 0) return null;
                  const isActive = filterBy === type;
                  return (
                    <button
                      key={type}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: isActive ? 'var(--text)' : 'var(--surface)',
                        border: `2px solid ${isActive ? 'var(--text)' : 'var(--border)'}`,
                        padding: '3px 8px',
                        borderRadius: '0px',
                        fontSize: '7.5pt',
                        fontWeight: 700,
                        color: isActive ? 'var(--bg)' : 'var(--text)',
                        cursor: 'pointer',
                        transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                      onClick={() => { setFilterBy(type); setViewMode('cards'); }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.borderColor = 'var(--text)';
                          e.currentTarget.style.background = 'var(--bg)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.borderColor = 'var(--border)';
                          e.currentTarget.style.background = 'var(--surface)';
                        }
                      }}
                    >
                      <span>{typeLabels[type] || type}</span>
                      <span style={{ opacity: 0.7, fontWeight: 600 }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showBazaar && bazaarGroups.length > 0 && (
        <div style={{
          marginBottom: '20px',
          padding: '12px 16px',
          background: 'var(--surface)',
          border: '2px solid var(--text)',
          borderRadius: '0px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Workstation Lanes
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Jump into the slice you care about.
              </div>
            </div>
            <button
              onClick={() => setShowBazaar(false)}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 700,
                border: '2px solid var(--text)',
                background: 'var(--surface)',
                cursor: 'pointer'
              }}
            >
              Hide lanes
            </button>
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            {bazaarGroups.map((group) => (
              <div key={group.id} style={{ border: '1px solid var(--border)', padding: '10px', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>{group.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{group.helper}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {group.types.map((type) => {
                      const count = typeCounts[type] || 0;
                      if (count === 0) return null;
                      const isActive = filterBy === type;
                      return (
                        <button
                          key={type}
                          onClick={() => {
                            setFilterBy(type);
                            setViewMode('cards');
                          }}
                          style={{
                            padding: '3px 6px',
                            fontSize: '9px',
                            fontWeight: 700,
                            border: `2px solid ${isActive ? 'var(--accent)' : 'var(--text)'}`,
                            background: isActive ? 'var(--bg)' : 'var(--surface)',
                            cursor: 'pointer'
                          }}
                        >
                          {typeLabels[type]} · {count}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
                  {group.results.slice(0, 6).map((result) => {
                    const href = getResultHref(result);
                    const isExternal = href?.startsWith('http');
                    return (
                      <a
                        key={`${group.id}-${result.id}`}
                        href={href}
                        target={isExternal ? '_blank' : undefined}
                        rel={isExternal ? 'noreferrer' : undefined}
                        style={{
                          border: '1px solid var(--border)',
                          padding: '8px',
                          textDecoration: 'none',
                          color: 'var(--text)',
                          background: 'var(--surface)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700 }}>{result.title}</div>
                          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{typeLabels[result.type] || result.type}</div>
                        </div>
                        {result.description && (
                          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {String(result.description).slice(0, 120)}
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls — only show when there are results */}
      {filteredAndSortedResults.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {(['cards', 'list'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '4px 10px',
                  fontSize: '7.5pt',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  border: '2px solid var(--text)',
                  borderRadius: '0px',
                  background: viewMode === mode ? 'var(--text)' : 'var(--surface)',
                  color: viewMode === mode ? 'var(--surface)' : 'var(--text)',
                  cursor: 'pointer',
                  letterSpacing: '0.3px',
                }}
              >
                {mode === 'cards' ? 'Grid' : 'List'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '7.5pt', fontWeight: 600, color: 'var(--text-secondary)' }}>Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                style={{
                  fontSize: '7.5pt',
                  padding: '3px 6px',
                  border: '2px solid var(--text)',
                  borderRadius: '0px',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <option value="relevance">Relevance</option>
                <option value="date">Newest</option>
                <option value="price_asc">Price ↑</option>
                <option value="price_desc">Price ↓</option>
                <option value="year_desc">Year ↓</option>
                <option value="year_asc">Year ↑</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {filteredAndSortedResults.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '56px 24px',
        }}>
          <div style={{
            fontSize: '15px',
            fontWeight: 700,
            color: 'var(--text)',
            marginBottom: '8px',
          }}>
            No results for &ldquo;{searchQuery}&rdquo;
          </div>
          <p style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            margin: '0 0 28px 0',
          }}>
            Try different keywords, check spelling, or search by make and model.
          </p>
          {filterBy !== 'all' && (
            <button
              onClick={() => setFilterBy('all')}
              style={{
                padding: '6px 14px',
                fontSize: '11px',
                fontWeight: 700,
                border: '2px solid var(--text)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                marginBottom: '20px',
              }}
            >
              Remove type filter
            </button>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '400px', margin: '0 auto' }}>
            {['Porsche 911', '1967 Mustang', 'C10', 'Ferrari 308', 'BMW 2002'].map(term => (
              <a
                key={term}
                href={`/search?q=${encodeURIComponent(term)}`}
                style={{
                  padding: '5px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  cursor: 'pointer',
                  transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {term}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <>
          {viewMode === 'cards' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '12px'
            }}>
              {filteredAndSortedResults.map(result => (
                result.type === 'vehicle' ? (
                  <div key={result.id} style={{ position: 'relative' }}>
                    <VehicleCardDense
                      vehicle={{
                        id: result.id,
                        year: result.metadata?.year,
                        make: result.metadata?.make,
                        model: result.metadata?.model,
                        vin: result.metadata?.vin,
                        sale_price: result.metadata?.sale_price,
                        current_value: result.metadata?.current_value,
                        asking_price: result.metadata?.asking_price,
                        mileage: result.metadata?.mileage,
                        transmission: result.metadata?.transmission,
                        is_for_sale: result.metadata?.for_sale ?? result.metadata?.is_for_sale,
                        profile_origin: result.metadata?.profile_origin,
                        ownership_verified: result.metadata?.ownership_verified,
                        view_count: result.metadata?.view_count,
                        image_count: result.metadata?.image_count,
                        event_count: result.metadata?.event_count,
                        observation_count: result.metadata?.observation_count,
                        location:
                          (result.metadata?.city || result.metadata?.state)
                            ? `${result.metadata?.city || ''}${result.metadata?.city && result.metadata?.state ? ', ' : ''}${result.metadata?.state || ''}`.trim()
                            : undefined,
                        primary_image_url: result.image_url,
                        created_at: result.created_at,
                        updated_at: result.created_at,
                      }}
                      viewMode="gallery"
                      showSocial={false}
                      showPriceChange={false}
                      showPriceOverlay={true}
                      showDetailOverlay={true}
                      infoDense={true}
                      thumbnailFit="contain"
                    />
                  </div>
                ) : (
                  <div
                    key={result.id}
                    style={{
                      position: 'relative',
                      transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                      border: '2px solid transparent'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--text)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'transparent';
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      background: 'var(--text)',
                      color: 'var(--bg)',
                      padding: '4px 10px',
                      fontSize: '9px',
                      fontWeight: 700,
                      zIndex: 10,
                    }}>
                      {Math.round(result.relevance_score * 100)}% match
                    </div>

                    <ContentCard item={convertToFeedItem(result)} />
                  </div>
                )
              ))}
            </div>
          )}

          {viewMode === 'list' && (
            <div style={{
              background: 'var(--surface)',
              border: '2px solid var(--text)',
              borderRadius: '0px',
              overflow: 'hidden'
            }}>
              {filteredAndSortedResults.map((result, index) => (
                <div
                  key={result.id}
                  onClick={() => {
                    const href = getResultHref(result);
                    if (!href) return;
                    if (href.startsWith('http://') || href.startsWith('https://')) {
                      window.open(href, '_blank', 'noopener,noreferrer');
                    } else {
                      navigate(href);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px',
                    borderBottom: index < filteredAndSortedResults.length - 1 ? '1px solid var(--text)' : 'none',
                    cursor: 'pointer',
                    transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                    background: 'var(--surface)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface)'}
                >
                  <div style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '0px',
                    background: result.image_url ? `url(${result.image_url}) center/cover` : 'var(--bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    marginRight: '12px',
                    border: '2px solid var(--text)',
                    flexShrink: 0
                  }}>
                    {!result.image_url && (
                      <span style={{ color: 'var(--text-disabled)' }}>{getTypeIcon(result.type)}</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <h4 style={{
                        margin: 0,
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--text)'
                      }}>
                        {result.title}
                      </h4>
                      <div style={{
                        background: 'var(--text)',
                        color: 'var(--bg)',
                        padding: '2px 6px',
                        borderRadius: '0px',
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        {result.type.replace('_', ' ')}
                      </div>
                    </div>

                    {/* Key specs row for vehicles */}
                    {result.type === 'vehicle' && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                        {(result.metadata?.sale_price || result.metadata?.current_value || result.metadata?.asking_price) && (
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)' }}>
                            ${((result.metadata?.sale_price || result.metadata?.current_value || result.metadata?.asking_price) || 0).toLocaleString()}
                          </span>
                        )}
                        {result.metadata?.vin && (
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                            {result.metadata.vin}
                          </span>
                        )}
                        {result.metadata?.mileage && (
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                            {result.metadata.mileage.toLocaleString()} mi
                          </span>
                        )}
                        {result.metadata?.transmission && (
                          <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{result.metadata.transmission}</span>
                        )}
                        {(result.metadata?.image_count > 0 || result.metadata?.event_count > 0 || result.metadata?.observation_count > 0) && (
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                            {result.metadata.image_count > 0 ? `${result.metadata.image_count} img` : ''}
                            {result.metadata.image_count > 0 && (result.metadata.event_count > 0 || result.metadata.observation_count > 0) ? ' · ' : ''}
                            {result.metadata.observation_count > 0 ? `${result.metadata.observation_count} obs` : (result.metadata.event_count > 0 ? `${result.metadata.event_count} evt` : '')}
                          </span>

                        )}
                      </div>
                    )}

                    <p
                      style={{
                        margin: '0 0 8px 0',
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        lineHeight: '1.4',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical'
                      }}
                      dangerouslySetInnerHTML={{
                        __html: searchQuery ? highlightSearchTerm(result.description || '', searchQuery) : (result.description || '')
                      }}
                    />

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{
                        background: 'var(--text)',
                        color: 'var(--bg)',
                        padding: '2px 6px',
                        borderRadius: '0px',
                        fontSize: '9px',
                        fontWeight: 700
                      }}>
                        {Math.round(result.relevance_score * 100)}% match
                      </div>

                      {result.location && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          color: 'var(--text-secondary)'
                        }}>
                          <span>📍</span>
                          <span>{result.location.address || 'Location available'}</span>
                        </div>
                      )}

                      {result.metadata?.build_status && (
                        <div style={{
                          background: getStatusColor(result.metadata.build_status),
                          color: 'var(--bg)',
                          padding: '2px 6px',
                          borderRadius: '0px',
                          fontSize: '9px',
                          fontWeight: 700,
                          textTransform: 'uppercase'
                        }}>
                          {result.metadata.build_status}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    marginLeft: '12px',
                    flexShrink: 0
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                      {new Date(result.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </div>
                    <div style={{
                      fontSize: '16px',
                      color: 'var(--text)',
                      fontWeight: 700
                    }}>
                      {getTypeIcon(result.type)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Load More button */}
          {hasMore && onLoadMore && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '24px 0 12px',
            }}>
              <button
                onClick={onLoadMore}
                disabled={loadingMore}
                style={{
                  padding: '10px 32px',
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  border: '2px solid var(--text)',
                  background: loadingMore ? 'var(--surface)' : 'var(--bg)',
                  color: loadingMore ? 'var(--text-secondary)' : 'var(--text)',
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                  transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => {
                  if (!loadingMore) {
                    e.currentTarget.style.background = 'var(--text)';
                    e.currentTarget.style.color = 'var(--bg)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loadingMore) {
                    e.currentTarget.style.background = 'var(--bg)';
                    e.currentTarget.style.color = 'var(--text)';
                  }
                }}
              >
                {loadingMore ? 'Loading...' : `Load more${totalCount ? ` (${results.length} of ${totalCount.toLocaleString()})` : ''}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SearchResults;