import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
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

interface SearchResponse {
  results: SearchResult[];
  total_count: number;
  search_summary: string;
  suggested_filters: string[];
  search_insights?: {
    locations_found: number;
    vehicles_for_sale: number;
    stagnant_builds: number;
    active_projects: number;
    parts_available: number;
  };
}

interface IntelligentSearchProps {
  onSearchResults: (results: SearchResult[], summary: string) => void;
  initialQuery?: string;
  userLocation?: { lat: number; lng: number };
}

const IntelligentSearch = ({ onSearchResults, initialQuery = '', userLocation }: IntelligentSearchProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Common search patterns and their translations
  const searchPatterns = [
    // Vehicle-specific searches
    { pattern: /(\w+)\s+near\s+me/i, type: 'vehicle_location' },
    { pattern: /(c10|c-10|chevy\s+c10)/i, type: 'vehicle_model' },
    { pattern: /stagnating|stagnant|abandoned|unfinished/i, type: 'build_status' },
    { pattern: /for\s+sale|buy|purchase|available/i, type: 'marketplace' },
    { pattern: /build|project|restoration|progress/i, type: 'build_project' },
    { pattern: /parts|components|swap|engine/i, type: 'parts' },
    { pattern: /shop|garage|service|mechanic/i, type: 'shop' },
    { pattern: /(\d{4})\s*(\w+)/i, type: 'year_make' },
  ];

  const commonSuggestions = [
    'Show me all C10s near me',
    'Which builds are stagnating',
    'C10s for sale in my area',
    'Active restoration projects',
    'Snap-on tools in use',
    'Local performance shops',
    'LS swap projects',
    'Abandoned project cars',
    'High-end builds for sale',
    'Custom fabrication shops nearby'
  ];

  useEffect(() => {
    if (query.length > 2) {
      const filtered = commonSuggestions.filter(s =>
        s.toLowerCase().includes(query.toLowerCase()) && s.toLowerCase() !== query.toLowerCase()
      );
      setSuggestions(filtered.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, [query]);

  const parseSearchQuery = (searchQuery: string) => {
    const queryAnalysis = {
      keywords: [] as string[],
      location_requested: false,
      marketplace_query: false,
      build_status_query: false,
      vehicle_specific: null as string | null,
      year_range: null as [number, number] | null,
      parts_query: false,
      shop_query: false,
      urgency: 'normal' as 'low' | 'normal' | 'high'
    };

    const lowerQuery = searchQuery.toLowerCase();

    // Extract keywords
    queryAnalysis.keywords = searchQuery.split(' ').filter(word => word.length > 2);

    // Check for location requests
    queryAnalysis.location_requested = /near me|nearby|local|area|around/i.test(searchQuery);

    // Check for marketplace queries
    queryAnalysis.marketplace_query = /for sale|buy|purchase|available|sell/i.test(searchQuery);

    // Check for build status
    queryAnalysis.build_status_query = /stagnant|stagnating|abandoned|unfinished|stuck|progress|active/i.test(searchQuery);

    // Vehicle specific detection
    if (/c10|c-10/i.test(searchQuery)) queryAnalysis.vehicle_specific = 'C10';
    if (/mustang|ford mustang/i.test(searchQuery)) queryAnalysis.vehicle_specific = 'Mustang';
    if (/camaro/i.test(searchQuery)) queryAnalysis.vehicle_specific = 'Camaro';

    // Parts query
    queryAnalysis.parts_query = /parts|tools|snap.?on|engine|transmission|swap/i.test(searchQuery);

    // Shop query
    queryAnalysis.shop_query = /shop|garage|service|mechanic|fabrication/i.test(searchQuery);

    return queryAnalysis;
  };

  const executeSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const analysis = parseSearchQuery(searchQuery);
      console.log('Search analysis:', analysis);

      let results: SearchResult[] = [];
      let searchInsights = {
        locations_found: 0,
        vehicles_for_sale: 0,
        stagnant_builds: 0,
        active_projects: 0,
        parts_available: 0
      };

      // Multi-table search strategy
      const searches = [];

      // 1. Vehicle search
      if (analysis.vehicle_specific || analysis.marketplace_query || !analysis.shop_query) {
        searches.push(searchVehicles(searchQuery, analysis));
      }

      // 2. Timeline events (for build status)
      if (analysis.build_status_query || analysis.vehicle_specific) {
        searches.push(searchTimelineEvents(searchQuery, analysis));
      }

      // 3. Parts/Tools search
      if (analysis.parts_query) {
        searches.push(searchParts(searchQuery, analysis));
      }

      // 4. Shop search
      if (analysis.shop_query || analysis.location_requested) {
        searches.push(searchShops(searchQuery, analysis));
      }

      // Execute all searches in parallel
      const searchResults = await Promise.all(searches);

      // Combine and rank results
      searchResults.forEach(resultSet => {
        if (resultSet) {
          results.push(...resultSet);
        }
      });

      // Sort by relevance and recency
      results.sort((a, b) => {
        const relevanceDiff = b.relevance_score - a.relevance_score;
        if (Math.abs(relevanceDiff) < 0.1) {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        return relevanceDiff;
      });

      // Calculate insights
      results.forEach(result => {
        if (result.location) searchInsights.locations_found++;
        if (result.metadata?.for_sale) searchInsights.vehicles_for_sale++;
        if (result.metadata?.build_status === 'stagnant') searchInsights.stagnant_builds++;
        if (result.metadata?.build_status === 'active') searchInsights.active_projects++;
        if (result.type === 'part') searchInsights.parts_available++;
      });

      // Generate search summary
      const summary = generateSearchSummary(searchQuery, results, searchInsights, analysis);

      // Update search history
      setSearchHistory(prev => [searchQuery, ...prev.filter(q => q !== searchQuery)].slice(0, 10));

      const response: SearchResponse = {
        results: results.slice(0, 50),
        total_count: results.length,
        search_summary: summary,
        suggested_filters: generateSuggestedFilters(analysis, results),
        search_insights: searchInsights
      };

      onSearchResults(response.results, response.search_summary);

    } catch (error) {
      console.error('Search error:', error);
      onSearchResults([], 'Search encountered an error. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [userLocation, onSearchResults]);

  const searchVehicles = async (query: string, analysis: any): Promise<SearchResult[]> => {
    let vehicleQuery = supabase
      .from('vehicles')
      .select(`
        id,
        year,
        make,
        model,
        color,
        description,
        created_at,
        created_by,
        metadata,
        profiles(username, full_name),
        vehicle_images(image_url)
      `);

    // Apply filters based on analysis
    if (analysis.vehicle_specific) {
      vehicleQuery = vehicleQuery.ilike('model', `%${analysis.vehicle_specific}%`);
    }

    // General text search
    const searchTerm = query.replace(/near me|for sale|buy/gi, '').trim();
    if (searchTerm) {
      vehicleQuery = vehicleQuery.or(`
        year::text.ilike.%${searchTerm}%,
        make.ilike.%${searchTerm}%,
        model.ilike.%${searchTerm}%,
        description.ilike.%${searchTerm}%
      `);
    }

    const { data: vehicles } = await vehicleQuery.limit(20);

    return (vehicles || []).map(vehicle => ({
      id: vehicle.id,
      type: 'vehicle' as const,
      title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      description: vehicle.description || `${vehicle.color} ${vehicle.make} ${vehicle.model}`,
      metadata: {
        ...vehicle.metadata,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        owner: vehicle.profiles?.full_name || vehicle.profiles?.username
      },
      relevance_score: calculateVehicleRelevance(vehicle, query, analysis),
      image_url: vehicle.vehicle_images?.[0]?.image_url,
      created_at: vehicle.created_at
    }));
  };

  const searchTimelineEvents = async (query: string, analysis: any): Promise<SearchResult[]> => {
    let eventQuery = supabase
      .from('vehicle_timeline_events')
      .select(`
        id,
        title,
        description,
        event_type,
        metadata,
        created_at,
        vehicles(year, make, model)
      `);

    if (analysis.build_status_query) {
      eventQuery = eventQuery.or(`
        event_type.eq.build_update,
        event_type.eq.progress_update,
        event_type.eq.completion
      `);
    }

    const { data: events } = await eventQuery.limit(15);

    return (events || []).map(event => ({
      id: event.id,
      type: 'timeline_event' as const,
      title: event.title || `${event.event_type} Event`,
      description: event.description || '',
      metadata: {
        ...event.metadata,
        event_type: event.event_type,
        vehicle: event.vehicles,
        build_status: determineBuildStatus(event)
      },
      relevance_score: calculateEventRelevance(event, query, analysis),
      created_at: event.created_at
    }));
  };

  const searchParts = async (query: string, analysis: any): Promise<SearchResult[]> => {
    // For now, search in vehicle descriptions and timeline events for parts/tools
    const searchTerm = query.toLowerCase();
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('*')
      .or(`description.ilike.%${searchTerm}%,metadata->>'parts'.ilike.%${searchTerm}%`)
      .limit(10);

    return (vehicles || []).map(vehicle => ({
      id: vehicle.id,
      type: 'part' as const,
      title: `Parts/Tools in ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      description: vehicle.description || '',
      metadata: vehicle.metadata,
      relevance_score: calculatePartsRelevance(vehicle, query),
      created_at: vehicle.created_at
    }));
  };

  const searchShops = async (query: string, analysis: any): Promise<SearchResult[]> => {
    const { data: shops } = await supabase
      .from('shops')
      .select('*')
      .or(`name.ilike.%${query}%,description.ilike.%${query}%,services.ilike.%${query}%`)
      .limit(10);

    return (shops || []).map(shop => ({
      id: shop.id,
      type: 'shop' as const,
      title: shop.name,
      description: shop.description || '',
      metadata: shop,
      relevance_score: 0.8,
      location: shop.latitude && shop.longitude ? {
        lat: shop.latitude,
        lng: shop.longitude,
        address: shop.address
      } : undefined,
      created_at: shop.created_at
    }));
  };

  const calculateVehicleRelevance = (vehicle: any, query: string, analysis: any): number => {
    let score = 0.5;

    // Exact model match
    if (analysis.vehicle_specific && vehicle.model.toLowerCase().includes(analysis.vehicle_specific.toLowerCase())) {
      score += 0.3;
    }

    // Description relevance
    if (vehicle.description && vehicle.description.toLowerCase().includes(query.toLowerCase())) {
      score += 0.2;
    }

    // Recent activity bonus
    const daysSinceCreated = (Date.now() - new Date(vehicle.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 30) score += 0.1;

    return Math.min(score, 1.0);
  };

  const calculateEventRelevance = (event: any, query: string, analysis: any): number => {
    let score = 0.4;

    if (analysis.build_status_query) {
      if (event.event_type === 'build_update' || event.event_type === 'progress_update') {
        score += 0.3;
      }
    }

    return Math.min(score, 1.0);
  };

  const calculatePartsRelevance = (vehicle: any, query: string): number => {
    const description = (vehicle.description || '').toLowerCase();
    const queryWords = query.toLowerCase().split(' ');

    let matches = 0;
    queryWords.forEach(word => {
      if (description.includes(word)) matches++;
    });

    return Math.min(0.3 + (matches / queryWords.length) * 0.4, 1.0);
  };

  const determineBuildStatus = (event: any): string => {
    const recentDate = Date.now() - new Date(event.created_at).getTime();
    const daysOld = recentDate / (1000 * 60 * 60 * 24);

    if (daysOld > 90) return 'stagnant';
    if (daysOld < 30) return 'active';
    return 'moderate';
  };

  const generateSearchSummary = (query: string, results: SearchResult[], insights: any, analysis: any): string => {
    const total = results.length;
    if (total === 0) return `No results found for "${query}". Try a different search term.`;

    let summary = `Found ${total} results for "${query}". `;

    if (analysis.vehicle_specific) {
      const vehicleCount = results.filter(r => r.type === 'vehicle').length;
      summary += `${vehicleCount} ${analysis.vehicle_specific} vehicles found. `;
    }

    if (analysis.marketplace_query && insights.vehicles_for_sale > 0) {
      summary += `${insights.vehicles_for_sale} vehicles available for purchase. `;
    }

    if (analysis.build_status_query) {
      summary += `${insights.stagnant_builds} stagnant builds, ${insights.active_projects} active projects. `;
    }

    if (analysis.location_requested && insights.locations_found > 0) {
      summary += `${insights.locations_found} results with location data. `;
    }

    return summary.trim();
  };

  const generateSuggestedFilters = (analysis: any, results: SearchResult[]): string[] => {
    const filters = [];

    if (results.some(r => r.location)) filters.push('Near me');
    if (results.some(r => r.metadata?.for_sale)) filters.push('For sale');
    if (results.some(r => r.type === 'vehicle')) filters.push('Vehicles only');
    if (results.some(r => r.type === 'shop')) filters.push('Shops only');
    if (analysis.build_status_query) filters.push('Active builds', 'Stagnant projects');

    return filters;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      executeSearch(query);
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    setShowSuggestions(false);
    executeSearch(suggestion);
  };

  return (
    <div className="intelligent-search" style={{ position: 'relative' }}>
      <form onSubmit={handleSubmit}>
        <div style={{ position: 'relative' }}>
          <input
            ref={searchInputRef}
            type="text"
            className="input"
            placeholder="Ask anything... 'Show me C10s near me', 'Snap-on tools in use', 'Which builds are stagnating'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            style={{
              fontSize: '16px',
              padding: '12px 60px 12px 16px',
              background: 'white',
              border: '2px solid #e5e7eb',
              borderRadius: '12px',
              boxShadow: isSearching ? '0 0 20px rgba(59, 130, 246, 0.3)' : '0 2px 8px rgba(0,0,0,0.1)',
              transition: 'all 0.2s ease'
            }}
          />

          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="button button-primary"
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '8px 12px',
              fontSize: '14px',
              minWidth: '50px'
            }}
          >
            {isSearching ? '⏳' : '🔍'}
          </button>
        </div>
      </form>

      {/* Search Suggestions */}
      {showSuggestions && (suggestions.length > 0 || searchHistory.length > 0) && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          marginTop: '4px',
          boxShadow: '0 8px 25px rgba(0,0,0,0.15)',
          zIndex: 1000,
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          {suggestions.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              <div style={{ padding: '4px 16px', fontSize: '12px', fontWeight: 'bold', color: '#6b7280' }}>
                Suggestions
              </div>
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    borderBottom: '1px solid #f3f4f6'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  🔍 {suggestion}
                </div>
              ))}
            </div>
          )}

          {searchHistory.length > 0 && (
            <div style={{ padding: '8px 0', borderTop: '1px solid #f3f4f6' }}>
              <div style={{ padding: '4px 16px', fontSize: '12px', fontWeight: 'bold', color: '#6b7280' }}>
                Recent Searches
              </div>
              {searchHistory.slice(0, 3).map((historyQuery, index) => (
                <div
                  key={index}
                  onClick={() => handleSuggestionClick(historyQuery)}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#6b7280'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  🕒 {historyQuery}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default IntelligentSearch;