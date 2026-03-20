import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import IntelligentSearch from '../components/search/IntelligentSearch';
import type { SearchMeta } from '../components/search/IntelligentSearch';
import SearchResults from '../components/search/SearchResults';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { aiGateway } from '../lib/aiGateway';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { SearchResult } from '../types/search';
import { applyNonAutoFilters } from '../lib/nonAutoExclusion';
import '../styles/unified-design-system.css';

interface VehicleFilters {
  make: string;
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  mileageMax: string;
  transmission: string;
  listingStatus: string;
  showFilters: boolean;
}

const DEFAULT_FILTERS: VehicleFilters = {
  make: '',
  priceMin: '',
  priceMax: '',
  yearMin: '',
  yearMax: '',
  mileageMax: '',
  transmission: '',
  listingStatus: '',
  showFilters: true,
};

export default function Search() {
  const navigate = useNavigate();
  // useAuth reads from global AuthContext — synchronous for returning users
  const { user: authUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchSummary, setSearchSummary] = useState('');
  const [loading, setLoading] = useState(() => Boolean(searchParams.get('q')));
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [resultFilter, setResultFilter] = useState<
    'all' | 'vehicle' | 'organization' | 'shop' | 'part' | 'user' | 'timeline_event' | 'image' | 'document' | 'auction' | 'reference' | 'source'
  >('all');
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const [vFilters, setVFilters] = useState<VehicleFilters>(DEFAULT_FILTERS);

  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [answer, setAnswer] = useState<string>('');
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<Array<{ title: string; href?: string }>>([]);
  const answerRequestIdRef = useRef(0);
  const [showWorkstation, setShowWorkstation] = useState(false);

  // Featured vehicles for empty state
  const [featuredVehicles, setFeaturedVehicles] = useState<Array<{
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    primary_image_url: string | null;
    sale_price: number | null;
  }>>([]);

  useEffect(() => {
    if (searchQuery) return;
    let q = supabase
      .from('vehicles')
      .select('id,year,make,model,primary_image_url,sale_price')
      .eq('is_public', true)
      .not('primary_image_url', 'is', null)
      .not('year', 'is', null);
    q = applyNonAutoFilters(q);
    q = q.is('origin_organization_id', null);
    q.order('sale_price', { ascending: false, nullsFirst: false })
      .limit(24)
      .then(({ data }) => {
        if (data) setFeaturedVehicles(data);
      })
      .catch(() => {});
  }, [searchQuery]);

  // VIN search state
  const [vinInput, setVinInput] = useState('');
  const [vinSearching, setVinSearching] = useState(false);
  const [vinResults, setVinResults] = useState<any[]>([]);
  const [vinError, setVinError] = useState<string | null>(null);
  const [showVinSearch, setShowVinSearch] = useState(false);

  const handleVinSearch = useCallback(async (vin: string) => {
    const v = vin.trim().toUpperCase();
    if (!v || v.length < 5) {
      setVinError('Enter at least 5 characters of the VIN');
      return;
    }
    setVinSearching(true);
    setVinError(null);
    setVinResults([]);

    try {
      // Try exact/partial match in vehicles table directly
      const isExact = v.length === 17;
      let query = supabase
        .from('vehicles')
        .select('id, year, make, model, vin, color, mileage, primary_image_url, sale_price, discovery_url')
        .eq('is_public', true);

      if (isExact) {
        query = query.ilike('vin', v);
      } else {
        query = query.ilike('vin', `%${v}%`);
      }

      const { data, error } = await query.limit(10);

      if (error) throw error;

      if (!data || data.length === 0) {
        setVinError(`No vehicles found for VIN "${v}" in the Nuke database.`);
      } else if (data.length === 1) {
        // Direct navigation for exact single hit
        navigate(`/vehicle/${data[0].id}`);
        return;
      } else {
        setVinResults(data);
      }
    } catch (e: any) {
      setVinError(e?.message || 'VIN lookup failed');
    } finally {
      setVinSearching(false);
    }
  }, [navigate]);

  const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const detectMakeFromQuery = (q: string): string | null => {
    const t = (q || '').toLowerCase();
    const makes = [
      'porsche',
      'volkswagen',
      'vw',
      'bmw',
      'mercedes',
      'audi',
      'toyota',
      'honda',
      'ford',
      'chevrolet',
      'chevy',
      'gmc',
      'dodge',
      'jeep',
      'tesla',
    ];
    for (const m of makes) {
      if (t.includes(m)) {
        if (m === 'vw') return 'volkswagen';
        if (m === 'chevy') return 'chevrolet';
        return m;
      }
    }
    return null;
  };

  const looksLikeOwnershipCountQuestion = (q: string) => {
    const t = (q || '').toLowerCase();
    return /how\s+many\b/.test(t) && /\b(do\s+i\s+own|i\s+own|do\s+i\s+have|i\s+have)\b/.test(t);
  };

  const looksLikeNearbyCurationQuestion = (q: string) => {
    const t = (q || '').toLowerCase();
    return /\b(near\s+me|nearby|in\s+this\s+area|around\s+here|in\s+my\s+area)\b/.test(t);
  };

  const looksLikeVibeQuestion = (q: string) => {
    const t = (q || '').toLowerCase();
    return /\b(vibe|coolest\s+spots|cool\s+spots|car\s+show|collectors?|richest\s+history|best\s+set\s+of\s+cars)\b/.test(t);
  };

  const buildStructuredSources = async (q: string) => {
    const trimmed = (q || '').trim();
    if (!trimmed) return [] as Array<{ title: string; text: string; href?: string }>;

    const sources: Array<{ title: string; text: string; href?: string }> = [];
    const make = detectMakeFromQuery(trimmed);
    const isMissingListingKindColumn = (err: any) => {
      const code = String((err as any)?.code || '').toUpperCase();
      const message = String(err?.message || '').toLowerCase();
      if (!message.includes('listing_kind')) return false;
      if (code === '42703' || code === 'PGRST204') return true;
      return message.includes('does not exist') || message.includes('schema cache');
    };

    const wantsCount = looksLikeOwnershipCountQuestion(trimmed);
    const wantsNearby = looksLikeNearbyCurationQuestion(trimmed) || looksLikeVibeQuestion(trimmed);
    const wantsVibe = looksLikeVibeQuestion(trimmed);

    // Use user from global AuthContext — no extra getUser() call
    const currentUserId: string | null = authUser?.id ?? null;

    if (wantsCount && currentUserId) {
      try {
        const runCountQuery = async (includeListingKind: boolean) => {
          let queryBuilder = supabase
            .from('vehicles')
            .select('id', { count: 'exact', head: true });
          if (includeListingKind) queryBuilder = queryBuilder.eq('listing_kind', 'vehicle');

          if (make) {
            queryBuilder = queryBuilder.ilike('make', `%${make}%`);
          }

          // Be liberal on ownership fields; schema may include owner_id, user_id, or uploaded_by.
          queryBuilder = queryBuilder.or(`owner_id.eq.${currentUserId},user_id.eq.${currentUserId},uploaded_by.eq.${currentUserId}`);
          return await queryBuilder;
        };

        let { count, error } = await runCountQuery(true);
        if (error && isMissingListingKindColumn(error)) {
          ({ count, error } = await runCountQuery(false));
        }
        if (!error) {
          sources.push({
            title: make ? `Your ${make} count` : 'Your vehicle count',
            text: JSON.stringify({ make: make ?? null, count: count ?? 0 })
          });
        }
      } catch {
        // ignore
      }
    }

    if (wantsNearby && userLocation) {
      const radiusMeters = 80000; // baseline: ~50 miles
      const lat = userLocation.lat;
      const lng = userLocation.lng;
      const approxLatDelta = radiusMeters / 111000;
      const approxLngDelta = radiusMeters / (111000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

      try {
        const runNearbyQuery = async (includeListingKind: boolean) => {
          let vq = supabase
            .from('vehicles')
            .select('id, year, make, model, is_for_sale, latitude, longitude, created_at, owner_id, user_id, uploaded_by')
            .eq('is_public', true);
          if (includeListingKind) vq = vq.eq('listing_kind', 'vehicle');
          vq = vq
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .not('year', 'is', null)
            .not('make', 'is', null)
            .not('model', 'is', null)
            .gte('latitude', lat - approxLatDelta)
            .lte('latitude', lat + approxLatDelta)
            .gte('longitude', lng - approxLngDelta)
            .lte('longitude', lng + approxLngDelta)
            .limit(300);

          if (make) {
            vq = vq.ilike('make', `%${make}%`);
          }
          return await vq;
        };

        let { data: vehicles, error } = await runNearbyQuery(true);
        if (error && isMissingListingKindColumn(error)) {
          ({ data: vehicles, error } = await runNearbyQuery(false));
        }
        if (!error && vehicles && vehicles.length > 0) {
          const withDistance = vehicles
            .map((v: any) => {
              const d = haversineMeters(lat, lng, Number(v.latitude), Number(v.longitude));
              return { ...v, distance_meters: d };
            })
            .filter((v: any) => Number.isFinite(v.distance_meters) && v.distance_meters <= radiusMeters)
            .sort((a: any, b: any) => a.distance_meters - b.distance_meters);

          const top = withDistance.slice(0, 12).map((v: any) => ({
            id: v.id,
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim(),
            distance_miles: Math.round((v.distance_meters / 1609.34) * 10) / 10,
            is_for_sale: !!v.is_for_sale,
          }));

          sources.push({
            title: make ? `Nearby ${make} vehicles (public)` : 'Nearby vehicles (public)',
            text: JSON.stringify({
              radius_miles: Math.round((radiusMeters / 1609.34) * 10) / 10,
              count: withDistance.length,
              top
            })
          });

          if (wantsVibe) {
            const byMake = new Map<string, number>();
            const ownerSet = new Set<string>();
            let forSaleCount = 0;
            withDistance.forEach((v: any) => {
              const mk = String(v.make || '').trim() || 'Unknown';
              byMake.set(mk, (byMake.get(mk) || 0) + 1);
              if (v.is_for_sale) forSaleCount++;
              const oid = v.owner_id || v.user_id || v.uploaded_by;
              if (oid) ownerSet.add(String(oid));
            });
            const topMakes = Array.from(byMake.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([mk, ct]) => ({ make: mk, count: ct }));

            sources.push({
              title: 'Area vibe snapshot (public vehicles)',
              text: JSON.stringify({
                radius_miles: Math.round((radiusMeters / 1609.34) * 10) / 10,
                total_vehicles: withDistance.length,
                unique_owners_approx: ownerSet.size,
                for_sale_count: forSaleCount,
                top_makes: topMakes
              })
            });
          }
        } else if (!error) {
          sources.push({
            title: make ? `Nearby ${make} vehicles (public)` : 'Nearby vehicles (public)',
            text: JSON.stringify({ radius_miles: Math.round((radiusMeters / 1609.34) * 10) / 10, count: 0, top: [] })
          });
        }
      } catch {
        // ignore
      }
    }

    return sources;
  };

  const looksLikeQuestion = (q: string) => {
    const t = (q || '').trim().toLowerCase();
    if (!t) return false;
    if (t.includes('?')) return true;
    if (/^(what|why|how|when|where|who|which|are|is|do|does|did|can|should|could|would)\b/i.test(t)) return true;
    if (/\b(same\b|difference\b|vs\b|compare\b|better\b|best\b|everyone\s+loves\b)\b/i.test(t)) return true;
    return false;
  };

  const buildResultHref = (r: SearchResult): string | undefined => {
    switch (r.type) {
      case 'vehicle':
        return `/vehicle/${r.id}`;
      case 'organization':
        return `/org/${r.id}`;
      case 'user':
        return `/profile/${r.id}`;
      case 'shop':
        return `/org/${r.id}`;
      case 'part':
        return `/parts/${r.id}`;
      case 'timeline_event':
        return r.metadata?.vehicle_id ? `/vehicle/${r.metadata.vehicle_id}` : undefined;
      case 'image':
        return r.metadata?.vehicle_id ? `/vehicle/${r.metadata.vehicle_id}` : `/images/${r.id}`;
      case 'auction':
        return r.metadata?.listing_url ? String(r.metadata.listing_url) : undefined;
      case 'source':
        return r.metadata?.url ? String(r.metadata.url) : (r.metadata?.domain ? `https://${String(r.metadata.domain)}` : undefined);
      default:
        return undefined;
    }
  };

  const generateAnswer = async (q: string, rs: SearchResult[]) => {
    const trimmed = (q || '').trim();
    if (!trimmed) return;

    answerRequestIdRef.current += 1;
    const myRequestId = answerRequestIdRef.current;
    setAnswerLoading(true);
    setAnswerError(null);
    setAnswer('');

    const structured = await buildStructuredSources(trimmed);
    const top = (rs || []).slice(0, 8);
    const sources = [
      ...structured.map((s) => ({ title: s.title, href: s.href })),
      ...top.map((r) => ({ title: r.title, href: buildResultHref(r) })),
    ];
    setAnswerSources(sources);

    try {
      const structuredContext = structured
        .map((s, idx) => {
          const payload = (s.text || '').slice(0, 2000);
          return `SOURCE ${idx + 1}: structured\nTITLE: ${s.title}\nDATA: ${payload}`;
        })
        .join('\n\n');

      const topContext = top
        .map((r, idx) => {
          const desc = (r.description || '').slice(0, 400);
          const meta = r.metadata ? JSON.stringify(r.metadata).slice(0, 400) : '';
          return `SOURCE ${structured.length + idx + 1}: ${r.type}\nTITLE: ${r.title}\nDESCRIPTION: ${desc}${meta ? `\nMETADATA: ${meta}` : ''}`;
        })
        .join('\n\n');

      const context = [structuredContext, topContext].filter(Boolean).join('\n\n');

      const requestPayload = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are a search assistant. Answer the user question using ONLY the provided SOURCES. If the sources are insufficient, say what is missing and suggest a better search query. Keep it concise. When you use a source, cite it like [1], [2].'
          },
          {
            role: 'user',
            content: `QUESTION:\n${trimmed}\n\nSOURCES:\n${context || '(no sources)'}\n\nReturn a short answer, then a short list of citations like: Sources: [1] [3].`
          }
        ],
        max_tokens: 350,
        temperature: 0.2
      };

      const gatewayResult = await aiGateway.makeRequest('openai', 'gpt-4o', requestPayload, {
        cache: false,
        fallback: true,
      });

      const content: string | undefined = gatewayResult?.choices?.[0]?.message?.content;
      if (myRequestId !== answerRequestIdRef.current) return;
      if (!content) {
        setAnswerError('No answer returned');
        return;
      }

      setAnswer(String(content).trim());
    } catch (e: any) {
      if (myRequestId !== answerRequestIdRef.current) return;
      setAnswerError(e?.message || 'Failed to generate answer');
    } finally {
      if (myRequestId === answerRequestIdRef.current) {
        setAnswerLoading(false);
      }
    }
  };

  // Get user location if needed
  useEffect(() => {
    const t = (searchQuery || '').toLowerCase();
    if (t.includes('near me') || t.includes('nearby') || t.includes('in this area') || t.includes('around here') || t.includes('in my area')) {
      navigator.geolocation?.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => {
          // Could not get user location - ignore
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

  const handleSearchResults = useCallback((searchResults: SearchResult[], summary: string) => {
    setResults(searchResults);
    setSearchSummary(summary);
    setLoading(false);
    setResultFilter('all');
    setSearchMeta(null);
    setLoadingMore(false);
    // Reset vehicle-specific filters when new search runs (keep showFilters state)
    setVFilters(prev => ({ ...DEFAULT_FILTERS, showFilters: prev.showFilters }));
    // Scroll to results
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    const q = searchQuery.trim();
    if (looksLikeQuestion(q)) {
      generateAnswer(q, searchResults);
    } else {
      setAnswer('');
      setAnswerError(null);
      setAnswerLoading(false);
      setAnswerSources([]);
    }
  }, [searchQuery]);

  const handleSearchMeta = useCallback((meta: SearchMeta) => {
    setSearchMeta(meta);
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (!searchMeta || !searchMeta.has_more || loadingMore) return;
    const nextOffset = searchMeta.offset + searchMeta.limit;
    setLoadingMore(true);
    try {
      const { data: edgeData, error: edgeError } = await supabase.functions.invoke('universal-search', {
        body: {
          query: searchQuery.trim(),
          limit: 100,
          offset: nextOffset,
        }
      });
      if (!edgeError && edgeData && Array.isArray((edgeData as any).results)) {
        const rawResults: any[] = (edgeData as any).results;
        const typeMap: Record<string, string> = {
          vin_match: 'vehicle',
          tag: 'reference',
          external_identity: 'user',
        };
        const newResults: SearchResult[] = rawResults.map((r: any) => ({
          id: r.id,
          type: (typeMap[r.type] ?? r.type) as SearchResult['type'],
          title: r.title || '',
          description: r.description || r.subtitle || '',
          image_url: r.image_url,
          relevance_score: r.relevance_score ?? 0,
          metadata: r.metadata ?? {},
          created_at: r.metadata?.updated_at || r.metadata?.created_at || '',
        }));
        // Deduplicate by id — keep existing results, append only new ones
        const existingIds = new Set(results.map(r => r.id));
        const uniqueNew = newResults.filter(r => !existingIds.has(r.id));
        setResults(prev => [...prev, ...uniqueNew]);
        // Update meta
        const meta = (edgeData as any).meta;
        if (meta) {
          setSearchMeta(meta as SearchMeta);
        }
        const total = meta?.total_count ?? searchMeta.total_count;
        const combined = results.length + uniqueNew.length;
        setSearchSummary(`Found ${total.toLocaleString()} results for "${searchQuery.trim()}".`);
      }
    } catch (err) {
      console.error('Load more failed:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [searchMeta, loadingMore, searchQuery, results]);

  // Apply vehicle filters to results
  const displayResults = useMemo(() => {
    const enriched = results;

    // Apply vehicle filters
    const anyFilterActive =
      vFilters.make ||
      vFilters.priceMin || vFilters.priceMax ||
      vFilters.yearMin || vFilters.yearMax ||
      vFilters.mileageMax || vFilters.transmission ||
      vFilters.listingStatus;

    if (!anyFilterActive) return enriched;

    return enriched.filter(r => {
      if (r.type !== 'vehicle') return true; // non-vehicle results pass through unfiltered
      const e = r.metadata as any;

      if (vFilters.make) {
        const makeLower = vFilters.make.trim().toLowerCase();
        const resultMake = String(e.make || '').toLowerCase();
        if (!resultMake.includes(makeLower)) return false;
      }
      if (vFilters.priceMin) {
        const min = parseInt(vFilters.priceMin, 10);
        if (!isNaN(min) && (e.sale_price === null || e.sale_price === undefined || e.sale_price < min)) return false;
      }
      if (vFilters.priceMax) {
        const max = parseInt(vFilters.priceMax, 10);
        if (!isNaN(max) && e.sale_price !== null && e.sale_price !== undefined && e.sale_price > max) return false;
      }
      if (vFilters.yearMin) {
        const min = parseInt(vFilters.yearMin, 10);
        if (!isNaN(min) && (e.year === null || e.year === undefined || e.year < min)) return false;
      }
      if (vFilters.yearMax) {
        const max = parseInt(vFilters.yearMax, 10);
        if (!isNaN(max) && e.year !== null && e.year !== undefined && e.year > max) return false;
      }
      if (vFilters.mileageMax) {
        const max = parseInt(vFilters.mileageMax, 10);
        if (!isNaN(max) && e.mileage !== null && e.mileage !== undefined && e.mileage > max) return false;
      }
      if (vFilters.transmission) {
        if (e.transmission === null || e.transmission === undefined) return false;
        const t = String(e.transmission).toLowerCase();
        if (vFilters.transmission === 'automatic' && !t.includes('auto')) return false;
        if (vFilters.transmission === 'manual' && !(t.includes('manual') || t.includes('stick') || t.includes('6-speed') || t.includes('5-speed') || t.includes('4-speed') || t.includes('3-speed'))) return false;
      }
      if (vFilters.listingStatus) {
        if (vFilters.listingStatus === 'for_sale' && !e.is_for_sale) return false;
        if (vFilters.listingStatus === 'sold' && e.is_for_sale !== false) return false;
      }
      return true;
    });
  }, [results, vFilters]);

  const activeFilterCount = [
    vFilters.make,
    vFilters.priceMin, vFilters.priceMax,
    vFilters.yearMin, vFilters.yearMax,
    vFilters.mileageMax, vFilters.transmission, vFilters.listingStatus
  ].filter(Boolean).length;

  const vehicleCount = results.filter(r => r.type === 'vehicle').length;
  const displayVehicleCount = displayResults.filter(r => r.type === 'vehicle').length;

  const resultCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach((result) => {
      counts[result.type] = (counts[result.type] || 0) + 1;
    });
    return counts;
  }, [results]);

  const focusQuery = searchQuery.trim();
  const focusEncoded = focusQuery ? encodeURIComponent(focusQuery) : '';

  const workspaceSections = useMemo(() => {
    return [
      {
        title: 'Assets & Listings',
        helper: 'Vehicles, auctions, and sellable assets',
        actions: [
          { label: 'Vehicle library', href: '/vehicles' },
          { label: focusQuery ? `Vehicles for "${focusQuery}"` : 'Search vehicles', href: focusQuery ? `/vehicles?search=${focusEncoded}` : '/vehicles', badge: resultCounts.vehicle },
          { label: 'Auctions', href: '/auctions', badge: resultCounts.auction },
          { label: 'List a vehicle', href: '/auctions/create' }
        ]
      },
      {
        title: 'Market & Data',
        helper: 'Pricing, comps, and market intelligence',
        actions: [
          { label: 'Market dashboard', href: '/market' },
          { label: 'API & SDK', href: '/api' },
        ]
      },
      {
        title: 'Organizations & Services',
        helper: 'Builders, shops, and specialists',
        actions: [
          { label: 'Organizations', href: '/org', badge: resultCounts.organization },
          { label: 'Create organization', href: '/org/create' },
          { label: 'Shops & service', href: '/org', badge: resultCounts.shop }
        ]
      },
      {
        title: 'Research & Evidence',
        helper: 'Library, members, and knowledge trails',
        actions: [
          { label: 'Library', href: '/library', badge: (resultCounts.reference || 0) + (resultCounts.document || 0) },
          { label: 'Capsule', href: '/capsule' },
          { label: 'Members', href: '/members', badge: resultCounts.user }
        ]
      }
    ];
  }, [focusEncoded, focusQuery, resultCounts]);

  const laneFilters = useMemo(() => ([
    { key: 'vehicle', label: 'Vehicles', count: resultCounts.vehicle || 0 },
    { key: 'auction', label: 'Auctions', count: resultCounts.auction || 0 },
    { key: 'organization', label: 'Organizations', count: resultCounts.organization || 0 },
    { key: 'shop', label: 'Shops', count: resultCounts.shop || 0 },
    { key: 'user', label: 'People', count: resultCounts.user || 0 },
    { key: 'timeline_event', label: 'Timeline', count: resultCounts.timeline_event || 0 },
    { key: 'document', label: 'Documents', count: resultCounts.document || 0 },
    { key: 'image', label: 'Images', count: resultCounts.image || 0 },
    { key: 'reference', label: 'References', count: resultCounts.reference || 0 }
  ]), [resultCounts]);

  const jumpToFilter = (next: typeof resultFilter) => {
    setResultFilter(next);
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Sync searchQuery with URL parameter — only update query text, let IntelligentSearch
  // handle the search lifecycle (loading state, results). Clearing results here caused a
  // race condition where the effect fired mid-search and wiped already-returned results.
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    if (urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
      if (!urlQuery) {
        setLoading(false);
        setResults([]);
        setSearchSummary('');
        setSearchMeta(null);
      }
    }
  }, [searchParams]);

  return (
    <div style={{ padding: '12px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Search Input */}
      <div style={{ marginBottom: '16px' }}>
        <IntelligentSearch
          initialQuery={searchQuery}
          userLocation={userLocation}
          onSearchResults={handleSearchResults}
          onSearchMeta={handleSearchMeta}
          onSearchStart={() => setLoading(true)}
        />
      </div>

      {/* VIN Search — only shown when explicitly toggled */}
      <div style={{ marginBottom: showVinSearch ? '16px' : '8px' }}>
        <button
          type="button"
          onClick={() => { setShowVinSearch(v => !v); setVinError(null); setVinResults([]); }}
          style={{
            padding: '3px 8px',
            fontSize: '7.5pt',
            fontWeight: 600,
            border: '1px solid var(--border)',
            background: showVinSearch ? 'var(--text)' : 'transparent',
            color: showVinSearch ? 'var(--surface)' : 'var(--text-secondary)',
            cursor: 'pointer', }}
        >
          {showVinSearch ? 'Close VIN Lookup' : 'VIN Lookup'}
        </button>

        {showVinSearch && (
          <div style={{
            marginTop: '8px',
            padding: '12px 16px',
            background: 'var(--surface)',
            border: '2px solid var(--text)',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px' }}>
              Look up a vehicle by VIN (full 17-char or partial)
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); handleVinSearch(vinInput); }}
              style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
            >
              <input
                type="text"
                value={vinInput}
                onChange={(e) => setVinInput(e.target.value.toUpperCase())}
                placeholder="e.g. WP0AA2A95ES123456"
                maxLength={17}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  border: '2px solid var(--text)',
                  background: 'var(--surface)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase'
                }}
                autoFocus
              />
              <button
                type="submit"
                disabled={vinSearching}
                style={{
                  padding: '8px 16px',
                  fontSize: '11px',
                  fontWeight: 700,
                  border: '2px solid var(--text)',
                  background: 'var(--text)',
                  color: 'var(--bg)',
                  cursor: vinSearching ? 'wait' : 'pointer'
                }}
              >
                {vinSearching ? 'Searching...' : 'Look up'}
              </button>
            </form>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              VIN characters: A–H, J–N, P, R–Z, 0–9 (no I, O, Q)
            </div>

            {vinError && (
              <div style={{ marginTop: '10px', padding: '8px 12px', background: 'var(--error-dim)', border: '1px solid var(--error)', fontSize: '11px' }}>
                {vinError}
              </div>
            )}

            {vinResults.length > 1 && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px' }}>
                  {vinResults.length} vehicles matched — click to view
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {vinResults.map((v) => (
                    <a
                      key={v.id}
                      href={`/vehicle/${v.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px 10px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        textDecoration: 'none',
                        color: 'var(--text)'
                      }}
                    >
                      {v.primary_image_url && (
                        <img
                          src={v.primary_image_url}
                          alt=""
                          style={{ width: 56, height: 42, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
                        />
                      )}
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700 }}>
                          {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown vehicle'}
                        </div>
                        <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{v.vin || '—'}</div>
                        {v.color && <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{v.color}{v.mileage ? ` · ${v.mileage.toLocaleString()} mi` : ''}</div>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Vehicle Filters Panel */}
      {vehicleCount > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '2px solid var(--text)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setVFilters(prev => ({ ...prev, showFilters: !prev.showFilters }))}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    border: '2px solid var(--text)',
                    background: vFilters.showFilters ? 'var(--text)' : 'var(--surface)',
                    color: vFilters.showFilters ? 'var(--surface)' : 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </button>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setVFilters(prev => ({ ...DEFAULT_FILTERS, showFilters: prev.showFilters }))}
                    style={{
                      padding: '4px 8px',
                      fontSize: '9px',
                      fontWeight: 700,
                      border: '1px solid var(--text-muted)',
                      background: 'var(--surface)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {activeFilterCount > 0
                  ? `${displayVehicleCount} of ${vehicleCount} vehicles match filters`
                  : `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'}`
                }
              </div>
            </div>

            {vFilters.showFilters && (
              <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>

                {/* Make */}
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Make</div>
                  <input
                    type="text"
                    placeholder="e.g. Porsche"
                    value={vFilters.make}
                    onChange={e => setVFilters(prev => ({ ...prev, make: e.target.value }))}
                    style={{ width: '110px', padding: '4px 6px', fontSize: '11px', border: '2px solid var(--text)', background: 'var(--surface)' }}
                  />
                </div>

                {/* Price range */}
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Price ($)</div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="number"
                      placeholder="Min"
                      value={vFilters.priceMin}
                      onChange={e => setVFilters(prev => ({ ...prev, priceMin: e.target.value }))}
                      style={{ width: '80px', padding: '4px 6px', fontSize: '11px', border: '2px solid var(--text)', background: 'var(--surface)' }}
                      min={0}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>–</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={vFilters.priceMax}
                      onChange={e => setVFilters(prev => ({ ...prev, priceMax: e.target.value }))}
                      style={{ width: '80px', padding: '4px 6px', fontSize: '11px', border: '2px solid var(--text)', background: 'var(--surface)' }}
                      min={0}
                    />
                  </div>
                </div>

                {/* Year range */}
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Year</div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="number"
                      placeholder="From"
                      value={vFilters.yearMin}
                      onChange={e => setVFilters(prev => ({ ...prev, yearMin: e.target.value }))}
                      style={{ width: '68px', padding: '4px 6px', fontSize: '11px', border: '2px solid var(--text)', background: 'var(--surface)' }}
                      min={1886}
                      max={new Date().getFullYear() + 2}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>–</span>
                    <input
                      type="number"
                      placeholder="To"
                      value={vFilters.yearMax}
                      onChange={e => setVFilters(prev => ({ ...prev, yearMax: e.target.value }))}
                      style={{ width: '68px', padding: '4px 6px', fontSize: '11px', border: '2px solid var(--text)', background: 'var(--surface)' }}
                      min={1886}
                      max={new Date().getFullYear() + 2}
                    />
                  </div>
                </div>

                {/* Mileage max */}
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Max Mileage</div>
                  <input
                    type="number"
                    placeholder="e.g. 50000"
                    value={vFilters.mileageMax}
                    onChange={e => setVFilters(prev => ({ ...prev, mileageMax: e.target.value }))}
                    style={{ width: '100px', padding: '4px 6px', fontSize: '11px', border: '2px solid var(--text)', background: 'var(--surface)' }}
                    min={0}
                  />
                </div>

                {/* Transmission */}
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Transmission</div>
                  <select
                    value={vFilters.transmission}
                    onChange={e => setVFilters(prev => ({ ...prev, transmission: e.target.value }))}
                    style={{ padding: '4px 8px', fontSize: '11px', border: '2px solid var(--text)', background: 'var(--surface)', cursor: 'pointer' }}
                  >
                    <option value="">Any</option>
                    <option value="automatic">Automatic</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>

                {/* For sale / sold */}
                <div>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { val: '', label: 'All' },
                      { val: 'for_sale', label: 'For Sale' },
                      { val: 'sold', label: 'Sold' },
                    ].map(opt => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setVFilters(prev => ({ ...prev, listingStatus: opt.val }))}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          border: '2px solid var(--text)',
                          background: vFilters.listingStatus === opt.val ? 'var(--text)' : 'var(--surface)',
                          color: vFilters.listingStatus === opt.val ? 'var(--surface)' : 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {searchQuery && looksLikeQuestion(searchQuery) && (answerLoading || answer || answerError) && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            padding: '16px',
            background: 'var(--surface)',
            border: '1px solid var(--border)'}}>
            <div className="text font-bold" style={{ fontSize: '12px', marginBottom: '8px' }}>Answer</div>
            {answerLoading && (
              <div className="text-small text-muted" style={{ fontSize: '11px' }}>Thinking…</div>
            )}
            {answerError && (
              <div className="text-small" style={{ fontSize: '11px', color: 'var(--danger)' }}>{answerError}</div>
            )}
            {!!answer && (
              <div className="text" style={{ fontSize: '12px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{answer}</div>
            )}

            {answerSources.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <div className="text-small text-muted" style={{ fontSize: '11px', marginBottom: '6px' }}>Top sources in your results</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {answerSources.slice(0, 5).map((s, idx) => (
                    <div key={`${s.title}-${idx}`} className="text-small" style={{ fontSize: '11px' }}>
                      {s.href ? (
                        <a href={s.href} style={{ color: 'var(--text)', textDecoration: 'underline' }}>{s.title}</a>
                      ) : (
                        <span>{s.title}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results - shown when there's a query */}
      {searchQuery && (
        <div ref={resultsRef}>
          <SearchResults
            results={displayResults}
            searchSummary={searchSummary}
            loading={loading}
            activeFilter={resultFilter}
            onFilterChange={setResultFilter}
            totalCount={searchMeta?.total_count}
            hasMore={searchMeta?.has_more}
            onLoadMore={handleLoadMore}
            loadingMore={loadingMore}
          />
        </div>
      )}

      {/* No-query empty state — featured vehicles */}
      {!searchQuery && !loading && (
        <div style={{ padding: '0 0 48px' }}>
          {/* Quick-search suggestions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '32px' }}>
            {['Porsche 911', '1967 Mustang', 'LS swap', 'Barn find', 'Ferrari'].map(term => (
              <a
                key={term}
                href={`/search?q=${encodeURIComponent(term)}`}
                style={{
                  padding: '6px 14px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {term}
              </a>
            ))}
          </div>

          {/* Featured vehicles grid */}
          {featuredVehicles.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '12px' }}>
                Top Vehicles by Value
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '12px',
              }}>
                {featuredVehicles.map(v => (
                  <VehicleCardDense
                    key={v.id}
                    vehicle={{
                      id: v.id,
                      year: v.year ?? undefined,
                      make: v.make ?? undefined,
                      model: v.model ?? undefined,
                      primary_image_url: v.primary_image_url ?? undefined,
                      sale_price: v.sale_price ?? undefined,
                    }}
                    viewMode="gallery"
                    showSocial={false}
                    showPriceChange={false}
                    showPriceOverlay={true}
                    showDetailOverlay={true}
                    infoDense={true}
                    thumbnailFit="contain"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workstation / quick links — only shown on demand, at bottom */}
      {(results.length > 0 || searchQuery) && (
        <div style={{ marginTop: '32px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          <button
            type="button"
            onClick={() => setShowWorkstation((v) => !v)}
            style={{
              padding: '4px 8px',
              fontSize: '7.5pt',
              fontWeight: 600,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer', }}
          >
            {showWorkstation ? 'Hide quick links' : 'Quick links & workspace'}
          </button>

          {showWorkstation && (
            <div style={{ marginTop: '12px' }}>
              {focusQuery && laneFilters.filter(l => l.count > 0).length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '7.5pt', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Jump to lane</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {laneFilters.filter((lane) => lane.count > 0).map((lane) => (
                      <button
                        key={lane.key}
                        type="button"
                        onClick={() => jumpToFilter(lane.key as typeof resultFilter)}
                        style={{
                          padding: '3px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          border: '2px solid var(--text)',
                          background: 'var(--surface)',
                          cursor: 'pointer'
                        }}
                      >
                        {lane.label} · {lane.count}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                {workspaceSections.map((section) => (
                  <div key={section.title} style={{ border: '1px solid var(--border)', padding: '10px', background: 'var(--surface)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>{section.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{section.helper}</div>
                    <div style={{ display: 'grid', gap: '6px' }}>
                      {section.actions.map((action) => (
                        <a
                          key={action.label}
                          href={action.href}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            textDecoration: 'none',
                            color: 'var(--text)',
                            border: '1px solid var(--border)',
                            padding: '6px 8px',
                            background: 'var(--surface)'
                          }}
                        >
                          <span style={{ fontSize: '11px', fontWeight: 600 }}>{action.label}</span>
                          {typeof action.badge === 'number' && action.badge > 0 && (
                            <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>{action.badge}</span>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

