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
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return 'url';

  // Year: exactly 4 digits, reasonable range
  if (/^\d{4}$/.test(trimmed)) {
    const year = parseInt(trimmed);
    if (year >= 1900 && year <= 2030) return 'year';
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

    const body: SearchRequest = await req.json();
    const { query, limit = 20, types, includeAI = true } = body;

    const queryType = detectInputType(query);
    const trimmedQuery = query.trim();
    const results: SearchResult[] = [];

    // ============================================
    // VIN SEARCH - Direct lookup
    // ============================================
    if (queryType === 'vin') {
      const vin = trimmedQuery.toUpperCase();

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, vin, status,
          vehicle_images!inner(image_url, is_primary)
        `)
        .eq('vin', vin)
        .limit(5);

      if (vehicles?.length) {
        for (const v of vehicles) {
          const images = v.vehicle_images as any[] || [];
          const primaryImage = images.find((i: any) => i.is_primary)?.image_url || images[0]?.image_url;

          results.push({
            id: v.id,
            type: 'vin_match',
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
            subtitle: `VIN: ${v.vin}`,
            image_url: primaryImage,
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
      const year = parseInt(trimmedQuery);

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, vin, status, sale_price, current_value
        `)
        .eq('year', year)
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (vehicles?.length) {
        // Batch fetch primary images
        const vehicleIds = vehicles.map(v => v.id);
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url, is_primary')
          .in('vehicle_id', vehicleIds)
          .order('is_primary', { ascending: false });

        const imageMap = new Map<string, string>();
        for (const img of images || []) {
          if (!imageMap.has(img.vehicle_id)) {
            imageMap.set(img.vehicle_id, img.image_url);
          }
        }

        for (const v of vehicles) {
          const price = v.sale_price || v.current_value;
          results.push({
            id: v.id,
            type: 'vehicle',
            title: `${v.year} ${v.make || ''} ${v.model || ''}`.trim(),
            subtitle: price ? `$${price.toLocaleString()}` : undefined,
            image_url: imageMap.get(v.id),
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

    // --- VEHICLES ---
    if (allowedTypes.includes('vehicle')) {
      searches.push((async () => {
        // Check if query looks like "year make" or "make model"
        const yearMatch = trimmedQuery.match(/^(\d{4})\s+(.+)$/);
        const words = tokens;

        let vehicleQuery = supabase
          .from('vehicles')
          .select('id, year, make, model, vin, status, sale_price, current_value')
          .eq('is_public', true);

        if (yearMatch) {
          // Query is "1965 mustang" pattern
          const year = parseInt(yearMatch[1]);
          const rest = yearMatch[2].toLowerCase();
          vehicleQuery = vehicleQuery
            .eq('year', year)
            .or(`make.ilike.%${escapeIlike(rest)}%,model.ilike.%${escapeIlike(rest)}%`);
        } else if (words.length >= 2) {
          // Multiple words: search make AND model
          const makePattern = `%${escapeIlike(words[0])}%`;
          const modelPattern = `%${escapeIlike(words.slice(1).join(' '))}%`;
          vehicleQuery = vehicleQuery.or(
            `make.ilike.${makePattern},model.ilike.${makePattern},` +
            `make.ilike.${modelPattern},model.ilike.${modelPattern}`
          );
        } else {
          // Single word: search make or model
          vehicleQuery = vehicleQuery.or(
            `make.ilike.${searchPattern},model.ilike.${searchPattern}`
          );
        }

        const { data: vehicles } = await vehicleQuery.limit(Math.ceil(limit / 2));

        if (vehicles?.length) {
          const vehicleIds = vehicles.map(v => v.id);
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('vehicle_id, image_url, is_primary')
            .in('vehicle_id', vehicleIds)
            .order('is_primary', { ascending: false });

          const imageMap = new Map<string, string>();
          for (const img of images || []) {
            if (!imageMap.has(img.vehicle_id)) {
              imageMap.set(img.vehicle_id, img.image_url);
            }
          }

          for (const v of vehicles) {
            const titleLower = `${v.year} ${v.make} ${v.model}`.toLowerCase();
            const queryLower = trimmedQuery.toLowerCase();

            // Score: exact match > starts with > contains
            let score = 0.5;
            if (titleLower === queryLower) score = 1.0;
            else if (titleLower.startsWith(queryLower)) score = 0.9;
            else if (v.make?.toLowerCase() === queryLower || v.model?.toLowerCase() === queryLower) score = 0.85;

            const price = v.sale_price || v.current_value;
            results.push({
              id: v.id,
              type: 'vehicle',
              title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
              subtitle: price ? `$${price.toLocaleString()}` : v.vin ? `VIN: ${v.vin.slice(-6)}` : undefined,
              image_url: imageMap.get(v.id),
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
          .select('id, business_name, website, logo_url, profile_image_url, city, state')
          .eq('is_public', true)
          .ilike('business_name', searchPattern)
          .limit(Math.ceil(limit / 4));

        for (const org of orgs || []) {
          const nameLower = (org.business_name || '').toLowerCase();
          const queryLower = trimmedQuery.toLowerCase();

          let score = 0.5;
          if (nameLower === queryLower) score = 1.0;
          else if (nameLower.startsWith(queryLower)) score = 0.9;

          const location = [org.city, org.state].filter(Boolean).join(', ');
          results.push({
            id: org.id,
            type: 'organization',
            title: org.business_name,
            subtitle: location || (org.website ? new URL(org.website).hostname : undefined),
            image_url: org.logo_url || org.profile_image_url,
            relevance_score: score,
            metadata: { website: org.website }
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
          .or(`username.ilike.${searchPattern},full_name.ilike.${searchPattern}`)
          .limit(Math.ceil(limit / 4));

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
          .or(`username.ilike.${searchPattern},display_name.ilike.${searchPattern}`)
          .limit(Math.ceil(limit / 4));

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

    // Wait for all searches
    await Promise.all(searches);

    // Sort by relevance
    results.sort((a, b) => b.relevance_score - a.relevance_score);

    // Deduplicate (by id)
    const seen = new Set<string>();
    const dedupedResults = results.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, limit);

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
      error: error.message,
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
