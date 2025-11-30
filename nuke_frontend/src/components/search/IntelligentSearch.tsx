import React, { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { advancedSearchService } from '../../services/advancedSearchService';
import { fullTextSearchService } from '../../services/fullTextSearchService';
import '../../design-system.css';

interface SearchResult {
  id: string;
  type: 'vehicle' | 'organization' | 'shop' | 'part' | 'user' | 'timeline_event' | 'image' | 'document' | 'auction' | 'reference' | 'status';
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
  related_entities?: {
    vehicles?: any[];
    organizations?: any[];
    users?: any[];
  };
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
  const [hasInitialSearched, setHasInitialSearched] = useState(false);
  const lastSearchedRef = useRef<string>('');

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

      // Comprehensive multi-table search - search everything
      const searches = [
        searchVehicles(searchQuery, analysis),
        searchOrganizations(searchQuery, analysis),
        searchUsers(searchQuery, analysis),
        searchTimelineEvents(searchQuery, analysis),
        searchImages(searchQuery, analysis),
        searchDocuments(searchQuery, analysis),
        searchAuctions(searchQuery, analysis),
        searchParts(searchQuery, analysis),
        searchShops(searchQuery, analysis),
        searchReferences(searchQuery, analysis)
      ];

      // Execute all searches in parallel
      const searchResults = await Promise.all(searches);

      // Combine and rank results
      searchResults.forEach(resultSet => {
        if (resultSet) {
          results.push(...resultSet);
        }
      });

      // Re-rank all results using advanced search service
      if (results.length > 0) {
        const searchDocs = results.map(result => ({
          id: result.id,
          type: result.type,
          title: result.title,
          description: result.description,
          content: `${result.title} ${result.description} ${JSON.stringify(result.metadata || {})}`,
          fields: result.metadata || {},
          created_at: result.created_at
        }));

        const reranked = advancedSearchService.rankDocuments(searchQuery, searchDocs);
        
        // Merge reranked scores with original results
        const scoreMap = new Map(reranked.map(r => [r.id, r.relevance_score]));
        results.forEach(result => {
          const newScore = scoreMap.get(result.id);
          if (newScore !== undefined) {
            result.relevance_score = newScore;
          }
        });
      }

      // Sort by relevance and recency
      results.sort((a, b) => {
        const relevanceDiff = b.relevance_score - a.relevance_score;
        if (Math.abs(relevanceDiff) < 0.05) {
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

  // Update query when initialQuery changes
  useEffect(() => {
    if (initialQuery !== query) {
      setQuery(initialQuery);
    }
  }, [initialQuery, query]);

  // Auto-trigger search when initialQuery is provided
  useEffect(() => {
    if (initialQuery && initialQuery.trim() && lastSearchedRef.current !== initialQuery) {
      lastSearchedRef.current = initialQuery;
      setHasInitialSearched(true);
      setIsSearching(true);
      // Use setTimeout to ensure executeSearch is defined
      setTimeout(() => {
        executeSearch(initialQuery);
      }, 100);
    }
  }, [initialQuery, executeSearch]);

  const searchVehicles = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.replace(/near me|for sale|buy/gi, '').trim();
      
      if (!searchTerm) {
        return [];
      }

      // Try hybrid full-text search (PostgreSQL + BM25)
      let vehicles: any[] = [];
      try {
        vehicles = await fullTextSearchService.searchVehiclesHybrid(searchTerm, {
          limit: 20
        });
      } catch (ftError) {
        // Full-text search RPC might not exist, fall through to simple search
        console.log('Full-text search unavailable, using simple search');
      }

      // If full-text search returned no results, use simple search
      if (vehicles.length === 0) {
        let vehicleQuery = supabase
          .from('vehicles')
          .select('id, year, make, model, color, description, created_at, uploaded_by')
          .eq('is_public', true);

        // Apply filters based on analysis
        if (analysis.vehicle_specific) {
          vehicleQuery = vehicleQuery.ilike('model', `%${analysis.vehicle_specific}%`);
        }

        // Check if search term is a number (year)
        const yearMatch = searchTerm.match(/^\d{4}$/);
        if (yearMatch) {
          const year = parseInt(yearMatch[0]);
          vehicleQuery = vehicleQuery.or(`year.eq.${year},make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
        } else {
          // Text search across multiple fields
          vehicleQuery = vehicleQuery.or(`make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
        }

        const { data: simpleResults, error } = await vehicleQuery.limit(20);
        
        if (error) {
          console.error('Simple search error:', error);
          return [];
        }

        vehicles = (simpleResults || []).map((v: any) => ({
          id: v.id,
          year: v.year,
          make: v.make,
          model: v.model,
          color: v.color,
          description: v.description,
          created_at: v.created_at,
          relevance: 0.5
        }));
      }

      // Fetch images separately
      const vehicleIds = vehicles.map(v => v.id);
      const { data: images } = vehicleIds.length > 0 ? await supabase
        .from('vehicle_images')
        .select('vehicle_id, image_url')
        .in('vehicle_id', vehicleIds)
        .limit(vehicleIds.length * 3) : { data: [] };

      const imagesByVehicle = (images || []).reduce((acc: any, img: any) => {
        if (!acc[img.vehicle_id]) acc[img.vehicle_id] = [];
        acc[img.vehicle_id].push(img.image_url);
        return acc;
      }, {});

      return vehicles.map(vehicle => ({
        id: vehicle.id,
        type: 'vehicle' as const,
        title: `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Unknown Vehicle',
        description: vehicle.description || `${vehicle.color || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'No description',
        metadata: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          color: vehicle.color
        },
        relevance_score: vehicle.relevance || 0.5,
        image_url: imagesByVehicle[vehicle.id]?.[0],
        created_at: vehicle.created_at
      }));
    } catch (error) {
      console.error('Vehicle search exception:', error);
      return [];
    }
  };

  const searchTimelineEvents = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.replace(/near me|for sale|buy/gi, '').trim();
      
      if (!searchTerm) {
        return [];
      }

      // Use full-text search
      const events = await fullTextSearchService.searchTimelineEvents(searchTerm, { limit: 15 });

      // Fetch vehicle info separately
      const vehicleIds = [...new Set(events.map(e => e.vehicle_id).filter(Boolean))];
      const { data: relatedVehicles } = vehicleIds.length > 0 ? await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .in('id', vehicleIds) : { data: [] };

      const vehiclesMap = (relatedVehicles || []).reduce((acc: any, v: any) => {
        acc[v.id] = v;
        return acc;
      }, {});

      return events.map(event => ({
        id: event.id,
        type: 'timeline_event' as const,
        title: event.title || `${event.event_type || 'Event'}`,
        description: event.description || '',
        metadata: {
          event_type: event.event_type,
          vehicle: event.vehicle_id ? vehiclesMap[event.vehicle_id] : null,
          build_status: determineBuildStatus(event)
        },
        relevance_score: event.relevance || 0.5,
        created_at: event.created_at
      }));
    } catch (error) {
      console.error('Timeline events search exception:', error);
      return [];
    }
  };

  const searchParts = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.toLowerCase().trim();
      if (!searchTerm) {
        return [];
      }

      // Search in vehicle descriptions for parts/tools
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, description, created_at')
        .eq('is_public', true)
        .ilike('description', `%${searchTerm}%`)
        .limit(10);

      if (error) {
        console.error('Parts search error:', error);
        return [];
      }

      return (vehicles || []).map(vehicle => ({
        id: vehicle.id,
        type: 'part' as const,
        title: `Parts/Tools in ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle',
        description: vehicle.description || '',
        metadata: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model
        },
        relevance_score: calculatePartsRelevance(vehicle, query),
        created_at: vehicle.created_at
      }));
    } catch (error) {
      console.error('Parts search exception:', error);
      return [];
    }
  };

  const searchShops = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.trim();
      if (!searchTerm) {
        return [];
      }

      const { data: shops, error } = await supabase
        .from('shops')
        .select('id, name, description, location_city, location_state, created_at')
        .eq('is_verified', true) // Only show verified shops
        .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
        .limit(10);

      if (error) {
        console.error('Shops search error:', error);
        return [];
      }

      return (shops || []).map(shop => ({
        id: shop.id,
        type: 'shop' as const,
        title: shop.name || 'Unnamed Shop',
        description: shop.description || '',
        metadata: shop,
        relevance_score: 0.8,
        location: shop.location_city && shop.location_state ? {
          lat: 0, // Shops table doesn't have lat/lng directly
          lng: 0,
          address: `${shop.location_city}, ${shop.location_state}`
        } : undefined,
        created_at: shop.created_at
      }));
    } catch (error) {
      console.error('Shops search exception:', error);
      return [];
    }
  };

  const searchOrganizations = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.trim();
      if (!searchTerm) {
        return [];
      }

      // Use full-text search
      const orgs = await fullTextSearchService.searchBusinesses(searchTerm, { limit: 15 });

      // Also search through related vehicles
      const yearMatch = searchTerm.match(/^\d{4}$/);
      let relatedVehiclesQuery = supabase
        .from('vehicles')
        .select('id, year, make, model')
        .eq('is_public', true);
      
      if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        relatedVehiclesQuery = relatedVehiclesQuery.or(`year.eq.${year},make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%`);
      } else {
        relatedVehiclesQuery = relatedVehiclesQuery.or(`make.ilike.%${searchTerm}%,model.ilike.%${searchTerm}%`);
      }
      
      const { data: relatedVehicles } = await relatedVehiclesQuery.limit(5);

      // Fetch full org details for location data
      const orgIds = orgs.map(o => o.id);
      const { data: orgDetails } = orgIds.length > 0 ? await supabase
        .from('businesses')
        .select('id, latitude, longitude, address, business_type, specializations, services_offered')
        .in('id', orgIds) : { data: [] };

      const orgDetailsMap = (orgDetails || []).reduce((acc: any, org: any) => {
        acc[org.id] = org;
        return acc;
      }, {});

      return orgs.map(org => {
        const details = orgDetailsMap[org.id] || {};
        return {
          id: org.id,
          type: 'organization' as const,
          title: org.business_name || org.legal_name || 'Unnamed Organization',
          description: org.description || `${details.business_type || ''} ${org.city ? `in ${org.city}, ${org.state || ''}` : ''}`.trim(),
          metadata: {
            business_name: org.business_name,
            legal_name: org.legal_name,
            business_type: details.business_type,
            specializations: details.specializations,
            services: details.services_offered
          },
          relevance_score: org.relevance || 0.85,
          location: details.latitude && details.longitude ? {
            lat: parseFloat(details.latitude),
            lng: parseFloat(details.longitude),
            address: `${details.address || ''}, ${org.city || ''}, ${org.state || ''}`.trim()
          } : undefined,
          related_entities: relatedVehicles ? { vehicles: relatedVehicles } : undefined,
          created_at: org.created_at
        };
      });
    } catch (error) {
      console.error('Organizations search exception:', error);
      return [];
    }
  };

  const searchUsers = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.trim();
      if (!searchTerm) {
        return [];
      }

      // Use full-text search
      const users = await fullTextSearchService.searchProfiles(searchTerm, { limit: 10 });

      return users.map(user => ({
        id: user.id,
        type: 'user' as const,
        title: user.full_name || user.username || 'Unknown User',
        description: user.bio || `User: ${user.username || ''}`,
        metadata: {
          username: user.username,
          full_name: user.full_name,
          avatar_url: user.avatar_url
        },
        relevance_score: user.relevance || 0.75,
        image_url: user.avatar_url,
        created_at: user.created_at
      }));
    } catch (error) {
      console.error('Users search exception:', error);
      return [];
    }
  };

  const searchImages = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.trim();
      if (!searchTerm) {
        return [];
      }

      // Search images through their captions
      const { data: images, error } = await supabase
        .from('vehicle_images')
        .select(`
          id,
          image_url,
          caption,
          created_at,
          vehicle_id
        `)
        .ilike('caption', `%${searchTerm}%`)
        .limit(15);

      if (error) {
        console.error('Images search error:', error);
        return [];
      }

      // Fetch vehicle info separately
      const vehicleIds = [...new Set((images || []).map((img: any) => img.vehicle_id).filter(Boolean))];
      const { data: relatedVehicles } = vehicleIds.length > 0 ? await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .in('id', vehicleIds) : { data: [] };

      const vehiclesMap = (relatedVehicles || []).reduce((acc: any, v: any) => {
        acc[v.id] = v;
        return acc;
      }, {});

      return (images || []).map((image: any) => {
        const vehicle = image.vehicle_id ? vehiclesMap[image.vehicle_id] : null;
        return {
          id: image.id,
          type: 'image' as const,
          title: vehicle ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle Image' : 'Image',
          description: image.caption || 'Vehicle image',
          metadata: {
            vehicle: vehicle
          },
          relevance_score: 0.7,
          image_url: image.image_url,
          created_at: image.created_at
        };
      });
    } catch (error) {
      console.error('Images search exception:', error);
      return [];
    }
  };

  const searchDocuments = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.trim();
      if (!searchTerm) {
        return [];
      }

      const { data: docs, error } = await supabase
        .from('vehicle_documents')
        .select(`
          id,
          document_type,
          title,
          description,
          file_url,
          created_at,
          vehicle_id
        `)
        .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,document_type.ilike.%${searchTerm}%`)
        .limit(10);

      if (error) {
        console.error('Documents search error:', error);
        return [];
      }

      // Fetch vehicle info separately
      const vehicleIds = [...new Set((docs || []).map((d: any) => d.vehicle_id).filter(Boolean))];
      const { data: relatedVehicles } = vehicleIds.length > 0 ? await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .in('id', vehicleIds) : { data: [] };

      const vehiclesMap = (relatedVehicles || []).reduce((acc: any, v: any) => {
        acc[v.id] = v;
        return acc;
      }, {});

      return (docs || []).map((doc: any) => {
        const vehicle = doc.vehicle_id ? vehiclesMap[doc.vehicle_id] : null;
        return {
          id: doc.id,
          type: 'document' as const,
          title: doc.title || `${doc.document_type || 'Document'}${vehicle ? ` - ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() : ''}`,
          description: doc.description || doc.document_type || 'Document',
          metadata: {
            document_type: doc.document_type,
            file_url: doc.file_url,
            vehicle: vehicle
          },
          relevance_score: 0.8,
          created_at: doc.created_at
        };
      });
    } catch (error) {
      console.error('Documents search exception:', error);
      return [];
    }
  };

  const searchAuctions = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.trim();
      if (!searchTerm) {
        return [];
      }

      // Search in external_listings (BAT, etc.) for auction listings
      const { data: listings, error } = await supabase
        .from('external_listings')
        .select(`
          id,
          listing_url,
          listing_status,
          current_bid,
          bid_count,
          created_at,
          vehicle_id,
          vehicles!inner(
            id,
            year,
            make,
            model
          )
        `)
        .eq('listing_status', 'active')
        .or(`vehicles.make.ilike.%${searchTerm}%,vehicles.model.ilike.%${searchTerm}%`)
        .limit(10);

      if (error) {
        // Silently fail if table doesn't exist or query fails
        if (error.code !== 'PGRST116' && error.code !== 'PGRST200' && error.code !== '42P01') {
          console.error('Auctions search error:', error);
        }
        return [];
      }

      return (listings || []).map((listing: any) => {
        const vehicle = listing.vehicles;
        const vehicleName = vehicle ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() : 'Vehicle';
        return {
          id: listing.id,
          type: 'auction' as const,
          title: `${vehicleName} - Auction`,
          description: `Current bid: $${(listing.current_bid || 0).toLocaleString()} • ${listing.bid_count || 0} bids`,
          metadata: {
            status: listing.listing_status,
            current_bid: listing.current_bid,
            bid_count: listing.bid_count,
            listing_url: listing.listing_url,
            vehicle: vehicle
          },
          relevance_score: 0.85,
          created_at: listing.created_at
        };
      });
    } catch (error) {
      // Silently fail - auctions search is optional
      return [];
    }
  };

  const searchReferences = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.trim();
      if (!searchTerm) {
        return [];
      }

      // Search reference libraries and documents
      // Try to find the correct table name - might be reference_libraries or library_documents
      let refs: any[] = [];
      let error: any = null;

      // Try reference_libraries first
      const { data: libs, error: libError } = await supabase
        .from('reference_libraries')
        .select('id, title, description, created_at')
        .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
        .limit(10);

      if (!libError && libs) {
        refs = libs;
      } else {
        // Try library_documents as fallback
        const { data: docs, error: docError } = await supabase
          .from('library_documents')
          .select('id, title, description, created_at')
          .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`)
          .limit(10);
        
        if (!docError && docs) {
          refs = docs;
        } else {
          error = docError || libError;
        }
      }

      if (error) {
        // Table might not exist, that's okay
        if (error.code !== 'PGRST116' && error.code !== '42703') {
          console.error('References search error:', error);
        }
        return [];
      }

      return (refs || []).map((ref: any) => ({
        id: ref.id,
        type: 'reference' as const,
        title: ref.title || 'Reference',
        description: ref.description || 'Reference material',
        metadata: ref,
        relevance_score: 0.75,
        created_at: ref.created_at
      }));
    } catch (error) {
      console.error('References search exception:', error);
      return [];
    }
  };

  const calculateVehicleRelevance = (vehicle: any, query: string, analysis: any): number => {
    // Use advanced search service for better ranking
    const searchDoc = {
      id: vehicle.id,
      type: 'vehicle',
      title: `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim(),
      description: vehicle.description || '',
      content: `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.color || ''} ${vehicle.description || ''}`.trim(),
      fields: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color
      },
      created_at: vehicle.created_at
    };

    const results = advancedSearchService.rankDocuments(query, [searchDoc]);
    let score = results[0]?.relevance_score || 0.5;

    // Exact model match boost
    if (analysis.vehicle_specific && vehicle.model?.toLowerCase().includes(analysis.vehicle_specific.toLowerCase())) {
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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (query.trim()) {
      executeSearch(query);
      setShowSuggestions(false);
    }
  };

  // Add explicit keyboard handler for Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
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
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            style={{
              fontSize: '9pt',
              padding: '4px 50px 4px 8px',
              background: 'var(--white)',
              border: '2px solid var(--border)',
              borderRadius: '0px',
              fontFamily: '"MS Sans Serif", sans-serif',
              transition: 'all 0.12s ease'
            }}
          />

          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="button-win95"
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '2px 8px',
              fontSize: '8pt',
              height: '20px',
              minWidth: '40px'
            }}
          >
            {isSearching ? '...' : 'GO'}
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
                  {suggestion}
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
                  {historyQuery}
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