/**
 * UNIVERSAL SEARCH - The Magic Input Handler
 *
 * Handles any input: VIN, URL, year, text query, image
 * Returns rich results with thumbnails
 * AI fallback when traditional search fails
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const body: SearchRequest = await req.json().catch(() => ({} as any));
    const { query = '', limit = 20, types, includeAI = true } = body;

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

    // ============================================
    // VIN SEARCH - Direct lookup
    // ============================================
    if (queryType === 'vin') {
      const vin = trimmedQuery.toUpperCase();

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin, status, primary_image_url')
        .eq('vin', vin)
        .eq('is_public', true)
        .limit(5);

      if (vehicles?.length) {
        for (const v of vehicles) {
          results.push({
            id: v.id,
            type: 'vin_match',
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
            subtitle: `VIN: ${v.vin}`,
            image_url: v.primary_image_url,
            relevance_score: 1.0,
            metadata: { vin: v.vin, status: v.status }
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        results,
        query_type: 'vin',
        total_count: results.length,
        search_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // YEAR SEARCH - Vehicles from that year
    // ============================================
    if (queryType === 'year') {
      const year = parseInt(trimmedQuery, 10);

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin, status, sale_price, current_value, primary_image_url')
        .eq('year', year)
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(sanitizedLimit);

      if (vehicles?.length) {
        for (const v of vehicles) {
          const price = v.sale_price || v.current_value;
          results.push({
            id: v.id,
            type: 'vehicle',
            title: `${v.year} ${v.make || ''} ${v.model || ''}`.trim(),
            subtitle: price ? `$${price.toLocaleString()}` : undefined,
            image_url: v.primary_image_url,
            relevance_score: 0.95,
            metadata: { year: v.year, make: v.make, model: v.model }
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        results,
        query_type: 'year',
        total_count: results.length,
        search_time_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
        if (tsqueryStr) {
          const { data: ftsResults, error: ftsError } = await supabase
            .rpc('search_vehicles_fts', {
              query_text: tsqueryStr,
              limit_count: vehicleLimit
            });

          if (!ftsError && ftsResults?.length) {
            vehicles = ftsResults;
          } else {
            // Fallback: use direct textSearch filter on search_vector
            // This works even if the RPC has schema issues
            const { data: directResults } = await supabase
              .from('vehicles')
              .select('id, year, make, model, vin, status, sale_price, current_value, primary_image_url')
              .eq('is_public', true)
              .textSearch('search_vector', tsqueryStr, { type: 'plain', config: 'english' })
              .limit(vehicleLimit);

            if (directResults?.length) {
              vehicles = directResults;
            }
          }
        }

        // If full-text search returned nothing, fallback to ILIKE (catches partial matches)
        if (!vehicles.length) {
          const yearMatch = trimmedQuery.match(/^(\d{4})\s+(.+)$/);
          let vehicleQuery = supabase
            .from('vehicles')
            .select('id, year, make, model, vin, status, sale_price, current_value, primary_image_url')
            .eq('is_public', true);

          if (yearMatch) {
            const year = parseInt(yearMatch[1], 10);
            const rest = yearMatch[2].toLowerCase();
            vehicleQuery = vehicleQuery
              .eq('year', year)
              .or(`make.ilike.%${escapeIlike(escapePostgrestValue(rest))}%,model.ilike.%${escapeIlike(escapePostgrestValue(rest))}%`);
          } else if (tokens.length >= 2) {
            // Try both orderings: token0=make+rest=model OR token0=model+rest=make
            const t0 = escapeIlike(escapePostgrestValue(tokens[0]));
            const tRest = escapeIlike(escapePostgrestValue(tokens.slice(1).join(' ')));
            vehicleQuery = vehicleQuery.or(
              `and(make.ilike.%${t0}%,model.ilike.%${tRest}%),and(model.ilike.%${t0}%,make.ilike.%${tRest}%)`
            );
          } else {
            vehicleQuery = vehicleQuery.or(
              `make.ilike.${escapePostgrestValue(searchPattern)},model.ilike.${escapePostgrestValue(searchPattern)}`
            );
          }

          const { data: fallbackResults } = await vehicleQuery.limit(vehicleLimit);
          if (fallbackResults?.length) vehicles = fallbackResults;
        }

        if (vehicles?.length) {
          // Deduplicate by year+make+model to prevent showing identical vehicles
          const seen = new Set<string>();

          for (const v of vehicles) {
            const dedupeKey = `${v.year}|${(v.make||'').toLowerCase()}|${(v.model||'').toLowerCase()}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const titleLower = `${v.year} ${v.make} ${v.model}`.toLowerCase();
            const queryLower = trimmedQuery.toLowerCase();

            // Score based on match quality
            let score = v.relevance || 0.5; // Use ts_rank if available
            if (titleLower === queryLower) score = Math.max(score, 1.0);
            else if (titleLower.startsWith(queryLower)) score = Math.max(score, 0.9);
            else if (v.make?.toLowerCase() === queryLower || v.model?.toLowerCase() === queryLower) score = Math.max(score, 0.85);
            // Boost score if ALL search terms appear in the title
            else if (tsqueryTerms.every(t => titleLower.includes(t.toLowerCase()))) score = Math.max(score, 0.8);

            const price = v.sale_price || v.current_value;
            results.push({
              id: v.id,
              type: 'vehicle',
              title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
              subtitle: price ? `$${price.toLocaleString()}` : v.vin ? `VIN: ${v.vin.slice(-6)}` : undefined,
              image_url: v.primary_image_url,
              relevance_score: score,
              metadata: { year: v.year, make: v.make, model: v.model, vin: v.vin }
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
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
