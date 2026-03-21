/**
 * UNIVERSAL SEARCH - The Magic Input Handler
 *
 * Handles any input: VIN, URL, year, text query, image
 * Returns rich results with thumbnails
 * AI fallback when traditional search fails
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  checkRateLimit,
  getClientIp,
  rateLimitHeaders,
  rateLimitResponse,
} from '../_shared/rateLimit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_CONFIG = {
  namespace: 'universal-search',
  windowSeconds: 60,
  maxRequests: 60, // 60 searches per minute per IP
};

interface SearchRequest {
  query: string;
  limit?: number;
  offset?: number;
  types?: string[]; // Filter to specific types: vehicle, organization, user, tag
  includeAI?: boolean; // Whether to use AI fallback
}

interface SearchResult {
  id: string;
  type: 'vehicle' | 'organization' | 'user' | 'tag' | 'external_identity' | 'vin_match';
  title: string;
  subtitle?: string;
  description?: string;
  image_url?: string;
  relevance_score: number;
  metadata?: Record<string, any>;
}

interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  query_type: 'vin' | 'url' | 'year' | 'text' | 'empty';
  total_count: number;
  ai_suggestion?: string;
  search_time_ms: number;
  meta?: {
    total_count: number;
    offset: number;
    limit: number;
    has_more: boolean;
  };
}

// Input type detection
function detectInputType(query: string): 'vin' | 'url' | 'year' | 'text' | 'empty' {
  const trimmed = query.trim();
  if (!trimmed) return 'empty';

  // VIN: 17 alphanumeric, no I/O/Q
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(trimmed)) return 'vin';

  // URL patterns
  if (/^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) return 'url';
  // Only match bare domains with known TLDs (avoids false positives like "gt.coupe")
  if (/^[a-z0-9-]+\.(com|org|net|io|co|edu|gov|uk|de|fr|ca|au|us|info|biz|me|tv)\b/i.test(trimmed)) return 'url';

  // Year: exactly 4 digits, reasonable range
  if (/^\d{4}$/.test(trimmed)) {
    const year = parseInt(trimmed, 10);
    if (year >= 1886 && year <= new Date().getFullYear() + 2) return 'year';
  }

  return 'text';
}

// Normalize and tokenize query for search
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .filter(t => !['the', 'a', 'an', 'and', 'or', 'for', 'with', 'in', 'on'].includes(t));
}

// Escape for PostgreSQL ILIKE
function escapeIlike(s: string): string {
  return s.replace(/([%_\\])/g, '\\$1');
}

// Escape for PostgREST .or() filter values - strip chars that break filter syntax
function escapePostgrestValue(s: string): string {
  return s.replace(/[",().\\]/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ── Rate limiting ──────────────────────────────────────────────────────────
    const clientIp = getClientIp(req);
    const rl = await checkRateLimit(supabase, clientIp, RATE_LIMIT_CONFIG);
    if (!rl.allowed) {
      return rateLimitResponse(rl, corsHeaders, RATE_LIMIT_CONFIG.maxRequests);
    }
    const rlHeaders = rateLimitHeaders(rl, RATE_LIMIT_CONFIG.maxRequests);
    // ──────────────────────────────────────────────────────────────────────────

    // ── Extract authenticated user's vehicle IDs for boosting ────────────────
    let userVehicleIds: Set<string> = new Set();
    const authHeader = req.headers.get('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      // Decode JWT payload (middle segment) to get user ID
      try {
        // Convert base64url to base64 for atob compatibility
        let b64 = token.split('.')[1];
        b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const payload = JSON.parse(atob(b64));
        const userId = payload.sub;
        if (userId) {
          const { data: links } = await supabase
            .from('user_vehicle_links')
            .select('vehicle_id')
            .eq('user_id', userId);
          if (links?.length) {
            userVehicleIds = new Set(links.map((l: any) => l.vehicle_id));
          }
        }
      } catch { /* anonymous/invalid token — no boost */ }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Support both GET (?query=...) and POST (JSON body)
    const url = new URL(req.url);
    const urlParams = url.searchParams;
    const body: SearchRequest = req.method === 'GET' ? {} as any : await req.json().catch(() => ({} as any));

    const query: string = urlParams.get('query') || urlParams.get('q') || body.query || '';
    const limitRaw = urlParams.get('limit') ?? body.limit;
    const limit: number = limitRaw ? Number(limitRaw) : 60;
    const offsetRaw = urlParams.get('offset') ?? body.offset;
    const offset: number = offsetRaw ? Math.max(0, Math.min(Number(offsetRaw), 10000)) : 0;
    const types: string[] | undefined = urlParams.get('types')?.split(',') ?? body.types;
    const includeAI: boolean = urlParams.has('includeAI') ? urlParams.get('includeAI') !== 'false' : (body.includeAI ?? true);
    const locationFilter: string | undefined = urlParams.get('location') || (body as any).location || undefined;
    const bodyStyleFilter: string | undefined = urlParams.get('body_style') || (body as any).body_style || undefined;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Query is required',
        results: [],
        query_type: 'empty',
        total_count: 0,
        search_time_ms: Date.now() - startTime
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Cap query length to prevent abuse and slow searches
    const sanitizedQuery = query.length > 500 ? query.slice(0, 500) : query;
    // Cap limit to reasonable range
    const sanitizedLimit = Math.max(1, Math.min(typeof limit === 'number' ? limit : 20, 200));

    const queryType = detectInputType(sanitizedQuery);
    const trimmedQuery = sanitizedQuery.trim();
    const results: SearchResult[] = [];

    // Shared rich vehicle SELECT — includes all fields needed for tier calculation and UI display
    const VEHICLE_SELECT = 'id, year, make, model, vin, color, status, sale_price, current_value, asking_price, primary_image_url, seller_name, bat_seller, data_quality_score, view_count, bat_view_count, profile_origin, ownership_verified, comment_count, mileage, transmission, engine_size, canonical_vehicle_type, canonical_body_style, body_style, image_count, observation_count, city, state, listing_location, updated_at';

    // Exclude non-automobile types from all search results
    const NON_AUTO_TYPES = new Set(['MOTORCYCLE', 'BOAT', 'TRAILER', 'ATV', 'BUS', 'RV', 'SNOWMOBILE', 'OTHER', 'EQUIPMENT']);
    const isNonAutomobile = (v: any): boolean => {
      const vtype = (v.canonical_vehicle_type || '').toUpperCase();
      const bstyle = (v.canonical_body_style || '').toUpperCase();
      return NON_AUTO_TYPES.has(vtype) || NON_AUTO_TYPES.has(bstyle);
    };

    // Build a rich metadata object from a vehicle row.
    // image_count and observation_count are denormalized columns on vehicles,
    // kept in sync by triggers on vehicle_images and vehicle_observations.
    const buildVehicleMetadata = (v: any) => ({
      year: v.year,
      make: v.make,
      model: v.model,
      color: v.color,
      vin: v.vin,
      owner: v.seller_name || v.bat_seller || undefined,
      sale_price: v.sale_price,
      current_value: v.current_value,
      asking_price: v.asking_price,
      data_quality_score: v.data_quality_score,
      // Use bat_view_count as view_count fallback for BAT imports
      view_count: v.view_count || v.bat_view_count || 0,
      profile_origin: v.profile_origin,
      ownership_verified: v.ownership_verified || false,
      // Denormalized counts from vehicles table — no runtime enrichment needed
      event_count: v.observation_count || v.comment_count || 0,
      image_count: v.image_count || (v.primary_image_url ? 1 : 0),
      observation_count: v.observation_count || 0,
      mileage: v.mileage,
      transmission: v.transmission,
      engine_size: v.engine_size,
      body_style: v.body_style || v.canonical_body_style || undefined,
      city: v.city,
      state: v.state,
      location: v.city && v.state ? `${v.city}, ${v.state}` : v.listing_location || undefined,
      updated_at: v.updated_at,
    });

    // ============================================
    // VIN SEARCH - Direct lookup (case-insensitive, exact + partial)
    // ============================================
    if (queryType === 'vin') {
      const vin = trimmedQuery.toUpperCase();

      // Try exact match first (case-insensitive via ilike)
      const { data: exactVehicles } = await supabase
        .from('vehicles')
        .select(VEHICLE_SELECT)
        .ilike('vin', vin)
        .eq('is_public', true)
        .limit(10);

      let vehicles = exactVehicles || [];

      // If no exact match, try partial match (last 6-8 digits, or substring)
      if (!vehicles.length && vin.length >= 5) {
        const { data: partialVehicles } = await supabase
          .from('vehicles')
          .select(VEHICLE_SELECT)
          .ilike('vin', `%${escapeIlike(vin)}%`)
          .eq('is_public', true)
          .not('year', 'is', null)
          .not('make', 'is', null)
          .limit(10);
        vehicles = partialVehicles || [];
      }

      if (vehicles.length) {
        for (const v of vehicles) {
          if (isNonAutomobile(v)) continue;
          const price = v.sale_price || v.current_value || v.asking_price;
          const isExact = (v.vin || '').toUpperCase() === vin;
          results.push({
            id: v.id,
            type: 'vin_match',
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
            subtitle: `VIN: ${v.vin}`,
            image_url: v.primary_image_url,
            relevance_score: isExact ? 1.0 : 0.85,
            metadata: { ...buildVehicleMetadata(v), status: v.status, subtitle: price ? `$${price.toLocaleString()}` : undefined }
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        results,
        query_type: 'vin',
        total_count: results.length,
        search_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // URL - Return signal to route to extraction
    // ============================================
    if (queryType === 'url') {
      return new Response(JSON.stringify({
        success: true,
        results: [],
        query_type: 'url',
        total_count: 0,
        ai_suggestion: 'This looks like a URL. Route to extraction pipeline.',
        metadata: { url: trimmedQuery },
        search_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // YEAR SEARCH - Vehicles from that year
    // ============================================
    if (queryType === 'year') {
      const year = parseInt(trimmedQuery, 10);

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select(VEHICLE_SELECT)
        .eq('year', year)
        .eq('is_public', true)
        .not('make', 'is', null)
        .not('model', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(sanitizedLimit);

      if (vehicles?.length) {
        for (const v of vehicles) {
          if (isNonAutomobile(v)) continue;
          const price = v.sale_price || v.current_value || v.asking_price;
          results.push({
            id: v.id,
            type: 'vehicle',
            title: `${v.year} ${v.make || ''} ${v.model || ''}`.trim(),
            subtitle: price ? `$${price.toLocaleString()}` : undefined,
            image_url: v.primary_image_url,
            relevance_score: 0.95,
            metadata: buildVehicleMetadata(v),
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        results,
        query_type: 'year',
        total_count: results.length,
        search_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // TEXT SEARCH - Full search across all entities
    // ============================================
    const tokens = tokenizeQuery(trimmedQuery);
    const searchPattern = `%${escapeIlike(trimmedQuery)}%`;
    const allowedTypes = types || ['vehicle', 'organization', 'user', 'tag', 'external_identity'];

    // Apply optional vehicle filters (location, body_style) to any query builder
    const applyVehicleFilters = (q: any): any => {
      if (locationFilter) {
        const loc = escapeIlike(escapePostgrestValue(locationFilter));
        if (locationFilter.length === 2) {
          // 2-letter state code
          q = q.ilike('state', loc);
        } else {
          // City name or longer location string
          q = q.or(`city.ilike.%${loc}%,state.ilike.%${loc}%,listing_location.ilike.%${loc}%`);
        }
      }
      if (bodyStyleFilter) {
        const bs = escapeIlike(escapePostgrestValue(bodyStyleFilter));
        q = q.or(`body_style.ilike.%${bs}%,canonical_body_style.ilike.%${bs}%`);
      }
      return q;
    };

    // Parallel searches
    const searches: Promise<void>[] = [];
    let vehicleTotalCount = 0;

    // --- VEHICLES (full-text search with ts_rank) ---
    if (allowedTypes.includes('vehicle')) {
      searches.push((async () => {
        // Vehicles are the primary content — give them most of the result slots
        const vehicleLimit = Math.max(sanitizedLimit - 6, Math.ceil(sanitizedLimit * 0.75));

        // Convert query to tsquery format: "BMW M3 E30" → "BMW & M3 & E30"
        const tsqueryTerms = tokens.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).filter(t => t.length > 0);
        const tsqueryStr = tsqueryTerms.join(' & ');

        let vehicles: any[] = [];

        // Pagination (offset > 0): use ILIKE directly for consistent results.
        // The RPC uses cascading strategies with independent limits that don't paginate well.
        if (offset > 0 && tsqueryStr) {
          let paginationQuery = applyVehicleFilters(supabase
            .from('vehicles')
            .select(VEHICLE_SELECT)
            .eq('is_public', true)
            .not('year', 'is', null)
            .not('make', 'is', null)
            .not('model', 'is', null));

          const yearMatch = trimmedQuery.match(/^(\d{4})\s+(.+)$/);
          if (yearMatch) {
            const year = parseInt(yearMatch[1], 10);
            const rest = escapeIlike(escapePostgrestValue(yearMatch[2].toLowerCase()));
            paginationQuery = paginationQuery.eq('year', year)
              .or(`make.ilike.%${rest}%,model.ilike.%${rest}%,color.ilike.%${rest}%`);
          } else if (tokens.length >= 2) {
            const t0 = escapeIlike(escapePostgrestValue(tokens[0]));
            const tRest = escapeIlike(escapePostgrestValue(tokens.slice(1).join(' ')));
            paginationQuery = paginationQuery.or(
              `and(make.ilike.%${t0}%,model.ilike.%${tRest}%),` +
              `and(model.ilike.%${t0}%,make.ilike.%${tRest}%)`
            );
          } else {
            const t = escapePostgrestValue(searchPattern);
            paginationQuery = paginationQuery.or(`make.ilike.${t},model.ilike.${t},color.ilike.${t}`);
          }

          const [paginationResponse, countResponse] = await Promise.all([
            paginationQuery
              .order('sale_price', { ascending: false, nullsFirst: false })
              .range(offset, offset + vehicleLimit - 1),
            supabase.rpc('count_vehicles_search', { query_text: tsqueryStr }),
          ]);

          if (countResponse.data !== null) vehicleTotalCount = countResponse.data as number;
          if (paginationResponse.data?.length) vehicles = paginationResponse.data;
        }
        // First page: use RPC for best ranking
        else if (tsqueryStr) {
          // Run search + count in parallel
          const [ftsResponse, countResponse] = await Promise.all([
            supabase.rpc('search_vehicles_fts', {
              query_text: tsqueryStr,
              limit_count: vehicleLimit,
            }),
            supabase.rpc('count_vehicles_search', { query_text: tsqueryStr }),
          ]);

          const { data: ftsResults, error: ftsError } = ftsResponse;
          if (countResponse.data !== null) {
            vehicleTotalCount = countResponse.data as number;
          }

          if (!ftsError && ftsResults?.length) {
            // Filter to high-confidence results only (relevance >= 0.85 = strategies 1a/1b).
            // Strategy 2 (raw FTS, relevance = 0.8) produces too many false positives.
            // FIX: Only use high-confidence results. Discard low-relevance garbage completely.
            const highConfidence = ftsResults.filter((r: any) => (r.relevance || 0) >= 0.85);
            const useFts = highConfidence; // Changed: don't fall back to low-quality results

            // FTS RPC returns limited columns — enrich with full vehicle data in one query
            const ftsIds = useFts.map((r: any) => r.id);
            const { data: enriched } = await supabase
              .from('vehicles')
              .select(VEHICLE_SELECT)
              .in('id', ftsIds);

            if (enriched?.length) {
              const enrichedMap = new Map(enriched.map((v: any) => [v.id, v]));
              vehicles = useFts
                .map((r: any) => ({ ...enrichedMap.get(r.id), relevance: r.relevance }))
                .filter((v: any) => v.id);
            } else {
              vehicles = useFts;
            }
          } else if (ftsError) {
            // Fallback: direct textSearch on search_vector (handles RPC schema issues)
            const { data: directResults } = await supabase
              .from('vehicles')
              .select(VEHICLE_SELECT)
              .eq('is_public', true)
              .not('year', 'is', null)
              .not('make', 'is', null)
              .not('model', 'is', null)
              .textSearch('search_vector', tsqueryStr, { type: 'plain', config: 'english' })
              .limit(vehicleLimit);

            if (directResults?.length) {
              vehicles = directResults;
            }
          }
        }

        // ILIKE fallback — structured field matching is more reliable than FTS for
        // multi-token queries like "Porsche 997 GT3". Skip for single-token queries
        // when FTS already returned enough results (ILIKE on broad terms like "mustang"
        // scans 30K+ rows and takes 15+ seconds to sort).
        const skipIlike = vehicles.length >= Math.ceil(vehicleLimit / 2);
        if (!skipIlike) {
          const yearMatch = trimmedQuery.match(/^(\d{4})\s+(.+)$/);
          let ilikeQuery = applyVehicleFilters(supabase
            .from('vehicles')
            .select(VEHICLE_SELECT)
            .eq('is_public', true)
            // Filter stub vehicles (no year/make/model) from search results
            .not('year', 'is', null)
            .not('make', 'is', null)
            .not('model', 'is', null));

          if (yearMatch) {
            // "1973 Porsche 911" → year=1973 AND (make|model ILIKE '%porsche 911%')
            const year = parseInt(yearMatch[1], 10);
            const rest = escapeIlike(escapePostgrestValue(yearMatch[2].toLowerCase()));
            ilikeQuery = ilikeQuery
              .eq('year', year)
              .or(`make.ilike.%${rest}%,model.ilike.%${rest}%,color.ilike.%${rest}%`);
          } else if (tokens.length >= 2) {
            // Build filter: first token assumed to be make, rest is model — AND also try all
            // tokens against model independently (catches "Porsche 997 GT3" → model ILIKE '%997%')
            const t0 = escapeIlike(escapePostgrestValue(tokens[0]));
            // All tokens after the first joined as model substring
            const tRest = escapeIlike(escapePostgrestValue(tokens.slice(1).join(' ')));
            // Each individual token for broader model matching
            const tokenClauses = tokens
              .map(t => `model.ilike.%${escapeIlike(escapePostgrestValue(t))}%`)
              .join(',');

            ilikeQuery = ilikeQuery.or(
              // Primary: make=token[0], model contains rest
              `and(make.ilike.%${t0}%,model.ilike.%${tRest}%),` +
              // Reverse: model=token[0], make contains rest
              `and(model.ilike.%${t0}%,make.ilike.%${tRest}%),` +
              // Color + model/make: "white bronco" → color=white, model=bronco
              `and(color.ilike.%${t0}%,model.ilike.%${tRest}%),` +
              `and(color.ilike.%${t0}%,make.ilike.%${tRest}%),` +
              `and(model.ilike.%${t0}%,color.ilike.%${tRest}%),` +
              // Broad: make matches any token (e.g. "gt3" alone won't match but "porsche" will)
              `and(make.ilike.%${t0}%,${tokenClauses.split(',')[1] || tokenClauses})`
            );
          } else {
            // Single token: search both make, model, and color
            const t = escapePostgrestValue(searchPattern);
            ilikeQuery = ilikeQuery.or(`make.ilike.${t},model.ilike.${t},color.ilike.${t}`);
          }

          const { data: ilikeResults, error: ilikeError } = await ilikeQuery
            .order('sale_price', { ascending: false, nullsFirst: false })
            .range(offset, offset + vehicleLimit - 1);

          if (ilikeError) {
            console.error('ILIKE query error:', ilikeError.message);
          }

          if (ilikeResults?.length) {
            if (!vehicles.length) {
              // No FTS results — use ILIKE exclusively
              vehicles = ilikeResults;
            } else {
              // FIX: For specific queries (2+ tokens), prioritize ILIKE over FTS
              // ILIKE is more precise for "porsche 997 gt3" than full-text search
              if (tokens.length >= 2) {
                // Replace FTS results with ILIKE (more accurate for make/model searches)
                vehicles = ilikeResults;
              } else {
                // Merge: ILIKE results get higher relevance than low-confidence FTS
                const ftsIds = new Set(vehicles.map((v: any) => v.id));
                for (const r of ilikeResults) {
                  if (!ftsIds.has(r.id)) vehicles.push({ ...r, _from_ilike: true });
                }
              }
            }
          }
        }

        // JS-level post-filter for location/body_style (FTS results bypass PostgREST filters)
        if (vehicles?.length && (locationFilter || bodyStyleFilter)) {
          vehicles = vehicles.filter((v: any) => {
            if (locationFilter) {
              const loc = locationFilter.toLowerCase();
              const matchesLoc = loc.length === 2
                ? (v.state || '').toLowerCase() === loc
                : [v.city, v.state, v.listing_location].some(
                    (f: string | null) => f && f.toLowerCase().includes(loc)
                  );
              if (!matchesLoc) return false;
            }
            if (bodyStyleFilter) {
              const bs = bodyStyleFilter.toLowerCase();
              if (!(v.body_style || '').toLowerCase().includes(bs) &&
                  !(v.canonical_body_style || '').toLowerCase().includes(bs)) return false;
            }
            return true;
          });
        }

        if (vehicles?.length) {
          // Deduplicate by ID only — year+make+model dedup incorrectly collapsed distinct
          // vehicles (e.g. all 1973 Porsche 911s became one result). ID dedup at the end
          // of the function handles final deduplication.
          const seenIds = new Set<string>();

          for (const v of vehicles) {
            if (seenIds.has(v.id)) continue;
            if (isNonAutomobile(v)) continue;
            seenIds.add(v.id);

            const titleLower = `${v.year} ${v.make} ${v.model}`.toLowerCase();
            const queryLower = trimmedQuery.toLowerCase();

            // Score based on match quality
            let score = v.relevance || (v._from_ilike ? 0.75 : 0.5);
            if (titleLower === queryLower) score = Math.max(score, 1.0);
            else if (titleLower.startsWith(queryLower)) score = Math.max(score, 0.9);
            else if (v.make?.toLowerCase() === queryLower || v.model?.toLowerCase() === queryLower) score = Math.max(score, 0.85);
            // Boost if ALL search terms appear in the title
            else if (tsqueryTerms.every(t => titleLower.includes(t.toLowerCase()))) score = Math.max(score, 0.8);

            // Boost user's own vehicles to the top of results
            if (userVehicleIds.has(v.id)) score = Math.max(score, 1.5);

            const price = v.sale_price || v.current_value || v.asking_price;
            results.push({
              id: v.id,
              type: 'vehicle',
              title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
              subtitle: price ? `$${price.toLocaleString()}` : v.vin ? `VIN: ${v.vin.slice(-6)}` : undefined,
              image_url: v.primary_image_url,
              relevance_score: score,
              metadata: buildVehicleMetadata(v),
            });
          }
        }
      })());
    }

    // --- USER'S OWN VEHICLES (parallel search for authenticated users) ---
    if (allowedTypes.includes('vehicle') && userVehicleIds.size > 0) {
      searches.push((async () => {
        // Fetch ALL user's vehicles, then client-side match against query
        // This avoids complex PostgREST filter issues and is fast (small set: <50 vehicles per user)
        const { data: userVehicles, error: uvError } = await supabase
          .from('vehicles')
          .select(VEHICLE_SELECT)
          .in('id', [...userVehicleIds]);

        if (!userVehicles?.length) return;

        const queryLower = trimmedQuery.toLowerCase();
        const queryTokens = tokenizeQuery(trimmedQuery);

        for (const v of userVehicles) {
          if (isNonAutomobile(v)) continue;
          // Check if this vehicle matches the search query (client-side)
          const fields = [
            v.year?.toString(),
            v.make,
            v.model,
            v.color,
            v.vin,
          ].filter(Boolean).map((s: string) => s.toLowerCase());
          const allText = fields.join(' ');

          const matches = queryTokens.every(t => allText.includes(t));
          if (!matches) continue;

          const price = v.sale_price || v.current_value || v.asking_price;
          results.push({
            id: v.id,
            type: 'vehicle' as const,
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
            subtitle: price ? `$${price.toLocaleString()}` : v.vin ? `VIN: ${v.vin.slice(-6)}` : undefined,
            image_url: v.primary_image_url,
            relevance_score: 1.5, // Always boost user's own vehicles to top
            metadata: buildVehicleMetadata(v),
          });
        }
      })());
    }

    // --- ORGANIZATIONS ---
    if (allowedTypes.includes('organization')) {
      searches.push((async () => {
        const { data: orgs } = await supabase
          .from('businesses')
          .select('id, business_name, business_type, slug, website, logo_url, city, state, country')
          .eq('is_public', true)
          .ilike('business_name', searchPattern)
          .limit(Math.ceil(sanitizedLimit / 4));

        for (const org of orgs || []) {
          const nameLower = (org.business_name || '').toLowerCase();
          const queryLower = trimmedQuery.toLowerCase();

          let score = 0.5;
          if (nameLower === queryLower) score = 1.0;
          else if (nameLower.startsWith(queryLower)) score = 0.9;

          const location = [org.city, org.state || org.country].filter(Boolean).join(', ');
          let websiteHost: string | undefined;
          if (org.website) {
            try { websiteHost = new URL(org.website).hostname; } catch { /* malformed URL */ }
          }

          // Format business type label
          const typeLabel = org.business_type === 'collection' ? 'Collection'
            : org.business_type === 'dealership' || org.business_type === 'dealer' ? 'Dealer'
            : org.business_type === 'auction_house' ? 'Auction House'
            : org.business_type ? org.business_type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
            : null;

          results.push({
            id: org.id,
            type: 'organization',
            title: org.business_name,
            subtitle: typeLabel ? `${typeLabel} · ${location || websiteHost || ''}` : (location || websiteHost),
            image_url: org.logo_url,
            relevance_score: score,
            metadata: { website: org.website, business_type: org.business_type, slug: org.slug }
          });
        }
      })());
    }

    // --- USERS/PROFILES ---
    if (allowedTypes.includes('user')) {
      searches.push((async () => {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url, bio')
          .or(`username.ilike."${escapePostgrestValue(searchPattern)}",full_name.ilike."${escapePostgrestValue(searchPattern)}"`)
          .limit(Math.ceil(sanitizedLimit / 4));

        for (const p of profiles || []) {
          const displayName = p.full_name || p.username || 'User';
          const matchField = (p.full_name || '').toLowerCase().includes(trimmedQuery.toLowerCase())
            ? p.full_name : p.username;

          let score = 0.5;
          if (matchField?.toLowerCase() === trimmedQuery.toLowerCase()) score = 1.0;
          else if (matchField?.toLowerCase().startsWith(trimmedQuery.toLowerCase())) score = 0.85;

          results.push({
            id: p.id,
            type: 'user',
            title: displayName,
            subtitle: p.username ? `@${p.username}` : undefined,
            description: p.bio?.slice(0, 100),
            image_url: p.avatar_url,
            relevance_score: score,
            metadata: { username: p.username }
          });
        }
      })());
    }

    // --- EXTERNAL IDENTITIES (BaT users, etc.) ---
    if (allowedTypes.includes('external_identity')) {
      searches.push((async () => {
        const { data: identities } = await supabase
          .from('external_identities')
          .select('id, username, display_name, platform, profile_url, avatar_url')
          .or(`username.ilike."${escapePostgrestValue(searchPattern)}",display_name.ilike."${escapePostgrestValue(searchPattern)}"`)
          .limit(Math.ceil(sanitizedLimit / 4));

        for (const ei of identities || []) {
          const displayName = ei.display_name || ei.username || 'Unknown';

          results.push({
            id: `external_${ei.id}`,
            type: 'external_identity',
            title: displayName,
            subtitle: `${ei.platform} ${ei.username ? `@${ei.username}` : ''}`.trim(),
            image_url: ei.avatar_url,
            relevance_score: 0.6,
            metadata: { platform: ei.platform, profile_url: ei.profile_url }
          });
        }
      })());
    }

    // --- TAGS/CATEGORIES (squarebody, etc.) ---
    if (allowedTypes.includes('tag')) {
      searches.push((async () => {
        // Search in vehicle_image_tags for common tags
        const { data: tags } = await supabase
          .from('vehicle_image_tags')
          .select('tag_name, confidence')
          .ilike('tag_name', searchPattern)
          .order('confidence', { ascending: false })
          .limit(10);

        // Dedupe and create tag results
        const uniqueTags = new Map<string, number>();
        for (const t of tags || []) {
          const name = t.tag_name.toLowerCase();
          if (!uniqueTags.has(name)) {
            uniqueTags.set(name, t.confidence || 0.5);
          }
        }

        for (const [tagName, confidence] of uniqueTags) {
          results.push({
            id: `tag_${tagName}`,
            type: 'tag',
            title: tagName.charAt(0).toUpperCase() + tagName.slice(1),
            subtitle: 'Category / Tag',
            relevance_score: confidence * 0.7,
            metadata: { tag: tagName }
          });
        }
      })());
    }

    // --- DEEP SEARCH (comments, descriptions, evidence via vehicle_search_index) ---
    if (allowedTypes.includes('vehicle') && queryType === 'text') {
      searches.push((async () => {
        try {
          const { data: deepResults, error: deepErr } = await supabase.rpc('search_vehicles_deep', {
            p_query: trimmedQuery,
            p_limit: 20,
            p_offset: 0,
          });
          if (deepErr || !deepResults?.length) return;

          for (const d of deepResults) {
            if (isNonAutomobile(d)) continue;
            // Only add if not already in results (the main vehicle search may have found it too)
            if (results.some(r => r.id === d.vehicle_id)) {
              // If already present, enrich with match_source info
              const existing = results.find(r => r.id === d.vehicle_id);
              if (existing && d.match_source && d.match_source !== 'vehicle') {
                existing.metadata = existing.metadata || {};
                existing.metadata.deep_match_source = d.match_source;
                existing.metadata.deep_snippet = d.snippet;
                // Boost score slightly for multi-source match
                existing.relevance_score = Math.min(existing.relevance_score + 0.1, 1.5);
              }
              continue;
            }

            const price = d.sale_price;
            results.push({
              id: d.vehicle_id,
              type: 'vehicle',
              title: `${d.year || ''} ${d.make || ''} ${d.model || ''}`.trim() || 'Vehicle',
              subtitle: price ? `$${Number(price).toLocaleString()}` : d.vin ? `VIN: ${d.vin.slice(-6)}` : undefined,
              image_url: d.primary_image_url,
              relevance_score: Math.max(d.relevance || 0.6, 0.6),
              metadata: {
                year: d.year,
                make: d.make,
                model: d.model,
                vin: d.vin,
                sale_price: price ? Number(price) : null,
                primary_image_url: d.primary_image_url,
                deep_match_source: d.match_source,
                deep_snippet: d.snippet,
              },
            });
          }
        } catch (e) {
          console.error('Deep search failed (non-fatal):', e);
        }
      })());
    }

    // Wait for all searches - use allSettled so one failure doesn't kill others
    const settled = await Promise.allSettled(searches);
    for (const r of settled) {
      if (r.status === 'rejected') {
        console.error('Search category failed:', r.reason?.message || r.reason);
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance_score - a.relevance_score);

    // --- FUZZY FALLBACK (typo tolerance) ---
    // If we have fewer than 3 vehicle results, try trigram fuzzy search
    if (queryType === 'text' && results.filter(r => r.type === 'vehicle').length < 3) {
      try {
        const { data: fuzzyResults } = await supabase.rpc('search_vehicles_fuzzy', {
          p_query: trimmedQuery,
          p_limit: 10,
        });
        if (fuzzyResults?.length) {
          for (const f of fuzzyResults) {
            if (isNonAutomobile(f)) continue;
            if (results.some(r => r.id === f.vehicle_id)) continue;
            const price = f.sale_price;
            results.push({
              id: f.vehicle_id,
              type: 'vehicle',
              title: `${f.year || ''} ${f.make || ''} ${f.model || ''}`.trim() || 'Vehicle',
              subtitle: price ? `$${Number(price).toLocaleString()}` : undefined,
              image_url: f.primary_image_url,
              relevance_score: f.relevance || 0.5,
              metadata: {
                year: f.year, make: f.make, model: f.model, vin: f.vin,
                sale_price: price ? Number(price) : null,
                primary_image_url: f.primary_image_url,
                deep_match_source: 'fuzzy',
              },
            });
          }
          // Re-sort after adding fuzzy results
          results.sort((a, b) => b.relevance_score - a.relevance_score);
        }
      } catch (e) {
        console.error('Fuzzy search failed (non-fatal):', e);
      }
    }

    // Deduplicate (by id)
    const seen = new Set<string>();
    const dedupedResults = results.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, sanitizedLimit);

    // AI fallback if results are sparse
    let aiSuggestion: string | undefined;
    if (includeAI && dedupedResults.length < 3 && trimmedQuery.length > 2) {
      aiSuggestion = `No exact matches for "${trimmedQuery}". Try searching for a specific year, make, or model.`;

      // Could enhance with actual AI call here
      // const aiResponse = await callOpenAI(`Suggest search terms for: ${trimmedQuery}`);
    }

    return new Response(JSON.stringify({
      success: true,
      results: dedupedResults,
      query_type: 'text',
      total_count: dedupedResults.length,
      ai_suggestion: aiSuggestion,
      search_time_ms: Date.now() - startTime,
      meta: {
        total_count: vehicleTotalCount || dedupedResults.length,
        offset,
        limit: sanitizedLimit,
        has_more: vehicleTotalCount > offset + dedupedResults.length,
      },
    }), { headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Universal search error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || String(error),
      results: [],
      query_type: 'text',
      total_count: 0,
      search_time_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
