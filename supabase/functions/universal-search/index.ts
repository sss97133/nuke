/**
 * UNIVERSAL SEARCH - The Magic Input Handler
 *
 * Handles any input: VIN, URL, year, text query, image
 * Returns rich results with thumbnails
 * AI fallback when traditional search fails
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
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

serve(async (req) => {
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

    // Support both GET (?query=...) and POST (JSON body)
    const url = new URL(req.url);
    const urlParams = url.searchParams;
    const body: SearchRequest = req.method === 'GET' ? {} as any : await req.json().catch(() => ({} as any));

    const query: string = urlParams.get('query') ?? body.query ?? '';
    const limitRaw = urlParams.get('limit') ?? body.limit;
    const limit: number = limitRaw ? Number(limitRaw) : 20;
    const types: string[] | undefined = urlParams.get('types')?.split(',') ?? body.types;
    const includeAI: boolean = urlParams.has('includeAI') ? urlParams.get('includeAI') !== 'false' : (body.includeAI ?? true);

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
    const sanitizedLimit = Math.max(1, Math.min(typeof limit === 'number' ? limit : 20, 100));

    const queryType = detectInputType(sanitizedQuery);
    const trimmedQuery = sanitizedQuery.trim();
    const results: SearchResult[] = [];

    // Shared rich vehicle SELECT — includes all fields needed for tier calculation and UI display
    const VEHICLE_SELECT = 'id, year, make, model, vin, status, sale_price, current_value, asking_price, primary_image_url, seller_name, bat_seller, data_quality_score, view_count, bat_view_count, profile_origin, ownership_verified, comment_count, image_count, mileage, transmission, engine_size';

    // Build a rich metadata object from a vehicle row
    const buildVehicleMetadata = (v: any) => ({
      year: v.year,
      make: v.make,
      model: v.model,
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
      // comment_count is a solid engagement proxy (BaT comments, auction comments)
      event_count: v.comment_count || 0,
      // Use actual image_count from DB (aggregated count from vehicle_images table)
      image_count: v.image_count || (v.primary_image_url ? 1 : 0),
      mileage: v.mileage,
      transmission: v.transmission,
      engine_size: v.engine_size,
    });

    // ============================================
    // VIN SEARCH - Direct lookup
    // ============================================
    if (queryType === 'vin') {
      const vin = trimmedQuery.toUpperCase();

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select(VEHICLE_SELECT)
        .eq('vin', vin)
        .eq('is_public', true)
        .limit(5);

      if (vehicles?.length) {
        for (const v of vehicles) {
          const price = v.sale_price || v.current_value || v.asking_price;
          results.push({
            id: v.id,
            type: 'vin_match',
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
            subtitle: `VIN: ${v.vin}`,
            image_url: v.primary_image_url,
            relevance_score: 1.0,
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

    // Parallel searches
    const searches: Promise<void>[] = [];

    // --- VEHICLES (full-text search with ts_rank) ---
    if (allowedTypes.includes('vehicle')) {
      searches.push((async () => {
        const vehicleLimit = Math.ceil(sanitizedLimit / 2);

        // Convert query to tsquery format: "BMW M3 E30" → "BMW & M3 & E30"
        const tsqueryTerms = tokens.map(t => t.replace(/[^a-zA-Z0-9]/g, '')).filter(t => t.length > 0);
        const tsqueryStr = tsqueryTerms.join(' & ');

        let vehicles: any[] = [];

        // Try full-text search first (uses GIN index on search_vector)
        // Only accept high-confidence results (>= 0.85) — strategy 2 in the RPC uses raw FTS
        // which can return garbage matches (e.g. "997" matching Austin-Healey Sprite 997cc).
        if (tsqueryStr) {
          const { data: ftsResults, error: ftsError } = await supabase
            .rpc('search_vehicles_fts', {
              query_text: tsqueryStr,
              limit_count: vehicleLimit
            });

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

        // ILIKE fallback — always try this and merge; structured field matching is more reliable
        // than FTS for make/model queries like "Porsche 997 GT3"
        // FIX: For multi-token queries, prefer ILIKE over FTS (more precise for "porsche 911")
        {
          const yearMatch = trimmedQuery.match(/^(\d{4})\s+(.+)$/);
          let ilikeQuery = supabase
            .from('vehicles')
            .select(VEHICLE_SELECT)
            .eq('is_public', true)
            // Filter stub vehicles (no year/make/model) from search results
            .not('year', 'is', null)
            .not('make', 'is', null)
            .not('model', 'is', null);

          if (yearMatch) {
            // "1973 Porsche 911" → year=1973 AND (make|model ILIKE '%porsche 911%')
            const year = parseInt(yearMatch[1], 10);
            const rest = escapeIlike(escapePostgrestValue(yearMatch[2].toLowerCase()));
            ilikeQuery = ilikeQuery
              .eq('year', year)
              .or(`make.ilike.%${rest}%,model.ilike.%${rest}%`);
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
              // Broad: make matches any token (e.g. "gt3" alone won't match but "porsche" will)
              `and(make.ilike.%${t0}%,${tokenClauses.split(',')[1] || tokenClauses})`
            );
          } else {
            // Single token: search both make and model
            const t = escapePostgrestValue(searchPattern);
            ilikeQuery = ilikeQuery.or(`make.ilike.${t},model.ilike.${t}`);
          }

          const { data: ilikeResults } = await ilikeQuery
            .order('sale_price', { ascending: false, nullsFirst: false })
            .limit(vehicleLimit);

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

        if (vehicles?.length) {
          // Deduplicate by ID only — year+make+model dedup incorrectly collapsed distinct
          // vehicles (e.g. all 1973 Porsche 911s became one result). ID dedup at the end
          // of the function handles final deduplication.
          const seenIds = new Set<string>();

          for (const v of vehicles) {
            if (seenIds.has(v.id)) continue;
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

    // Wait for all searches - use allSettled so one failure doesn't kill others
    const settled = await Promise.allSettled(searches);
    for (const r of settled) {
      if (r.status === 'rejected') {
        console.error('Search category failed:', r.reason?.message || r.reason);
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance_score - a.relevance_score);

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
      search_time_ms: Date.now() - startTime
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
