import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FeedItem } from '../feed/types';
import ContentCard from '../feed/ContentCard';
import { highlightSearchTerm } from '../../utils/searchHighlight';
import type { SearchResult } from '../../types/search';
import '../../design-system.css';

interface SearchResultsProps {
  results: SearchResult[];
  searchSummary: string;
  loading?: boolean;
}

const SearchResults = ({ results, searchSummary, loading = false }: SearchResultsProps) => {
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get('q') || '';
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'map'>('cards');
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'location'>('relevance');
  const [filterBy, setFilterBy] = useState<'all' | 'vehicle' | 'organization' | 'shop' | 'part' | 'user' | 'timeline_event' | 'image' | 'document' | 'auction' | 'reference' | 'source'>('all');

  const getResultHref = (result: SearchResult): string | undefined => {
    switch (result.type) {
      case 'vehicle':
        return `/vehicle/${result.id}`;
      case 'organization':
      case 'shop':
        return `/org/${result.id}`;
      case 'user':
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
      case 'active': return '#10b981';
      case 'stagnant': return '#ef4444';
      case 'moderate': return '#f59e0b';
      case 'for_sale': return '#8b5cf6';
      default: return '#6b7280';
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
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '48px 24px',
        flexDirection: 'column',
        gap: '16px',
        background: 'var(--surface)',
        border: '2px solid #e5e7eb',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div className="spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }}></div>
        <p style={{ 
          fontSize: '14px',
          color: '#6b7280',
          margin: 0,
          fontWeight: 500,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          Searching...
        </p>
      </div>
    );
  }

  return (
    <div className="search-results" style={{ padding: '0' }}>
      {/* Search Summary */}
      <div style={{
        background: 'var(--surface)',
        border: '2px solid #000',
        borderRadius: '0px',
        padding: '12px 16px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h2 style={{ 
            margin: 0, 
            fontSize: '10pt', 
            fontWeight: 700, 
            color: '#000',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Search Results
          </h2>
          <div style={{
            fontSize: '8pt',
            color: '#666',
            fontWeight: 600
          }}>
            {filteredAndSortedResults.length} {filteredAndSortedResults.length === 1 ? 'result' : 'results'}
          </div>
        </div>
        <p style={{ 
          margin: '0 0 12px 0', 
          color: '#666',
          fontSize: '8pt',
          lineHeight: '1.4'
        }}>
          {searchSummary}
        </p>

        {/* Quick Stats */}
        <div style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          {['vehicle', 'organization', 'shop', 'part', 'user', 'timeline_event', 'image', 'document', 'auction', 'reference'].map(type => {
            const count = results.filter(r => r.type === type).length;
            if (count === 0) return null;

            return (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--surface)',
                  border: '2px solid #e5e7eb',
                  padding: '4px 8px',
                  borderRadius: '0px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  color: '#000',
                  transition: 'all 0.12s ease',
                  cursor: 'default'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.background = '#eff6ff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.background = '#ffffff';
                }}
              >
                <span style={{ 
                  fontSize: '8pt',
                  fontWeight: 700,
                  color: '#000'
                }}>{getTypeIcon(type)}</span>
                <span style={{ fontWeight: 600 }}>{count}</span>
                <span style={{ color: '#6b7280', textTransform: 'capitalize' }}>{type.replace('_', ' ')}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '16px',
        padding: '8px 12px',
        background: 'var(--surface)',
        border: '2px solid #000',
        borderRadius: '0px'
      }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '8pt', fontWeight: 700, color: '#000' }}>View:</span>
          {(['cards', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '4px 12px',
                fontSize: '8pt',
                fontWeight: 700,
                textTransform: 'uppercase',
                height: '24px',
                border: '2px solid #000',
                borderRadius: '0px',
                background: viewMode === mode ? '#000' : '#fff',
                color: viewMode === mode ? '#fff' : '#000',
                cursor: 'pointer',
                transition: 'all 0.12s ease'
              }}
              onMouseEnter={(e) => {
                if (viewMode !== mode) {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.background = '#eff6ff';
                }
              }}
              onMouseLeave={(e) => {
                if (viewMode !== mode) {
                  e.currentTarget.style.borderColor = '#d1d5db';
                  e.currentTarget.style.background = '#ffffff';
                }
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '8pt', fontWeight: 700, color: '#000' }}>Filter:</span>
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as any)}
              style={{ 
                fontSize: '8pt', 
                padding: '4px 8px', 
                height: '24px',
                border: '2px solid #000',
                borderRadius: '0px',
                background: 'var(--surface)',
                color: '#000',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'border-color 0.12s ease'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
            >
              <option value="all">All Types</option>
              <option value="vehicle">Vehicles</option>
              <option value="organization">Organizations</option>
              <option value="shop">Shops</option>
              <option value="user">Users</option>
              <option value="part">Parts/Tools</option>
              <option value="timeline_event">Events</option>
              <option value="image">Images</option>
              <option value="document">Documents</option>
              <option value="auction">Auctions</option>
              <option value="reference">References</option>
              <option value="source">Sources</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '8pt', fontWeight: 700, color: '#000' }}>Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={{ 
                fontSize: '8pt', 
                padding: '4px 8px', 
                height: '24px',
                border: '2px solid #000',
                borderRadius: '0px',
                background: 'var(--surface)',
                color: '#000',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'border-color 0.12s ease'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#d1d5db'}
            >
              <option value="relevance">Relevance</option>
              <option value="date">Date</option>
              <option value="location">Location</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      {filteredAndSortedResults.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '48px 16px',
          background: 'var(--surface)',
          border: '2px solid #000',
          borderRadius: '0px'
        }}>
          <div style={{ fontSize: '32pt', marginBottom: '16px' }}>🔍</div>
          <h3 style={{ 
            fontSize: '10pt', 
            fontWeight: 700,
            marginBottom: '8px',
            color: '#000',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            No Results Found
          </h3>
          <p style={{ 
            fontSize: '9pt',
            color: '#666',
            margin: '0 0 24px 0',
            maxWidth: '400px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            We couldn't find anything matching "{searchQuery}"
          </p>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxWidth: '300px',
            margin: '0 auto',
            textAlign: 'left'
          }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, color: '#000', marginBottom: '4px' }}>Try:</div>
            <ul style={{ 
              margin: 0, 
              paddingLeft: '20px',
              fontSize: '8pt',
              color: '#666',
              listStyle: 'disc'
            }}>
              <li>Check your spelling</li>
              <li>Use more general terms</li>
              <li>Try different keywords</li>
              <li>Remove filters</li>
            </ul>
            {searchQuery.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, color: '#000', marginBottom: '8px' }}>Popular Searches:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                  {['C10', 'BMW 2002', 'Squarebody', 'Restoration'].map(term => (
                    <button
                      key={term}
                      onClick={() => window.location.href = `/search?q=${encodeURIComponent(term)}`}
                      style={{
                        padding: '4px 12px',
                        fontSize: '8pt',
                        fontWeight: 600,
                        border: '2px solid #000',
                        borderRadius: '0px',
                        background: 'white',
                        color: '#000',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#000';
                        e.currentTarget.style.color = '#fff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'white';
                        e.currentTarget.style.color = '#000';
                      }}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {viewMode === 'cards' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '16px'
            }}>
              {filteredAndSortedResults.map(result => (
                <div 
                  key={result.id} 
                  style={{ 
                    position: 'relative',
                    transition: 'transform 0.12s ease, box-shadow 0.12s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {/* Relevance Score Badge */}
                  <div style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: 'rgba(59, 130, 246, 0.95)',
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '7pt',
                    fontWeight: 700,
                    zIndex: 10,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}>
                    {Math.round(result.relevance_score * 100)}% match
                  </div>

                  <ContentCard item={convertToFeedItem(result)} />
                </div>
              ))}
            </div>
          )}

          {viewMode === 'list' && (
            <div style={{
              background: 'var(--surface)',
              border: '2px solid #000',
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
                      window.location.href = href;
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px',
                    borderBottom: index < filteredAndSortedResults.length - 1 ? '1px solid #000' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.12s ease',
                    background: 'var(--surface)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                >
                  <div style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '0px',
                    background: result.image_url ? `url(${result.image_url}) center/cover` : '#f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12pt',
                    marginRight: '12px',
                    border: '2px solid #000',
                    flexShrink: 0
                  }}>
                    {!result.image_url && (
                      <span style={{ color: '#9ca3af' }}>{getTypeIcon(result.type)}</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <h4 style={{ 
                        margin: 0,
                        fontSize: '9pt',
                        fontWeight: 700,
                        color: '#000'
                      }}>
                        {result.title}
                      </h4>
                      <div style={{
                        background: '#000',
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: '0px',
                        fontSize: '7pt',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        {result.type.replace('_', ' ')}
                      </div>
                    </div>

                    <p 
                      style={{
                        margin: '0 0 8px 0',
                        fontSize: '8pt',
                        color: '#666',
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
                        background: '#000',
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: '0px',
                        fontSize: '7pt',
                        fontWeight: 700
                      }}>
                        {Math.round(result.relevance_score * 100)}% match
                      </div>

                      {result.location && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '8pt',
                          color: '#666'
                        }}>
                          <span>📍</span>
                          <span>{result.location.address || 'Location available'}</span>
                        </div>
                      )}

                      {result.metadata?.build_status && (
                        <div style={{
                          background: getStatusColor(result.metadata.build_status),
                          color: '#fff',
                          padding: '2px 6px',
                          borderRadius: '0px',
                          fontSize: '7pt',
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
                    fontSize: '8pt',
                    color: '#666',
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
                      fontSize: '12pt',
                      color: '#000',
                      fontWeight: 700
                    }}>
                      {getTypeIcon(result.type)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SearchResults;