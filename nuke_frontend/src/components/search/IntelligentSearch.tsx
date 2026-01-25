import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { advancedSearchService } from '../../services/advancedSearchService';
import { fullTextSearchService } from '../../services/fullTextSearchService';
import { UnifiedImageImportService } from '../../services/unifiedImageImportService';
import { FaviconIcon } from '../common/FaviconIcon';
import { extractAndCacheFavicon, detectSourceType } from '../../services/sourceFaviconService';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import type { SearchResult } from '../../types/search';
import '../../design-system.css';

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
  const navigate = useNavigate();
  const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1');
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('nuke_search_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [autocompleteResults, setAutocompleteResults] = useState<Array<{id: string; title: string; type: string; metadata?: any}>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [hasInitialSearched, setHasInitialSearched] = useState(false);
  const lastSearchedRef = useRef<string>('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Load search history on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('nuke_search_history');
      if (stored) {
        setSearchHistory(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  // Save search history
  const saveToHistory = (searchTerm: string) => {
    if (!searchTerm.trim()) return;
    const trimmed = searchTerm.trim();
    setSearchHistory(prev => {
      const updated = [trimmed, ...prev.filter(h => h !== trimmed)].slice(0, 10);
      try {
        localStorage.setItem('nuke_search_history', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  // Real-time autocomplete
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (query.length > 2 && !isSearching) {
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const querySafe = escapeILike(query);
          // Quick autocomplete search - skip vehicle search for queries that look like usernames
          const looksLikeUsername = query.length < 20 && /^[a-zA-Z0-9_\-]+$/.test(query);
          
          const [vehicles, orgs, externalIdentities] = await Promise.all([
            // Only search vehicles if it doesn't look like a username
            !looksLikeUsername
              ? supabase
                  .from('vehicles')
                  .select('id, year, make, model')
                  .eq('is_public', true)
                  .or(`make.ilike.%${querySafe}%,model.ilike.%${querySafe}%`)
                  .limit(3)
              : Promise.resolve({ data: [], error: null }),
            supabase
              .from('businesses')
              .select('id, business_name')
              .eq('is_public', true)
              .ilike('business_name', `%${querySafe}%`)
              .limit(3),
            // Search external identities (BaT usernames, etc.)
            supabase
              .from('external_identities')
              .select('id, platform, handle, metadata')
              .ilike('handle', `%${querySafe}%`)
              .limit(5)
          ]);

          const results: Array<{id: string; title: string; type: string; metadata?: any}> = [];
          
          if (vehicles.data) {
            vehicles.data.forEach((v: any) => {
              results.push({
                id: v.id,
                title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim(),
                type: 'vehicle'
              });
            });
          }
          
          if (orgs.data) {
            orgs.data.forEach((o: any) => {
              results.push({
                id: o.id,
                title: o.business_name,
                type: 'organization'
              });
            });
          }

          // Add external identities (BaT usernames, etc.)
          if (externalIdentities.data) {
            externalIdentities.data.forEach((identity: any) => {
              const metadata = identity.metadata || {};
              const memberSince = metadata.member_since;
              const commentsCount = metadata.comments_count || metadata.total_comments || 0;
              const subtitle = memberSince 
                ? `BaT member • ${commentsCount || 0} comments`
                : `${identity.platform.toUpperCase()} user`;
              
              results.push({
                id: `external_${identity.id}`,
                title: identity.handle,
                type: 'user',
                metadata: {
                  platform: identity.platform,
                  handle: identity.handle,
                  external_identity_id: identity.id,
                  subtitle: subtitle,
                  member_since: memberSince,
                  comments_count: commentsCount
                }
              });
            });
          }

          setAutocompleteResults(results);
        } catch (error) {
          console.error('Autocomplete error:', error);
        }
      }, 300);
    } else {
      setAutocompleteResults([]);
    }

    // Update suggestions from common list
    if (query.length > 2) {
      const filtered = commonSuggestions.filter(s =>
        s.toLowerCase().includes(query.toLowerCase()) && s.toLowerCase() !== query.toLowerCase()
      );
      setSuggestions(filtered.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, [query, isSearching]);

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

    const trimmedQuery = searchQuery.trim();

    // Fast-path: allow `/search?q=<uuid>` to jump directly to a vehicle profile.
    // Without this, UUIDs won't match make/model/description searches and you'll get "No Results Found".
    const looksLikeUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedQuery);
    if (looksLikeUuid) {
      try {
        const { data: vehicleById, error: vehicleByIdErr } = await supabase
          .from('vehicles')
          .select('id')
          .eq('id', trimmedQuery)
          .maybeSingle();

        if (!vehicleByIdErr && vehicleById?.id) {
          navigate(`/vehicle/${vehicleById.id}`);
          return;
        }
      } catch {
        // ignore; fall through to regular search
      }
    }
    

    // Check if query is a Craigslist URL - check DB first, then import if needed
    const craigslistUrlPattern = /https?:\/\/([^.]+)\.craigslist\.org\/[^/]+\/d\/[^/]+\/[^/]+\.html/i;
    const kslUrlPattern = /https?:\/\/cars\.ksl\.com\/listing\/\d+/i;
    const isCraigslistUrl = craigslistUrlPattern.test(trimmedQuery);
    const isKSLUrl = kslUrlPattern.test(trimmedQuery);
    
    if (isCraigslistUrl || isKSLUrl) {
      const source = isCraigslistUrl ? 'Craigslist' : 'KSL';
      setIsSearching(true);
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          onSearchResults([], 'Please log in to import vehicles from Craigslist.');
          setIsSearching(false);
          return;
        }

        // FIRST: Check if vehicle already exists in database
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id, year, make, model, discovery_url')
          .eq('discovery_url', searchQuery.trim())
          .maybeSingle();

        if (existingVehicle) {
          // Vehicle already exists - navigate to it immediately
          window.location.href = `/vehicle/${existingVehicle.id}`;
          return;
        }

        // SECOND: Check if it's in the queue (pending/processing)
        const { data: queueItem } = await supabase
          .from('craigslist_listing_queue')
          .select('id, status, vehicle_id, processed_at')
          .eq('listing_url', searchQuery.trim())
          .maybeSingle();

        if (queueItem) {
          if (queueItem.vehicle_id) {
            // Already processed - navigate to vehicle
            window.location.href = `/vehicle/${queueItem.vehicle_id}`;
            return;
          } else if (queueItem.status === 'processing') {
            // Currently processing - show message and wait
            onSearchResults([], 'This listing is currently being processed. Please wait a moment and try again.');
            setIsSearching(false);
            return;
          } else if (queueItem.status === 'pending') {
            // In queue but not processed - trigger immediate processing
            const { error: processError } = await supabase.functions.invoke('process-cl-queue', {
              body: { max_listings_to_process: 1, listing_url: searchQuery.trim() }
            });

            if (!processError) {
              // Wait a moment for processing, then check again
              setTimeout(async () => {
                const { data: updatedQueueItem } = await supabase
                  .from('craigslist_listing_queue')
                  .select('vehicle_id')
                  .eq('listing_url', searchQuery.trim())
                  .maybeSingle();

                if (updatedQueueItem?.vehicle_id) {
                  window.location.href = `/vehicle/${updatedQueueItem.vehicle_id}`;
                } else {
                  onSearchResults([], 'Processing started. Please refresh in a moment.');
                  setIsSearching(false);
                }
              }, 2000);
              return;
            }
          }
        }

        // Scrape the listing
        const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
          body: { url: searchQuery.trim() }
        });

        if (scrapeError || !scrapeResult?.success) {
          console.error('❌ Scraping failed:', scrapeError || scrapeResult);
          onSearchResults([], `Failed to import listing: ${scrapeError?.message || scrapeResult?.error || 'Unknown error'}`);
          setIsSearching(false);
          return;
        }
        
        const scrapedData = scrapeResult?.data;
        
        // Validate scrapedData exists
        if (!scrapedData) {
          console.error('❌ No data returned from scraper');
          onSearchResults([], 'Failed to extract data from listing');
          setIsSearching(false);
          return;
        }
        
        
        // Helper function to extract make/model from title as fallback
        const extractFromTitle = (title: string) => {
          if (!title) return { make: null, model: null };
          
          // Common makes list (expanded)
          const makePatterns = [
            'ford', 'chevrolet', 'chevy', 'toyota', 'honda', 'nissan', 'bmw',
            'mercedes', 'audi', 'volkswagen', 'vw', 'dodge', 'jeep', 'gmc',
            'cadillac', 'buick', 'pontiac', 'oldsmobile', 'lincoln', 'chrysler',
            'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi',
            'hyundai', 'kia', 'volvo', 'porsche', 'jaguar', 'land rover',
            'range rover', 'tesla', 'genesis', 'alfa romeo', 'fiat', 'mini'
          ];
          
          const titleLower = title.toLowerCase();
          let extractedMake = null;
          
          // Find make in title
          for (const makeName of makePatterns) {
            if (titleLower.includes(makeName)) {
              extractedMake = makeName === 'chevy' ? 'Chevrolet' : 
                             makeName === 'vw' ? 'Volkswagen' :
                             makeName === 'land rover' ? 'Land Rover' :
                             makeName === 'range rover' ? 'Range Rover' :
                             makeName === 'alfa romeo' ? 'Alfa Romeo' :
                             makeName.charAt(0).toUpperCase() + makeName.slice(1);
              break;
            }
          }
          
          // Try to extract model - look for pattern: year make model
          let extractedModel = null;
          if (extractedMake) {
            const yearMatch = title.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              const afterYearMake = title.substring(title.indexOf(yearMatch[0]) + 4)
                .replace(new RegExp(extractedMake, 'i'), '')
                .trim();
              
              // Take first word or two as model
              const modelParts = afterYearMake.split(/\s+/).slice(0, 2);
              if (modelParts.length > 0 && modelParts[0].length > 1) {
                extractedModel = modelParts.join(' ').split(/[-$\(]/)[0].trim();
              }
            }
          }
          
          return { make: extractedMake, model: extractedModel };
        };
        
        // Extract from title as fallback if scraper didn't find make/model
        const titleExtraction = scrapedData.title ? extractFromTitle(scrapedData.title) : { make: null, model: null };
        
        // Use scraped data, fallback to title extraction, but NEVER use "Unknown" - leave null or fail
        // Make is required - if we can't extract it, don't create the vehicle
        const finalMake = scrapedData.make || titleExtraction.make || null;
        const finalModel = scrapedData.model || titleExtraction.model || null;
        
        // Fail if we don't have make (required field)
        if (!finalMake || !finalMake.trim()) {
          console.warn('Cannot create vehicle - missing make');
          return; // Don't create vehicle with bad data
        }
        
        // Create vehicle immediately
        const vehicleData: any = {
          year: scrapedData.year ? parseInt(String(scrapedData.year)) : null,
          make: finalMake,
          model: finalModel,
          vin: scrapedData.vin || null,
          color: scrapedData.color || scrapedData.exterior_color || null,
          mileage: scrapedData.mileage ? parseInt(String(scrapedData.mileage).replace(/,/g, '')) : null,
          transmission: scrapedData.transmission || null,
          drivetrain: scrapedData.drivetrain || null,
          engine_size: scrapedData.engine_size || scrapedData.engine || null,
          asking_price: scrapedData.asking_price || scrapedData.price || null,
          discovery_source: isKSLUrl ? 'ksl_import' : 'craigslist_scrape',
          discovery_url: searchQuery.trim(),
          profile_origin: isKSLUrl ? 'ksl_import' : 'craigslist_scrape',
          source: isKSLUrl ? 'KSL Cars' : 'Craigslist',
          origin_metadata: {
            listing_url: searchQuery.trim(),
            asking_price: scrapedData.asking_price || scrapedData.price,
            imported_at: new Date().toISOString(),
            image_urls: scrapedData.images || [],
            source_platform: isKSLUrl ? 'ksl' : 'craigslist'
          },
          description: scrapedData.description || null, // Save to description field (not notes)
          notes: scrapedData.description || null, // Also save to notes for backwards compatibility
          is_public: true,
          status: 'active',
          uploaded_by: user.id
        };

        if (scrapedData.trim) vehicleData.trim = scrapedData.trim;
        if (scrapedData.series) vehicleData.series = scrapedData.series;

        const { data: newVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert(vehicleData)
          .select('id, year, make, model')
          .single();

        if (vehicleError) {
          console.error('Vehicle creation failed:', vehicleError);
          onSearchResults([], `Failed to create vehicle: ${vehicleError.message}`);
          setIsSearching(false);
          return;
        }

        // Extract and cache favicon for this source (non-blocking)
        const sourceInfo = detectSourceType(searchQuery.trim());
        extractAndCacheFavicon(
          searchQuery.trim(),
          sourceInfo?.type || 'classified',
          sourceInfo?.name || 'Craigslist'
        ).catch(err => {
          console.warn('Failed to cache favicon (non-critical):', err);
        });

        // Create timeline event for discovery (blocking to ensure it's created)
        const sourceName = isKSLUrl ? 'KSL Cars' : 'Craigslist';
        const askingPrice = scrapedData.asking_price || scrapedData.price;
        try {
          const { error: timelineError } = await supabase.from('timeline_events').insert({
            vehicle_id: newVehicle.id,
            user_id: user.id,
            event_type: 'auction_listed', // Valid type
            event_date: new Date().toISOString(),
            title: `Listed for Sale on ${sourceName}`,
            description: askingPrice 
              ? `${newVehicle.year} ${newVehicle.make} ${newVehicle.model} listed for $${askingPrice.toLocaleString()}`
              : `${newVehicle.year} ${newVehicle.make} ${newVehicle.model} discovered on ${sourceName}`,
            source: sourceName,
            source_type: 'dealer_record',
            data_source: searchQuery.trim(),
            confidence_score: 90,
            cost_amount: askingPrice || null,
            metadata: {
              discovery_url: searchQuery.trim(),
              discovery_source: 'craigslist_scrape',
              automated: true,
              asking_price: askingPrice,
              listing_title: scrapedData.title
            }
          });
          if (timelineError) {
            console.warn('Timeline event creation failed:', timelineError);
          }
        } catch (err) {
          console.warn('Timeline event creation error:', err);
        }
        
        // Create field sources for scraped data (non-blocking)
        const scrapedFields = [
          { field_name: 'asking_price', field_value: String(askingPrice || '') },
          { field_name: 'year', field_value: String(scrapedData.year || '') },
          { field_name: 'make', field_value: scrapedData.make || '' },
          { field_name: 'model', field_value: scrapedData.model || '' },
        ].filter(f => f.field_value);
        
        for (const field of scrapedFields) {
          supabase.from('vehicle_field_sources').insert({
            vehicle_id: newVehicle.id,
            field_name: field.field_name,
            field_value: field.field_value,
            source_type: 'ai_scraped',
            source_url: searchQuery.trim(),
            confidence_score: 90,
            user_id: user.id,
            extraction_method: 'url_scraping',
            metadata: { source: sourceName, scrape_date: new Date().toISOString() }
          }).then(() => {
            console.log(`✅ Field source created: ${field.field_name}`);
          }, (err: any) => {
            console.warn(`Failed to create field source for ${field.field_name}:`, err);
          });
        }

        // Queue AI analysis (bulletproof with retry logic)
        supabase.rpc('queue_analysis', {
          p_vehicle_id: newVehicle.id,
          p_analysis_type: 'expert_valuation',
          p_priority: 3,
          p_triggered_by: 'user'
        }).catch(() => {
          // Non-critical - analysis will be retried
        });

        // Import images directly if available
        if (scrapedData?.images && Array.isArray(scrapedData.images) && scrapedData.images.length > 0 && newVehicle.id) {
          
          let successCount = 0;
          const imagesToImport = scrapedData.images; // Import ALL images
          
          for (let i = 0; i < imagesToImport.length; i++) {
            const imageUrl = imagesToImport[i];
            if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
              console.warn(`⚠️ Skipping invalid image URL at index ${i}:`, imageUrl);
              continue;
            }
            
            try {
              // Upgrade to high-res if it's a Craigslist thumbnail
              const fullSizeUrl = String(imageUrl).replace('_600x450.jpg', '_1200x900.jpg').replace('_300x300.jpg', '_1200x900.jpg');

              if (!fullSizeUrl || typeof fullSizeUrl !== 'string') {
                continue;
              }
              
              // Download image
              const response = await fetch(fullSizeUrl);
              if (!response.ok) {
                continue;
              }

              const blob = await response.blob();
              
              // Use UnifiedImageImportService for proper attribution
              // Note: source should be 'scraper' not 'craigslist_scrape' based on the service definition
              const result = await UnifiedImageImportService.importImage({
                file: blob,
                vehicleId: newVehicle.id,
                source: 'scraper', // Use 'scraper' as defined in the service
                sourceUrl: imageUrl,
                importedBy: user.id,
                takenAt: scrapedData.posted_date ? new Date(scrapedData.posted_date) : undefined,
                category: 'exterior',
                makePrimary: i === 0, // First image is primary
                createTimelineEvent: i === 0, // Create timeline event for first image
                exifData: {
                  source_url: imageUrl,
                  discovery_url: searchQuery.trim(),
                  imported_by_user_id: user.id,
                  imported_at: new Date().toISOString(),
                  attribution_note: 'Photographer unknown - images from Craigslist listing. Original photographer can claim with proof.',
                  claimable: true
                }
              });
              
              if (result.success) {
                successCount++;
              }

              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 300));

            } catch {
              // Continue with next image
            }
          }
        }

        // Navigate to vehicle profile
        window.location.href = `/vehicle/${newVehicle.id}`;
        return;

      } catch (err: any) {
        console.error('Craigslist import error:', err);
        onSearchResults([], `Import failed: ${err.message || 'Unknown error'}`);
        setIsSearching(false);
        return;
      }
    }

    setIsSearching(true);
    try {
      // Prefer the unified search edge function when available (single request).
      // Fall back to the existing multi-query client search if invoke fails.
      let edgeFunctionWorked = false;
      try {
        const { data: edgeData, error: edgeError } = await supabase.functions.invoke('search', {
          body: {
            query: searchQuery.trim(),
            limit: 150
          }
        });

        if (!edgeError && edgeData && Array.isArray((edgeData as any).results)) {
          const edgeResults = (edgeData as any).results as SearchResult[];
          const edgeSummary = String((edgeData as any).search_summary || '') || `Found ${edgeResults.length} results for "${searchQuery.trim()}".`;
          onSearchResults(edgeResults, edgeSummary);
          edgeFunctionWorked = true;
          return;
        } else if (edgeError) {
          console.warn('Search Edge Function error (falling back to client search):', edgeError);
        }
      } catch (edgeErr: any) {
        // Edge function might not be deployed or network error - that's ok, use fallback
        console.warn('Search Edge Function unavailable (using client search):', edgeErr?.message || 'Unknown error');
      }

      const analysis = parseSearchQuery(searchQuery);

      let results: SearchResult[] = [];
      let searchInsights = {
        locations_found: 0,
        vehicles_for_sale: 0,
        stagnant_builds: 0,
        active_projects: 0,
        parts_available: 0
      };

      // Streamlined fallback: Only run essential searches
      // Priority: Vehicles first, then users/orgs, minimal other tables
      const essentialSearches = [
        searchVehicles(searchQuery, analysis),
        searchUsers(searchQuery, analysis),
        searchOrganizations(searchQuery, analysis)
      ];

      // Only add additional searches if query suggests them
      if (analysis.shop_query) {
        essentialSearches.push(searchShops(searchQuery, analysis));
      }
      if (analysis.parts_query) {
        essentialSearches.push(searchParts(searchQuery, analysis));
      }

      // Execute searches in parallel (3-5 queries instead of 10)
      const searchResults = await Promise.all(essentialSearches);

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

      // Always show results, even if empty - give user feedback
      if (results.length === 0) {
        onSearchResults([], `No results found for "${searchQuery.trim()}". Try a different search term or check your spelling.`);
      } else {
        const response: SearchResponse = {
          results: results.slice(0, 200),
          total_count: results.length,
          search_summary: summary,
          suggested_filters: generateSuggestedFilters(analysis, results),
          search_insights: searchInsights
        };
        onSearchResults(response.results, response.search_summary);
      }

    } catch (error: any) {
      console.error('Search error:', error);
      const errorMessage = error?.message || 'Unknown error';
      onSearchResults([], `Search encountered an error: ${errorMessage}. Please try again.`);
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
    const trimmed = initialQuery?.trim();
    if (trimmed && lastSearchedRef.current !== trimmed) {
      lastSearchedRef.current = trimmed;
      setHasInitialSearched(true);
      setIsSearching(true);
      setTimeout(() => {
        executeSearch(trimmed);
      }, 100);
    }
  }, [initialQuery, executeSearch]);

  const searchVehicles = async (query: string, analysis: any): Promise<SearchResult[]> => {
    try {
      const searchTerm = query.replace(/near me|for sale|buy/gi, '').trim();
      const searchTermSafe = escapeILike(searchTerm);
      const normalizeToken = (value: string) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizeHay = (value: string) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const rawTokens = searchTerm.split(/\s+/).filter(Boolean);
      const rawTokensLower = rawTokens.map((t) => t.toLowerCase()).filter((t) => t.length > 1);
      const tokens = rawTokens.map(normalizeToken).filter((t) => t.length > 1);
      const yearTokens = tokens.filter((t) => /^\d{4}$/.test(t));
      const textTokens = tokens.filter((t) => !/^\d{4}$/.test(t));
      const expandedTextTokens = new Set<string>(textTokens);
      if (analysis?.vehicle_specific) {
        expandedTextTokens.add(normalizeToken(analysis.vehicle_specific));
      }
      const uniqueTextTokens = Array.from(expandedTextTokens).filter(Boolean).slice(0, 6);
      const queryTokenVariants = new Set<string>([...rawTokensLower, ...uniqueTextTokens]);
      if (analysis?.vehicle_specific) {
        queryTokenVariants.add(String(analysis.vehicle_specific).toLowerCase());
      }
      const compoundHints = [
        'road',
        'runner',
        'super',
        'sport',
        'turbo',
        'grand',
        'touring',
        'street',
        'track',
        'speed',
        'power',
        'auto',
        'wagon',
        'pickup',
        'crew',
        'cab',
        'king',
        'range',
        'rover',
        'roadster',
        'spyder',
        'spider'
      ];
      const compoundPatterns = new Set<string>();
      const addCompoundVariants = (token: string) => {
        if (!token || token.length < 7) return;
        compoundHints.forEach((hint) => {
          const idx = token.indexOf(hint);
          if (idx === -1) return;
          const before = token.slice(0, idx);
          const after = token.slice(idx + hint.length);
          if (hint.length >= 3) queryTokenVariants.add(hint);
          if (before.length >= 3) queryTokenVariants.add(before);
          if (after.length >= 3) queryTokenVariants.add(after);
          if (before.length >= 3 && after.length >= 3) {
            const beforeSafe = escapeILike(before);
            const afterSafe = escapeILike(after);
            if (beforeSafe && afterSafe) {
              compoundPatterns.add(`${beforeSafe}%${afterSafe}`);
            }
          }
          if (idx === 0 && after.length >= 3) {
            const hintSafe = escapeILike(hint);
            const afterSafe = escapeILike(after);
            if (hintSafe && afterSafe) {
              compoundPatterns.add(`${hintSafe}%${afterSafe}`);
            }
          }
          if (idx > 0 && idx + hint.length === token.length && before.length >= 3) {
            const beforeSafe = escapeILike(before);
            const hintSafe = escapeILike(hint);
            if (beforeSafe && hintSafe) {
              compoundPatterns.add(`${beforeSafe}%${hintSafe}`);
            }
          }
        });
      };
      tokens.forEach(addCompoundVariants);
      
      if (!searchTerm) {
        return [];
      }

      // Try hybrid full-text search (PostgreSQL + BM25)
      let vehicles: any[] = [];
      let hybridVehicles: any[] = [];
      try {
        hybridVehicles = await fullTextSearchService.searchVehiclesHybrid(searchTerm, {
          limit: 40
        });
      } catch (ftError) {
        // Full-text search RPC might not exist, fall through to simple search
        console.log('Full-text search unavailable, using simple search');
      }

      vehicles = hybridVehicles;

      // If full-text search returned few or no results, use simple search to widen recall
      if (vehicles.length < 6) {
        let vehicleQuery = supabase
          .from('vehicles')
          .select('id, year, make, model, normalized_model, series, trim, title, vin, color, description, created_at, uploaded_by')
          .eq('is_public', true);

        // Apply filters based on analysis
        if (analysis.vehicle_specific) {
          const specificSafe = escapeILike(analysis.vehicle_specific);
          vehicleQuery = vehicleQuery.or(`model.ilike.%${specificSafe}%,normalized_model.ilike.%${specificSafe}%,series.ilike.%${specificSafe}%,trim.ilike.%${specificSafe}%`);
        }

        const orClauses: string[] = [];
        Array.from(queryTokenVariants).forEach((token) => {
          const tokenSafe = escapeILike(token);
          if (!tokenSafe) return;
          orClauses.push(
            `make.ilike.%${tokenSafe}%`,
            `model.ilike.%${tokenSafe}%`,
            `normalized_model.ilike.%${tokenSafe}%`,
            `series.ilike.%${tokenSafe}%`,
            `trim.ilike.%${tokenSafe}%`,
            `title.ilike.%${tokenSafe}%`,
            `description.ilike.%${tokenSafe}%`
          );
          const isVIN = /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(token.replace(/[^A-Z0-9]/gi, ''));
          if (isVIN) {
            orClauses.push(`vin.ilike.%${tokenSafe}%`);
          }
        });
        compoundPatterns.forEach((pattern) => {
          orClauses.push(
            `model.ilike.%${pattern}%`,
            `normalized_model.ilike.%${pattern}%`,
            `title.ilike.%${pattern}%`,
            `description.ilike.%${pattern}%`
          );
        });
        yearTokens.forEach((yearToken) => {
          const year = parseInt(yearToken, 10);
          if (Number.isFinite(year)) {
            orClauses.push(`year.eq.${year}`);
          }
        });

        if (orClauses.length > 0) {
          vehicleQuery = vehicleQuery.or(orClauses.join(','));
        } else {
          // Fallback to original term when tokenization yields nothing useful
          vehicleQuery = vehicleQuery.or(`make.ilike.%${searchTermSafe}%,model.ilike.%${searchTermSafe}%,description.ilike.%${searchTermSafe}%`);
        }

        const { data: simpleResults, error } = await vehicleQuery.limit(100);
        
        if (error) {
          console.error('Simple vehicle search error:', error);
          // Don't return empty - try even simpler search
          const fallbackQuery = supabase
            .from('vehicles')
            .select('id, year, make, model, normalized_model, series, trim, title, vin, color, description, created_at, uploaded_by')
            .eq('is_public', true)
            .ilike('make', `%${searchTermSafe}%`)
            .limit(50);
          
          const { data: fallbackResults } = await fallbackQuery;
          const fallbackVehicles = (fallbackResults || []).map((v: any) => ({
            id: v.id,
            year: v.year,
            make: v.make,
            model: v.model,
            color: v.color,
            description: v.description,
            created_at: v.created_at,
            relevance: 0.3
          }));
          const vehicleMap = new Map<string, any>();
          hybridVehicles.forEach((v: any) => vehicleMap.set(v.id, v));
          fallbackVehicles.forEach((v: any) => {
            if (!vehicleMap.has(v.id)) {
              vehicleMap.set(v.id, v);
            }
          });
          vehicles = Array.from(vehicleMap.values());
        } else {
          const cleaned = (simpleResults || []).map((v: any) => {
            const hay = normalizeHay([
              v.year,
              v.make,
              v.model,
              v.normalized_model,
              v.series,
              v.trim,
              v.title,
              v.vin,
              v.color,
              v.description
            ].filter(Boolean).join(' '));
            const hayCompact = hay.replace(/\s+/g, '');
            const tokenMatches = uniqueTextTokens.filter((t) => hay.includes(t) || hayCompact.includes(t)).length;
            const requiredMatches = uniqueTextTokens.length <= 2
              ? 1
              : Math.ceil(uniqueTextTokens.length * 0.6);
            const textMatchOk = uniqueTextTokens.length === 0 || tokenMatches >= requiredMatches;
            const yearMatchOk = yearTokens.length === 0 || yearTokens.some((y) => String(v.year || '') === y);
            if (!textMatchOk || !yearMatchOk) return null;

            const matchRatio = uniqueTextTokens.length > 0 ? tokenMatches / uniqueTextTokens.length : 0.5;
            const relevance = Math.min(1, 0.35 + matchRatio * 0.55 + (yearMatchOk && yearTokens.length > 0 ? 0.1 : 0));
            return {
              id: v.id,
              year: v.year,
              make: v.make,
              model: v.model,
              color: v.color,
              description: v.description,
              created_at: v.created_at,
              relevance
            };
          }).filter(Boolean);

          const vehicleMap = new Map<string, any>();
          hybridVehicles.forEach((v: any) => vehicleMap.set(v.id, v));
          cleaned.forEach((v: any) => {
            const existing = vehicleMap.get(v.id);
            if (!existing || (v.relevance || 0) > (existing.relevance || 0)) {
              vehicleMap.set(v.id, v);
            }
          });
          vehicles = Array.from(vehicleMap.values());
        }
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
      const events = await fullTextSearchService.searchTimelineEvents(searchTerm, { limit: 40 });

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
        .limit(40);

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
      const searchTermSafe = escapeILike(searchTerm);
      if (!searchTerm) {
        return [];
      }

      const { data: shops, error } = await supabase
        .from('shops')
        .select('id, name, description, location_city, location_state, created_at')
        .eq('is_verified', true) // Only show verified shops
        .or(`name.ilike.%${searchTermSafe}%,description.ilike.%${searchTermSafe}%`)
        .limit(30);

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
      const searchTermSafe = escapeILike(searchTerm);
      if (!searchTerm) {
        return [];
      }

      // Use full-text search
      let orgs = await fullTextSearchService.searchBusinesses(searchTerm, { limit: 30 });

      // Fallback to simple ILIKE search if full-text search returns no results
      if (orgs.length === 0) {
        const { data: simpleSearchOrgs, error: simpleError } = await supabase
          .from('businesses')
          .select('id, business_name, legal_name, description, city, state, created_at')
          .eq('is_public', true)
          .or(`business_name.ilike.%${searchTermSafe}%,legal_name.ilike.%${searchTermSafe}%,description.ilike.%${searchTermSafe}%`)
          .limit(30);

        if (!simpleError && simpleSearchOrgs) {
          orgs = simpleSearchOrgs.map((org: any) => ({
            id: org.id,
            business_name: org.business_name,
            legal_name: org.legal_name,
            description: org.description,
            city: org.city,
            state: org.state,
            created_at: org.created_at,
            relevance: 0.8 // Default relevance for simple search
          }));
        }
      }

      // Also search through related vehicles
      const yearMatch = searchTerm.match(/^\d{4}$/);
      let relatedVehiclesQuery = supabase
        .from('vehicles')
        .select('id, year, make, model')
        .eq('is_public', true);
      
      if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        relatedVehiclesQuery = relatedVehiclesQuery.or(`year.eq.${year},make.ilike.%${searchTermSafe}%,model.ilike.%${searchTermSafe}%`);
      } else {
        relatedVehiclesQuery = relatedVehiclesQuery.or(`make.ilike.%${searchTermSafe}%,model.ilike.%${searchTermSafe}%`);
      }
      
      const { data: relatedVehicles } = await relatedVehiclesQuery.limit(12);

      // Fetch full org details for location data
      const orgIds = orgs.map((o: any) => o.id);
      const { data: orgDetails } = orgIds.length > 0 ? await supabase
        .from('businesses')
        .select('id, latitude, longitude, address, business_type, specializations, services_offered')
        .in('id', orgIds) : { data: [] };

      const orgDetailsMap = (orgDetails || []).reduce((acc: any, org: any) => {
        acc[org.id] = org;
        return acc;
      }, {});

      return orgs.map((org: any) => {
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

      const results: SearchResult[] = [];

      // 1. Search profiles (internal users)
      const users = await fullTextSearchService.searchProfiles(searchTerm, { limit: 25 });
      users.forEach(user => {
        results.push({
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
        });
      });

      // 2. Search external identities (BaT usernames, etc.)
      const { data: externalIdentities, error: extError } = await supabase
        .from('external_identities')
        .select('id, platform, handle, metadata')
        .or(`handle.ilike.%${searchTerm}%,handle.ilike.%${searchTerm.toLowerCase()}%`)
        .limit(25);

      if (!extError && externalIdentities) {
        externalIdentities.forEach(identity => {
          const metadata = identity.metadata || {};
          const memberSince = metadata.member_since;
          const commentsCount = metadata.comments_count || metadata.total_comments || 0;
          const description = memberSince 
            ? `BaT member since ${memberSince}${commentsCount ? ` • ${commentsCount} comments` : ''}`
            : `${identity.platform.toUpperCase()} user${commentsCount ? ` • ${commentsCount} comments` : ''}`;

          results.push({
            id: `external_${identity.id}`,
            type: 'user' as const,
            title: identity.handle,
            description: description,
            metadata: {
              platform: identity.platform,
              handle: identity.handle,
              external_identity_id: identity.id,
              member_since: memberSince,
              comments_count: commentsCount,
              metadata: metadata
            },
            relevance_score: identity.handle.toLowerCase() === searchTerm.toLowerCase() ? 0.9 : 0.7,
            created_at: metadata.scraped_at || null
          });
        });
      }

      // Sort by relevance (exact match first)
      results.sort((a, b) => {
        if (a.relevance_score !== b.relevance_score) {
          return b.relevance_score - a.relevance_score;
        }
        // If relevance is same, prefer external identities with more comments
        const aComments = a.metadata?.comments_count || 0;
        const bComments = b.metadata?.comments_count || 0;
        return bComments - aComments;
      });

      return results.slice(0, 20); // Return top 20
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
        .limit(40);

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
      const searchTermSafe = escapeILike(searchTerm);
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
        .or(`title.ilike.%${searchTermSafe}%,description.ilike.%${searchTermSafe}%,document_type.ilike.%${searchTermSafe}%`)
        .limit(40);

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
      const searchTermSafe = escapeILike(searchTerm);
      if (!searchTerm) {
        return [];
      }

      // Search in external_listings (BAT, etc.) for auction listings
      // First get vehicles matching the search term
      const { data: matchingVehicles } = await supabase
        .from('vehicles')
        .select('id')
        .or(`make.ilike.%${searchTermSafe}%,model.ilike.%${searchTermSafe}%`)
        .limit(120);

      if (!matchingVehicles || matchingVehicles.length === 0) {
        return [];
      }

      const vehicleIds = matchingVehicles.map(v => v.id);
      
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
        .in('vehicle_id', vehicleIds)
        .limit(25);

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
      // Use separate queries to avoid .or() syntax issues
      const { data: libsByTitle } = await supabase
        .from('reference_libraries')
        .select('id, title, description, created_at')
        .ilike('title', `%${searchTerm}%`)
        .limit(30);

      const { data: libsByDesc } = await supabase
        .from('reference_libraries')
        .select('id, title, description, created_at')
        .ilike('description', `%${searchTerm}%`)
        .limit(30);

      // Combine and deduplicate
      const allLibs = [...(libsByTitle || []), ...(libsByDesc || [])];
      const uniqueLibs = Array.from(new Map(allLibs.map(l => [l.id, l])).values()).slice(0, 20);
      
      const libs = uniqueLibs;
      const libError = null;

      if (libs && libs.length > 0) {
        refs = libs;
      } else {
        // Try library_documents as fallback - use separate queries
        const { data: docsByTitle } = await supabase
          .from('library_documents')
          .select('id, title, description, created_at')
          .ilike('title', `%${searchTerm}%`)
          .limit(30);

        const { data: docsByDesc } = await supabase
          .from('library_documents')
          .select('id, title, description, created_at')
          .ilike('description', `%${searchTerm}%`)
          .limit(30);

        const allDocs = [...(docsByTitle || []), ...(docsByDesc || [])];
        const uniqueDocs = Array.from(new Map(allDocs.map(d => [d.id, d])).values()).slice(0, 20);
        
        if (uniqueDocs.length > 0) {
          refs = uniqueDocs;
        }
      }

      // No error logging - tables might not exist, that's okay
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
    e?.stopPropagation();
    const searchTerm = query.trim();
    if (searchTerm) {
      saveToHistory(searchTerm);
      executeSearch(searchTerm);
      setShowSuggestions(false);

      // Track search analytics (fire-and-forget)
      supabase.from('search_analytics').insert({
        query: searchTerm,
        timestamp: new Date().toISOString()
      }).catch(() => {});
    }
  };

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
  useKeyboardShortcut({
    key: 'k',
    meta: true,
    callback: () => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        setShowSuggestions(true);
      }
    }
  });

  // Add explicit keyboard handler for Enter key and navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && autocompleteResults.length > 0) {
        const selected = autocompleteResults[selectedSuggestionIndex];
        if (selected.type === 'vehicle') {
          navigate(`/vehicle/${selected.id}`);
        } else if (selected.type === 'organization') {
          navigate(`/org/${selected.id}`);
        } else if (selected.type === 'user' && selected.id?.startsWith('external_')) {
          const externalId = selected.id.replace('external_', '');
          navigate(`/profile/external/${externalId}`);
        } else if (selected.type === 'user') {
          navigate(`/profile/${selected.id}`);
        }
        setShowSuggestions(false);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => 
        prev < autocompleteResults.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
    setShowSuggestions(false);
    executeSearch(suggestion);
  };

  // Check if query is a URL
  const isUrl = (str: string): boolean => {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      // Check if it looks like a URL (starts with http:// or https:// or common domains)
      return /^(https?:\/\/|www\.|[a-z0-9-]+\.(com|org|net|edu|gov|io|co|us|uk|ca|au|de|fr|it|es|nl|be|se|no|dk|fi|pl|cz|at|ch|ie|pt|gr|ru|jp|cn|kr|in|br|mx|ar|cl|za|nz|ae|sa|il|tr|eg|ma|ng|ke|gh|tz|ug|zm|bw|zw|mw|mz|ao|sn|ci|cm|td|ne|ml|bf|bj|tg|gw|gn|sl|lr|mr|dj|so|et|sd|er|ss|cf|cd|cg|ga|gq|st|km|mu|sc|mg|re|yt|bi|rw|ug|tz|zm|bw|zw|mw|mz|ao|sn|ci|cm|td|ne|ml|bf|bj|tg|gw|gn|sl|lr|mr|dj|so|et|sd|er|ss|cf|cd|cg|ga|gq|st|km|mu|sc|mg|re|yt))/i.test(str.trim());
    }
  };

  const queryIsUrl = isUrl(query.trim());

  return (
    <div className="intelligent-search" style={{ position: 'relative' }}>
      <form onSubmit={handleSubmit}>
        <div style={{ position: 'relative' }}>
          {/* Favicon icon inside input (left side) - like browser address bar */}
          {queryIsUrl && (
            <div style={{
              position: 'absolute',
              left: '6px',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 10,
              pointerEvents: 'none'
            }}>
              <FaviconIcon url={query.trim()} size={14} />
            </div>
          )}
          
          <input
            ref={searchInputRef}
            type="text"
            className="input"
            placeholder="Search vehicles, organizations, parts... (⌘K)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedSuggestionIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            style={{
              fontSize: '9pt',
              padding: queryIsUrl ? '4px 50px 4px 24px' : '4px 50px 4px 8px', // Extra left padding when URL detected
              background: 'var(--white)',
              border: '2px solid var(--border)',
              borderRadius: '0px',
              fontFamily: '"MS Sans Serif", sans-serif',
              transition: 'all 0.12s ease'
            }}
          />

          <button
            type="submit"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSubmit(e);
            }}
            disabled={isSearching}
            className="button-win95"
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '2px 8px',
              fontSize: '8pt',
              height: '20px',
              minWidth: '40px',
              cursor: isSearching ? 'not-allowed' : 'pointer'
            }}
          >
            {isSearching ? '...' : 'GO'}
          </button>
        </div>
      </form>

      {/* Search Suggestions & Autocomplete */}
      {showSuggestions && (autocompleteResults.length > 0 || suggestions.length > 0 || searchHistory.length > 0) && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--surface)',
          border: '2px solid #000',
          borderRadius: '0px',
          marginTop: '4px',
          boxShadow: '0 8px 25px rgba(0,0,0,0.15)',
          zIndex: 1000,
          maxHeight: '400px',
          overflowY: 'auto'
        }}>
          {/* Autocomplete Results */}
          {autocompleteResults.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              <div style={{ padding: '4px 16px', fontSize: '8pt', fontWeight: 700, color: '#000', textTransform: 'uppercase' }}>
                Quick Results
              </div>
              {autocompleteResults.map((result, index) => (
                <div
                  key={result.id}
                  onClick={() => {
                    if (result.type === 'vehicle') {
                      navigate(`/vehicle/${result.id}`);
                    } else if (result.type === 'organization') {
                      navigate(`/org/${result.id}`);
                    } else if (result.type === 'user' && result.id?.startsWith('external_')) {
                      const externalId = result.id.replace('external_', '');
                      navigate(`/profile/external/${externalId}`);
                    } else if (result.type === 'user') {
                      navigate(`/profile/${result.id}`);
                    }
                    setShowSuggestions(false);
                  }}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: '9pt',
                    borderBottom: '1px solid #e5e7eb',
                    background: selectedSuggestionIndex === index ? '#f0f0f0' : 'white',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onMouseEnter={() => setSelectedSuggestionIndex(index)}
                  onMouseLeave={() => setSelectedSuggestionIndex(-1)}
                >
                  <span style={{
                    fontSize: '8pt',
                    fontWeight: 700,
                    color: '#000',
                    minWidth: '20px'
                  }}>
                    {result.type === 'vehicle' ? 'V' : result.type === 'organization' ? 'O' : 'U'}
                  </span>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <span>{result.title}</span>
                    {result.type === 'user' && result.metadata?.subtitle && (
                      <span style={{ fontSize: '7pt', color: '#666', marginTop: '2px' }}>
                        {result.metadata.subtitle}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div style={{ padding: '8px 0', borderTop: autocompleteResults.length > 0 ? '1px solid #e5e7eb' : 'none' }}>
              <div style={{ padding: '4px 16px', fontSize: '8pt', fontWeight: 700, color: '#000', textTransform: 'uppercase' }}>
                Suggestions
              </div>
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  onClick={() => handleSuggestionClick(suggestion)}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: '9pt',
                    borderBottom: '1px solid #e5e7eb'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}

          {/* Recent Searches */}
          {searchHistory.length > 0 && (
            <div style={{ padding: '8px 0', borderTop: (autocompleteResults.length > 0 || suggestions.length > 0) ? '1px solid #e5e7eb' : 'none' }}>
              <div style={{ padding: '4px 16px', fontSize: '8pt', fontWeight: 700, color: '#000', textTransform: 'uppercase' }}>
                Recent Searches
              </div>
              {searchHistory.slice(0, 5).map((historyQuery, index) => (
                <div
                  key={index}
                  onClick={() => handleSuggestionClick(historyQuery)}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: '9pt',
                    color: '#666'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f0f0'}
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