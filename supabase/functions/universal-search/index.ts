/**
 * UNIVERSAL SEARCH - The Magic Input Handler
 *
 * Handles any input: VIN, URL, year, text query, image
 * Returns rich results with thumbnails
 * AI fallback when traditional search fails
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { candidatePage, preservePrimaryPage, MAX_SEARCH_OFFSET, type VehicleSource } from './pagination.ts';
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
  vehicle_source?: VehicleSource;
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
  total_count: number | null;
  ai_suggestion?: string;
  search_time_ms: number;
  meta?: {
    total_count: number | null;
    returned_count: number;
    next_offset: number | null;
    vehicle_source: VehicleSource | null;
    offset: number;
    limit: number;
    has_more: boolean;
    pagination_limited: boolean;
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

interface CohortTarget {
  year: number;
  make: string;
  model: string;
}

/**
 * Parse a query into a year-make-model cohort target ("1969 Chevrolet Camaro").
 * Mirrors the frontend heuristic in nuke_frontend/src/hooks/useSearchPage.ts.
 * Requires a leading 4-digit year (1885–current+1), a make token, and at least
 * one model token. Returns null when the query isn't a clean YMM — we never
 * guess a cohort from a partial query.
 */
function parseCohort(q: string): CohortTarget | null {
  const t = q.trim();
  const m = t.match(/^(1[89]\d{2}|20\d{2})\s+([A-Za-z][A-Za-z-]*)\s+(.+?)\s*$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (year < 1885 || year > new Date().getFullYear() + 1) return null;
  const make = m[2];
  const model = m[3].trim();
  if (!model) return null;
  return { year, make, model };
}

/**
 * Register a cohort subject and build the cohort_card for the response.
 * Never throws — a cohort-registration failure must not break search.
 */
/**
 * Resolve a "year + model" query (no explicit make, e.g. "1966 mustang") into a
 * cohort by looking the model up in canonical_models (by canonical name or alias)
 * and borrowing its make. This is how most people actually search — make omitted.
 * Returns null if the model can't be resolved to a single canonical make.
 */
async function resolveCohortFromModel(supabase: any, query: string): Promise<CohortTarget | null> {
  const m = query.trim().match(/^(1[89]\d{2}|20\d{2})\s+(.+?)\s*$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (year < 1885 || year > new Date().getFullYear() + 1) return null;
  const rest = m[2].trim();
  if (rest.length < 2) return null;
  // Exact-ish canonical model match first, then alias membership.
  let { data } = await supabase
    .from('canonical_models').select('make, canonical_model').ilike('canonical_model', rest).limit(1);
  if (!data?.length) {
    ({ data } = await supabase
      .from('canonical_models').select('make, canonical_model').contains('aliases', [rest.toLowerCase()]).limit(1));
  }
  if (!data?.length) return null;
  return { year, make: data[0].make, model: data[0].canonical_model };
}

async function buildCohortCard(supabase: any, query: string): Promise<any | undefined> {
  const c = parseCohort(query) ?? await resolveCohortFromModel(supabase, query);
  if (!c) return undefined;
  try {
    const { data: subjectId, error } = await supabase.rpc('register_make_model_subject', {
      p_make: c.make,
      p_model: c.model,
      p_year: c.year,
    });
    if (error || !subjectId) {
      if (error) console.error('register_make_model_subject failed (non-fatal):', error.message);
      return undefined;
    }
    return {
      type: 'cohort',
      year: c.year,
      make: c.make,
      model: c.model,
      subject_id: subjectId,
      label: `${c.year} ${c.make} ${c.model}`,
      path: `/cohort/${encodeURIComponent(c.make.toLowerCase())}/${encodeURIComponent(c.model.toLowerCase())}/${c.year}`,
    };
  } catch (e) {
    console.error('Cohort registration failed (non-fatal):', e);
    return undefined;
  }
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

class PublicVehicleReadError extends Error {}

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
      try {
        // This public function runs without gateway JWT verification. Only the
        // Auth-verified identity may authorize service-role owned-vehicle reads.
        const { data: authData, error: authError } = await supabase.auth.getUser(token);
        const userId = authData?.user?.id;
        if (!authError && userId) {
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
    const limit: number = limitRaw == null ? 100 : Number(limitRaw);
    const offsetRaw = urlParams.get('offset') ?? body.offset;
    const offset: number = offsetRaw == null ? 0 : Number(offsetRaw);
    const requestedSource = urlParams.get('vehicle_source') ?? body.vehicle_source;
    const types: string[] | undefined = urlParams.get('types')?.split(',') ?? body.types;
    const includeAI: boolean = urlParams.has('includeAI') ? urlParams.get('includeAI') !== 'false' : (body.includeAI ?? true);
    const locationFilter: string | undefined = urlParams.get('location') || (body as any).location || undefined;
    const bodyStyleFilter: string | undefined = urlParams.get('body_style') || (body as any).body_style || undefined;

    if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_SEARCH_OFFSET || !Number.isSafeInteger(limit) || limit < 1 ||
      (requestedSource != null && !['ranked', 'direct', 'ilike', 'year'].includes(requestedSource))) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid search pagination; offset must be between 0 and 10000', results: [] }),
        { status: 400, headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' } });
    }

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
    if (requestedSource && ((requestedSource === 'year') !== (queryType === 'year'))) {
      return new Response(JSON.stringify({ success: false, error: 'Search pagination source does not match query', results: [] }),
        { status: 400, headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' } });
    }
    const trimmedQuery = sanitizedQuery.trim();
    const results: SearchResult[] = [];

    // Shared rich vehicle SELECT — includes all fields needed for tier calculation and UI display
    const VEHICLE_SELECT = 'id, year, make, model, vin, color, status, sale_price, current_value, asking_price, primary_image_url, seller_name, bat_seller, data_quality_score, view_count, bat_view_count, profile_origin, ownership_verified, comment_count, mileage, transmission, engine_size, canonical_vehicle_type, canonical_body_style, body_style, image_count, observation_count, city, state, listing_location, updated_at';

    // Keep eligibility and optional match groups in one logical expression.
    // Repeated PostgREST .or() calls must not replace or weaken the public gate.
    const publicVehicleFilter = (q: any, matchGroups: string[] = []) => {
      const eligibility = 'listing_kind.is.null,listing_kind.neq.non_vehicle_item';
      const expression = matchGroups.length
        ? `and(or(${eligibility}),${matchGroups.map(group => `or(${group})`).join(',')})`
        : eligibility;
      return q.eq('is_public', true).is('deleted_at', null).or(expression);
    };

    // Exclude non-automobile types from all search results
    const NON_AUTO_TYPES = new Set(['MOTORCYCLE', 'BOAT', 'TRAILER', 'ATV', 'BUS', 'RV', 'SNOWMOBILE', 'OTHER', 'EQUIPMENT']);
    const isNonAutomobile = (v: any): boolean => {
      const vtype = (v.canonical_vehicle_type || '').toUpperCase();
      const bstyle = (v.canonical_body_style || '').toUpperCase();
      return NON_AUTO_TYPES.has(vtype) || NON_AUTO_TYPES.has(bstyle);
    };

    // RPCs can contain stale indexed parents. Resolve only this bounded batch
    // against the current public parent before using any of its payload.
    const publicVehiclesByIds = async (ids: string[], select = VEHICLE_SELECT) => {
      const uniqueIds = [...new Set(ids)];
      if (!uniqueIds.length) return [];
      if (uniqueIds.length > 200) throw new PublicVehicleReadError('Vehicle eligibility batch is too large');
      try {
        const { data, error } = await publicVehicleFilter(supabase.from('vehicles').select(select)).in('id', uniqueIds);
        if (error || !Array.isArray(data)) throw new Error('Invalid eligibility response');
        return data;
      } catch {
        throw new PublicVehicleReadError('Vehicle eligibility lookup failed; retry the same page');
      }
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
      const { data: exactVehicles, error: exactError } = await publicVehicleFilter(supabase
        .from('vehicles')
        .select(VEHICLE_SELECT))
        .ilike('vin', vin)
        .limit(10);
      if (exactError) throw new PublicVehicleReadError('Vehicle VIN search failed');

      let vehicles = exactVehicles || [];

      // If no exact match, try partial match (last 6-8 digits, or substring)
      if (!vehicles.length && vin.length >= 5) {
        const { data: partialVehicles, error: partialError } = await publicVehicleFilter(supabase
          .from('vehicles')
          .select(VEHICLE_SELECT))
          .ilike('vin', `%${escapeIlike(vin)}%`)
          .not('year', 'is', null)
          .not('make', 'is', null)
          .limit(10);
        if (partialError) throw new PublicVehicleReadError('Vehicle VIN search failed');
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

      const { data: yearCandidates, error: yearError } = await publicVehicleFilter(supabase
        .from('vehicles')
        .select(VEHICLE_SELECT))
        .eq('year', year)
        .not('make', 'is', null)
        .not('model', 'is', null)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + sanitizedLimit);
      if (yearError) throw new Error('Vehicle year search failed; retry the same page');
      const yearPage = candidatePage<any>(yearCandidates || [], offset, sanitizedLimit);
      const vehicles = yearPage.rows;

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

      // A bare-year query (e.g. "1969") never parses as a clean YMM, so this
      // returns undefined — included for parity with the text path.
      const cohortCard = offset === 0 ? await buildCohortCard(supabase, trimmedQuery) : undefined;

      return new Response(JSON.stringify({
        success: true,
        results,
        query_type: 'year',
        total_count: null,
        meta: { total_count: null, returned_count: results.length, offset, limit: sanitizedLimit,
          has_more: yearPage.has_more, next_offset: yearPage.next_offset, vehicle_source: 'year',
          pagination_limited: yearPage.pagination_limited },
        cohort_card: cohortCard,
        search_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, ...rlHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // TEXT SEARCH - Full search across all entities
    // ============================================
    const tokens = tokenizeQuery(trimmedQuery);
    const searchPattern = `%${escapeIlike(trimmedQuery)}%`;
    const allowedTypes = types || ['vehicle', 'organization', 'user', 'tag', 'external_identity'];

    // Optional filters are ANDed with eligibility and query matching in one OR
    // expression below, including combinations of location and body style.
    const vehicleMatchGroups = (): string[] => {
      const groups: string[] = [];
      if (locationFilter) {
        const loc = escapeIlike(escapePostgrestValue(locationFilter));
        if (locationFilter.length === 2) {
          // 2-letter state code
          groups.push(`state.ilike.${loc}`);
        } else {
          // City name or longer location string
          groups.push(`city.ilike.%${loc}%,state.ilike.%${loc}%,listing_location.ilike.%${loc}%`);
        }
      }
      if (bodyStyleFilter) {
        const bs = escapeIlike(escapePostgrestValue(bodyStyleFilter));
        groups.push(`body_style.ilike.%${bs}%,canonical_body_style.ilike.%${bs}%`);
      }
      return groups;
    };

    // Parallel searches
    const searches: Promise<void>[] = [];
    let vehiclePage = candidatePage<any>([], offset, sanitizedLimit);
    let vehicleSource: VehicleSource | null = null;
    let vehicleSearchFailed = false;
    const primaryVehicleIds = new Set<string>();
    const firstPage = offset === 0;
    const vehicleLimit = firstPage && allowedTypes.some(type => type !== 'vehicle')
      ? Math.max(sanitizedLimit - 6, Math.ceil(sanitizedLimit * 0.75)) : sanitizedLimit;

    // --- VEHICLES (full-text search with ts_rank) ---
    // The deep search below waits for this branch (vehicleSearchDone) and runs only when it found too few cars.
    let vehicleSearchDone: Promise<void> = Promise.resolve();
    if (allowedTypes.includes('vehicle')) {
      vehicleSearchDone = (async () => {
        // Convert query to tsquery format: "BMW M3 E30" → "BMW & M3 & E30"
        const tsqueryTerms = tokens.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).filter(t => t.length > 0);
        const tsqueryStr = tsqueryTerms.join(' & ');

        let vehicles: any[] = [];

        const useCandidates = (rows: any[], source: VehicleSource) => {
          vehiclePage = candidatePage(rows, offset, vehicleLimit);
          vehicleSource = source;
          return vehiclePage.rows;
        };
        const directSearch = async () => {
          const { data, error } = await publicVehicleFilter(supabase.from('vehicles').select(VEHICLE_SELECT))
            .not('year', 'is', null).not('make', 'is', null).not('model', 'is', null)
            .textSearch('search_vector', tsqueryStr, { type: 'plain', config: 'english' })
            .order('id', { ascending: true }).range(offset, offset + vehicleLimit);
          if (error) throw new Error('Vehicle fallback search failed; retry the same page');
          return useCandidates(data || [], 'direct');
        };

        // Continue the reader selected on page one. Never change sources after
        // consuming offsets: their populations/orderings are not interchangeable.
        if (requestedSource === 'direct') {
          vehicles = await directSearch();
        } else if (requestedSource !== 'ilike' && tsqueryStr) {
          const { data, error } = await supabase.rpc('search_vehicles_fts', {
            query_text: tsqueryStr, limit_count: vehicleLimit + 1, offset_count: offset,
          });
          if (error) {
            if (!firstPage || requestedSource) throw new Error('Ranked vehicle search failed; retry the same page');
            vehicles = await directSearch();
          } else {
            // Consume raw candidates before relevance/display filters. This
            // uses the SQL reader's single ordered candidate stream.
            const ranked = useCandidates(data || [], 'ranked').filter((r: any) => (r.relevance || 0) >= 0.85);
            if (ranked.length) {
              const enriched = await publicVehiclesByIds(ranked.map((r: any) => r.id));
              const byId = new Map((enriched || []).map((v: any) => [v.id, v]));
              vehicles = ranked.map((r: any) => ({ ...byId.get(r.id), relevance: r.relevance })).filter((v: any) => v.id);
            }
          }
        }

        // ILIKE fallback — structured field matching is more reliable than FTS for
        // multi-token queries like "Porsche 997 GT3". Skip for single-token queries
        // when FTS already returned enough results (ILIKE on broad terms like "mustang"
        // scans 30K+ rows and takes 15+ seconds to sort).
        // Select ILIKE only on the first page; an explicit ILIKE continuation
        // keeps its sale_price/id order instead of switching to ranked search.
        // Skip a new ILIKE fallback when it does more harm than good:
        //  - single-token queries ("mustang"): the ranked FTS RPC already covers these,
        //    and broad ILIKE merges junk (e.g. "Mustang-Style Pedal Car") that then floats up.
        // First-page selection remains limited to multi-token precision queries.
        const skipIlike = requestedSource !== 'ilike' && (!firstPage || !!requestedSource || tokens.length < 2 || vehicles.length >= Math.ceil(vehicleLimit / 2));
        if (!skipIlike) {
          const yearMatch = trimmedQuery.match(/^(\d{4})\s+(.+)$/);
          const matchGroups = vehicleMatchGroups();
          let ilikeQuery = supabase
            .from('vehicles')
            .select(VEHICLE_SELECT)
            // Filter stub vehicles (no year/make/model) from search results
            .not('year', 'is', null)
            .not('make', 'is', null)
            .not('model', 'is', null);

          if (yearMatch) {
            // "1973 Porsche 911" → year=1973 AND (make|model ILIKE '%porsche 911%')
            const year = parseInt(yearMatch[1], 10);
            const rest = escapeIlike(escapePostgrestValue(yearMatch[2].toLowerCase()));
            ilikeQuery = ilikeQuery.eq('year', year);
            matchGroups.push(`make.ilike.%${rest}%,model.ilike.%${rest}%,color.ilike.%${rest}%`);
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

            matchGroups.push(
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
            matchGroups.push(`make.ilike.${t},model.ilike.${t},color.ilike.${t}`);
          }

          const { data: ilikeResults, error: ilikeError } = await publicVehicleFilter(ilikeQuery, matchGroups)
            .order('sale_price', { ascending: false, nullsFirst: false })
            .order('id', { ascending: true })
            .range(offset, offset + vehicleLimit);

          if (ilikeError) {
            if (requestedSource === 'ilike') throw new Error('Vehicle precision search failed; retry the same page');
            console.error('ILIKE query error:', ilikeError.message);
          } else if (ilikeResults?.length || requestedSource === 'ilike') {
            // The selected ILIKE population now owns continuation as well.
            vehicles = useCandidates(ilikeResults || [], 'ilike');
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
            primaryVehicleIds.add(v.id);

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
      })();
      searches.push(vehicleSearchDone.catch(error => { vehicleSearchFailed = true; throw error; }));
    }

    // --- USER'S OWN VEHICLES (parallel search for authenticated users) ---
    if (firstPage && allowedTypes.includes('vehicle') && userVehicleIds.size > 0) {
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
    if (firstPage && allowedTypes.includes('organization')) {
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
    if (firstPage && allowedTypes.includes('user')) {
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
    if (firstPage && allowedTypes.includes('external_identity')) {
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
    if (firstPage && allowedTypes.includes('tag')) {
      searches.push((async () => {
        // Search in image_tags for common tags (repointed from ghost vehicle_image_tags 2026-07-12)
        const { data: tags } = await supabase
          .from('image_tags')
          .select('tag_name, confidence')
          .ilike('tag_name', searchPattern)
          .order('confidence', { ascending: false })
          .limit(10);

        // Dedupe and create tag results.
        // image_tags.confidence is an integer 0-100; normalize to 0-1 to match the
        // relevance_score scale used elsewhere in this function.
        const uniqueTags = new Map<string, number>();
        for (const t of tags || []) {
          const name = t.tag_name.toLowerCase();
          if (!uniqueTags.has(name)) {
            uniqueTags.set(name, (t.confidence ?? 50) / 100);
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
    if (firstPage && allowedTypes.includes('vehicle') && queryType === 'text') {
      searches.push((async () => {
        try {
          // search_vehicles_deep ranks every text match in vehicle_search_index (1.6 GB): 'porsche 911' matched
          // 17,952 rows and took 35.5 s, holding every search to that (2026-09-28: 'porsche 911' 42–55 s end to
          // end). It adds description / comment / evidence matches, which a make-model query already answered
          // by the main vehicle search does not need: run it only when that search found fewer than half a page.
          await vehicleSearchDone;
          const vehicleSlots = Math.max(sanitizedLimit - 6, Math.ceil(sanitizedLimit * 0.75));
          if (results.filter(r => r.type === 'vehicle').length >= Math.ceil(vehicleSlots / 2)) return;
          const { data: deepResults, error: deepErr } = await supabase.rpc('search_vehicles_deep', {
            p_query: trimmedQuery,
            p_limit: 20,
            p_offset: 0,
          });
          if (deepErr || !deepResults?.length) return;
          const deepCandidates = deepResults.slice(0, 20);
          const eligibleParents = await publicVehiclesByIds(
            deepCandidates.map((d: any) => d.vehicle_id), 'id, canonical_vehicle_type, canonical_body_style');
          const eligibleIds = new Set(eligibleParents.filter((v: any) => !isNonAutomobile(v)).map((v: any) => v.id));
          for (const d of deepCandidates) {
            if (!eligibleIds.has(d.vehicle_id)) continue;
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
          if (e instanceof PublicVehicleReadError) { vehicleSearchFailed = true; throw e; }
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

    if (vehicleSearchFailed) throw new Error('Vehicle search failed; retry the same page');

    // Sort by relevance, with image boost (results with photos rank higher)
    results.sort((a, b) => {
      const aScore = a.relevance_score + (a.image_url ? 0.15 : 0);
      const bScore = b.relevance_score + (b.image_url ? 0.15 : 0);
      return bScore - aScore || a.id.localeCompare(b.id);
    });

    // --- FUZZY FALLBACK (typo tolerance) ---
    // If we have fewer than 3 vehicle results, try trigram fuzzy search
    if (firstPage && allowedTypes.includes('vehicle') && queryType === 'text' && results.filter(r => r.type === 'vehicle').length < 3) {
      try {
        const { data: fuzzyResults } = await supabase.rpc('search_vehicles_fuzzy', {
          p_query: trimmedQuery,
          p_limit: 10,
        });
        if (fuzzyResults?.length) {
          const fuzzyCandidates = fuzzyResults.slice(0, 10);
          const eligibleParents = await publicVehiclesByIds(
            fuzzyCandidates.map((f: any) => f.vehicle_id), 'id, canonical_vehicle_type, canonical_body_style');
          const eligibleIds = new Set(eligibleParents.filter((v: any) => !isNonAutomobile(v)).map((v: any) => v.id));
          for (const f of fuzzyCandidates) {
            if (!eligibleIds.has(f.vehicle_id)) continue;
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
          results.sort((a, b) => b.relevance_score - a.relevance_score || a.id.localeCompare(b.id));
        }
      } catch (e) {
        if (e instanceof PublicVehicleReadError) throw e;
        console.error('Fuzzy search failed (non-fatal):', e);
      }
    }

    // Keep every displayed primary candidate already consumed by next_offset.
    const dedupedResults = preservePrimaryPage(results, primaryVehicleIds, sanitizedLimit);

    // AI fallback if results are sparse
    let aiSuggestion: string | undefined;
    if (firstPage && includeAI && dedupedResults.length < 3 && trimmedQuery.length > 2) {
      aiSuggestion = `No exact matches for "${trimmedQuery}". Try searching for a specific year, make, or model.`;

      // Could enhance with actual AI call here
      // const aiResponse = await callOpenAI(`Suggest search terms for: ${trimmedQuery}`);
    }

    // Clean year-make-model query → auto-register cohort subject + attach card.
    // Only runs when parseCohort succeeds (never for VINs, URLs, bare years, or
    // single-word queries). Failures are swallowed inside buildCohortCard.
    const cohortCard = offset === 0 ? await buildCohortCard(supabase, trimmedQuery) : undefined;

    return new Response(JSON.stringify({
      success: true,
      results: dedupedResults,
      query_type: 'text',
      total_count: null,
      ai_suggestion: aiSuggestion,
      cohort_card: cohortCard,
      search_time_ms: Date.now() - startTime,
      meta: {
        total_count: null,
        returned_count: dedupedResults.length,
        offset,
        limit: sanitizedLimit,
        has_more: vehiclePage.has_more,
        pagination_limited: vehiclePage.pagination_limited,
        next_offset: vehiclePage.next_offset,
        vehicle_source: vehicleSource,
        consumed_candidates: vehiclePage.consumed,
        pagination_scope: 'primary_vehicle_candidates',
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
