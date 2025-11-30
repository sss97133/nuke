import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import IntelligentSearch from '../components/search/IntelligentSearch';
import SearchResults from '../components/search/SearchResults';
import '../design-system.css';

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

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchSummary, setSearchSummary] = useState('Enter a search query to find vehicles, organizations, parts, and more');
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Get user location if needed
  useEffect(() => {
    if (searchQuery.toLowerCase().includes('near me') || searchQuery.toLowerCase().includes('nearby')) {
      navigator.geolocation?.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => {
          console.warn('Could not get user location');
        }
      );
    }
  }, [searchQuery]);

  // Update URL when search query changes
  useEffect(() => {
    if (searchQuery) {
      setSearchParams({ q: searchQuery });
    } else {
      setSearchParams({});
    }
  }, [searchQuery, setSearchParams]);

  const handleSearchResults = (searchResults: SearchResult[], summary: string) => {
    setResults(searchResults);
    setSearchSummary(summary);
    setLoading(false);
  };

  // Sync searchQuery with URL parameter
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    if (urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
      if (urlQuery) {
        setLoading(true);
      }
    }
  }, [searchParams]);

  return (
    <div style={{ padding: '12px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Search Input */}
      <div style={{ marginBottom: '24px' }}>
        <IntelligentSearch
          initialQuery={searchQuery}
          userLocation={userLocation}
          onSearchResults={handleSearchResults}
        />
      </div>

        {/* Loading State */}
        {loading && (
          <div style={{
            textAlign: 'center',
            padding: '24px',
            background: 'var(--grey-50)',
            border: '1px solid var(--border)',
            borderRadius: '0px',
            fontSize: '8pt'
          }}>
            <h3 className="heading-3" style={{ fontSize: '9pt', marginBottom: '8px' }}>Searching...</h3>
            <p className="text text-muted" style={{ fontSize: '8pt' }}>Finding results for "{searchQuery}"</p>
          </div>
        )}

      {/* Results - Always show if there's a query or results */}
      {searchQuery && (
        <SearchResults
          results={results}
          searchSummary={searchSummary}
          loading={loading}
        />
      )}
    </div>
  );
}

