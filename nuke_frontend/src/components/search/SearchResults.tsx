import { useState } from 'react';
import type { FeedItem } from '../feed/types';
import ContentCard from '../feed/ContentCard';
import '../../design-system.css';

interface SearchResult {
  id: string;
  type: 'vehicle' | 'shop' | 'part' | 'user' | 'timeline_event' | 'status';
  title: string;
  description: string;
  metadata: any;
  relevance_score: number;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
  image_url?: string;
  created_at: string;
}

interface SearchResultsProps {
  results: SearchResult[];
  searchSummary: string;
  loading?: boolean;
}

const SearchResults = ({ results, searchSummary, loading = false }: SearchResultsProps) => {
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'map'>('cards');
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'location'>('relevance');
  const [filterBy, setFilterBy] = useState<'all' | 'vehicle' | 'shop' | 'part' | 'timeline_event'>('all');

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
      case 'vehicle': return 'VEHICLE';
      case 'shop': return 'SHOP';
      case 'part': return 'PART';
      case 'timeline_event': return 'EVENT';
      case 'user': return 'USER';
      default: return '📄';
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
        padding: '60px',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
        <p className="text text-muted">Searching across all content...</p>
      </div>
    );
  }

  return (
    <div className="search-results">
      {/* Search Summary */}
      <div style={{
        background: '#f8fafc',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '18px' }}>SEARCH</span>
          <h3 className="heading-3" style={{ margin: 0 }}>Search Results</h3>
        </div>
        <p className="text" style={{ margin: '0 0 12px 0', color: '#374151' }}>
          {searchSummary}
        </p>

        {/* Quick Stats */}
        <div style={{
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          {['vehicle', 'shop', 'part', 'timeline_event'].map(type => {
            const count = results.filter(r => r.type === type).length;
            if (count === 0) return null;

            return (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'white',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '12px'
                }}
              >
                <span>{getTypeIcon(type)}</span>
                <span className="text text-bold">{count}</span>
                <span className="text text-muted">{type}s</span>
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
        gap: '12px'
      }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="text text-bold" style={{ fontSize: '12px' }}>View:</span>
          {(['cards', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`button ${viewMode === mode ? 'button-primary' : 'button-secondary'}`}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                textTransform: 'capitalize'
              }}
            >
              {mode === 'cards' ? 'CARDS' : 'LIST'} {mode}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span className="text text-bold" style={{ fontSize: '12px' }}>Filter:</span>
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as any)}
              className="input"
              style={{ fontSize: '12px', padding: '4px 8px' }}
            >
              <option value="all">All Types</option>
              <option value="vehicle">Vehicles</option>
              <option value="shop">Shops</option>
              <option value="part">Parts/Tools</option>
              <option value="timeline_event">Events</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span className="text text-bold" style={{ fontSize: '12px' }}>Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="input"
              style={{ fontSize: '12px', padding: '4px 8px' }}
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
          padding: '60px',
          background: '#f8fafc',
          borderRadius: '12px',
          border: '2px dashed #d1d5db'
        }}>
          <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>SEARCH</span>
          <h3 className="heading-3">No Results Found</h3>
          <p className="text text-muted">
            Try adjusting your search terms or filters
          </p>
        </div>
      ) : (
        <>
          {viewMode === 'cards' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '20px'
            }}>
              {filteredAndSortedResults.map(result => (
                <div key={result.id} style={{ position: 'relative' }}>
                  {/* Relevance Score Badge */}
                  <div style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '12px',
                    fontSize: '10px',
                    zIndex: 10
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
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              {filteredAndSortedResults.map((result, index) => (
                <div
                  key={result.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16px',
                    borderBottom: index < filteredAndSortedResults.length - 1 ? '1px solid #f3f4f6' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  <div style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '8px',
                    background: result.image_url ? `url(${result.image_url}) center/cover` : '#f3f4f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    marginRight: '16px'
                  }}>
                    {!result.image_url && getTypeIcon(result.type)}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <h4 className="heading-4" style={{ margin: 0 }}>
                        {result.title}
                      </h4>
                      <div style={{
                        background: '#f3f4f6',
                        color: '#6b7280',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        textTransform: 'uppercase'
                      }}>
                        {result.type}
                      </div>
                    </div>

                    <p className="text text-muted" style={{
                      margin: '0 0 8px 0',
                      fontSize: '14px',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }}>
                      {result.description}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        background: `${getStatusColor(result.metadata?.build_status || 'default')}20`,
                        color: getStatusColor(result.metadata?.build_status || 'default'),
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '10px'
                      }}>
                        {Math.round(result.relevance_score * 100)}% match
                      </div>

                      {result.location && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '12px',
                          color: '#6b7280'
                        }}>
                          📍 {result.location.address || 'Location available'}
                        </div>
                      )}

                      {result.metadata?.build_status && (
                        <div style={{
                          background: `${getStatusColor(result.metadata.build_status)}20`,
                          color: getStatusColor(result.metadata.build_status),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px'
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
                    fontSize: '12px',
                    color: '#9ca3af'
                  }}>
                    <div>{new Date(result.created_at).toLocaleDateString()}</div>
                    <div style={{ marginTop: '4px' }}>
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