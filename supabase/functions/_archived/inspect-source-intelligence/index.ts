/**
 * INSPECT SOURCE INTELLIGENCE
 *
 * Uses cheap LLM (GPT-4o-mini) to analyze sources and generate structured intelligence.
 * Pattern matching first, LLM only when needed.
 *
 * Actions:
 * - inspect_source: Inspect a single source and generate intelligence
 * - inspect_batch: Inspect multiple sources
 * - get_craigslist_patterns: Learn query patterns from aggregators
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { action = 'inspect_source', source_id, batch_size = 5, use_llm = false } = body;

    switch (action) {
      case 'inspect_source':
        if (!source_id) {
          return errorResponse('source_id required');
        }
        return await inspectSource(supabase, source_id, use_llm);

      case 'inspect_batch':
        return await inspectBatch(supabase, batch_size, use_llm);

      case 'get_craigslist_patterns':
        return await getCraigslistPatterns();

      case 'get_uninspected':
        return await getUninspectedSources(supabase, batch_size);

      default:
        return errorResponse(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    console.error('Error:', error);
    return errorResponse(error.message);
  }
});

function errorResponse(message: string) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Inspect a single source
async function inspectSource(supabase: any, sourceId: string, useLlm: boolean) {
  // Get source
  const { data: source, error: srcErr } = await supabase
    .from('scrape_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (srcErr || !source) {
    return errorResponse('Source not found');
  }

  console.log(`Inspecting: ${source.name}`);
  console.log(`URL: ${source.url}`);

  // Generate intelligence
  const intelligence = await generateIntelligence(source, useLlm);

  // Upsert into source_intelligence
  const { data: saved, error: saveErr } = await supabase
    .from('source_intelligence')
    .upsert({
      source_id: sourceId,
      ...intelligence,
      last_inspected_at: new Date().toISOString(),
      inspected_by: useLlm ? 'llm' : 'automated',
    }, { onConflict: 'source_id' })
    .select()
    .single();

  if (saveErr) {
    console.error('Save error:', saveErr);
  }

  return new Response(
    JSON.stringify({
      success: true,
      source: { id: source.id, name: source.name, url: source.url },
      intelligence,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Generate intelligence for a source
async function generateIntelligence(source: any, useLlm: boolean): Promise<any> {
  const url = source.url?.toLowerCase() || '';
  const hostname = extractHostname(url);
  const sourceType = source.source_type;

  // Start with pattern-based analysis
  const intel: any = {
    source_purpose: 'vehicle_listings',
    data_quality_tier: 'standard',
    extraction_priority: 50,
    strengths: [],
    weaknesses: [],
    requires_js_rendering: false,
    recommended_extraction_method: 'simple_fetch',
    vehicle_specialties: [],
  };

  // === KNOWN PREMIUM SOURCES ===
  if (hostname.includes('bringatrailer.com')) {
    return {
      ...intel,
      data_quality_tier: 'premium',
      extraction_priority: 95,
      strengths: ['detailed specs', 'bid history', 'comment insights', 'seller verified', 'high-res images'],
      weaknesses: ['auction format only', 'time-limited listings'],
      best_used_for: 'High-quality vehicle data with provenance and market pricing from bid history',
      recommended_extraction_method: 'bat_extractor',
      vehicle_specialties: ['classics', 'enthusiast', 'sports', 'trucks'],
    };
  }

  if (hostname.includes('carsandbids.com')) {
    return {
      ...intel,
      data_quality_tier: 'premium',
      extraction_priority: 90,
      strengths: ['video walkarounds', 'bid history', 'Doug score', 'comment insights'],
      weaknesses: ['newer vehicles focus', 'auction format only'],
      best_used_for: 'Modern enthusiast vehicles with video content',
      recommended_extraction_method: 'simple_fetch',
      vehicle_specialties: ['modern_classics', 'sports', 'enthusiast'],
    };
  }

  if (hostname.includes('pcarmarket.com')) {
    return {
      ...intel,
      data_quality_tier: 'premium',
      extraction_priority: 85,
      strengths: ['Porsche specialists', 'detailed specs', 'inspection reports'],
      weaknesses: ['Porsche only'],
      best_used_for: 'Porsche-specific vehicle data',
      recommended_extraction_method: 'simple_fetch',
      vehicle_specialties: ['porsche'],
    };
  }

  if (hostname.includes('mecum.com')) {
    return {
      ...intel,
      data_quality_tier: 'premium',
      extraction_priority: 85,
      strengths: ['auction results', 'lot details', 'consignment info'],
      weaknesses: ['requires JS', 'live auction focus'],
      best_used_for: 'Physical auction results and upcoming lots',
      requires_js_rendering: true,
      recommended_extraction_method: 'playwright',
      vehicle_specialties: ['muscle_cars', 'classics', 'trucks'],
    };
  }

  if (hostname.includes('rmsothebys.com') || hostname.includes('sothebys')) {
    return {
      ...intel,
      data_quality_tier: 'premium',
      extraction_priority: 80,
      strengths: ['high-end vehicles', 'detailed provenance', 'professional photography'],
      weaknesses: ['requires JS', 'luxury focus'],
      best_used_for: 'High-end collector vehicles with provenance',
      requires_js_rendering: true,
      recommended_extraction_method: 'playwright',
      vehicle_specialties: ['luxury', 'rare', 'vintage'],
    };
  }

  // === AGGREGATORS ===
  if (hostname.includes('searchtempest') || hostname.includes('searchallof')) {
    return {
      ...intel,
      source_purpose: 'aggregator',
      data_quality_tier: 'reference_only',
      extraction_priority: 30,
      strengths: ['searches multiple sites', 'finds private sellers', 'geographic filtering'],
      weaknesses: ['aggregator not source', 'links to external sites'],
      best_used_for: 'Learn query patterns to search Craigslist/FB Marketplace directly',
      recommended_extraction_method: 'reference',
      query_template: 'https://www.searchtempest.com/results?search={query}&category=5&region=usa',
      supported_filters: { query: true, category: true, region: true, price_range: true },
    };
  }

  // === DEALERS ===
  if (sourceType === 'dealer') {
    // Check for known dealer platforms
    if (url.includes('dealerspike') || url.includes('dealerfire') || url.includes('dealercar')) {
      intel.recommended_extraction_method = 'simple_fetch';
      intel.strengths.push('structured inventory');
    } else {
      intel.requires_js_rendering = true;
      intel.recommended_extraction_method = 'playwright';
    }

    intel.data_quality_tier = 'standard';
    intel.extraction_priority = 60;
    intel.strengths.push('inventory listings', 'dealer info');
    intel.weaknesses.push('variable data quality', 'may need JS');
    intel.best_used_for = 'Current inventory and pricing from dealerships';

    // Check for specialty dealers based on name
    const nameLower = (source.name || '').toLowerCase();
    if (nameLower.includes('classic') || nameLower.includes('vintage')) {
      intel.vehicle_specialties.push('classics');
      intel.extraction_priority = 70;
    }
    if (nameLower.includes('porsche')) {
      intel.vehicle_specialties.push('porsche');
    }
    if (nameLower.includes('truck') || nameLower.includes('4x4')) {
      intel.vehicle_specialties.push('trucks');
    }

    return intel;
  }

  // === MARKETPLACES ===
  if (sourceType === 'marketplace' || hostname.includes('classic.com') || hostname.includes('classiccars.com')) {
    return {
      ...intel,
      source_purpose: 'vehicle_listings',
      data_quality_tier: 'standard',
      extraction_priority: 75,
      strengths: ['aggregated listings', 'price comparisons', 'large inventory'],
      weaknesses: ['varied data quality', 'links to dealers'],
      best_used_for: 'Finding vehicles across multiple sources',
      recommended_extraction_method: 'simple_fetch',
    };
  }

  // === EVENTS ===
  if (hostname.includes('1000miglia') || hostname.includes('dakar') || hostname.includes('pebblebeach') || hostname.includes('goodwood')) {
    return {
      ...intel,
      source_purpose: 'event_calendar',
      data_quality_tier: 'reference_only',
      extraction_priority: 20,
      strengths: ['event schedules', 'participant lists', 'results'],
      weaknesses: ['not vehicle listings'],
      best_used_for: 'Tracking events and finding featured vehicles',
      recommended_extraction_method: 'reference',
    };
  }

  // === AUCTIONS (default) ===
  if (sourceType === 'auction') {
    intel.data_quality_tier = 'standard';
    intel.extraction_priority = 70;
    intel.requires_js_rendering = true;
    intel.recommended_extraction_method = 'playwright';
    intel.strengths.push('auction results', 'pricing data');
    intel.weaknesses.push('may require JS', 'time-limited');
    intel.best_used_for = 'Auction vehicle data and results';
  }

  // If LLM requested and we don't have good intelligence, fetch and analyze
  if (useLlm && intel.data_quality_tier === 'standard') {
    const llmIntel = await analyzeWithLLM(source.url, source.name);
    if (llmIntel) {
      return { ...intel, ...llmIntel };
    }
  }

  return intel;
}

// Analyze a page with cheap LLM
async function analyzeWithLLM(url: string, sourceName: string): Promise<any | null> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    console.log('No OpenAI key, skipping LLM analysis');
    return null;
  }

  try {
    // Fetch page content
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    // Call cheap LLM
    const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You analyze vehicle-related websites. Return JSON with:
- source_purpose: vehicle_listings|aggregator|reference|event_calendar|price_guide|parts_catalog|community
- data_quality_tier: premium|standard|basic|reference_only
- extraction_priority: 1-100 (higher = better data)
- strengths: array of strengths
- weaknesses: array of weaknesses
- best_used_for: one sentence
- vehicle_specialties: array like ["classics", "trucks", "porsche"]
- requires_js_rendering: boolean
- inspection_notes: what you learned`
          },
          {
            role: 'user',
            content: `Analyze this source: ${sourceName}\nURL: ${url}\n\nPage content:\n${textContent}`
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      }),
    });

    const data = await llmResponse.json();
    return JSON.parse(data.choices[0].message.content);

  } catch (err) {
    console.error('LLM analysis failed:', err);
    return null;
  }
}

// Inspect batch of sources
async function inspectBatch(supabase: any, batchSize: number, useLlm: boolean) {
  // Get all existing intelligence source_ids first
  const { data: existing } = await supabase
    .from('source_intelligence')
    .select('source_id');

  const existingIds = new Set((existing || []).map((e: any) => e.source_id));
  console.log(`Already have intelligence for ${existingIds.size} sources`);

  // Get active sources and filter locally (more reliable than subquery)
  const { data: allSources, error } = await supabase
    .from('scrape_sources')
    .select('id, name, url, source_type')
    .eq('is_active', true)
    .order('source_type')
    .limit(500); // Get more to filter from

  if (error || !allSources?.length) {
    return new Response(
      JSON.stringify({ success: true, message: 'No sources found', inspected: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Filter to uninspected
  const uninspected = allSources.filter((s: any) => !existingIds.has(s.id)).slice(0, batchSize);
  console.log(`Found ${uninspected.length} uninspected sources to process`);

  if (!uninspected.length) {
    return new Response(
      JSON.stringify({ success: true, message: 'All sources inspected', inspected: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const results = [];
  for (const source of uninspected) {
    console.log(`Inspecting: ${source.name}`);
    const intelligence = await generateIntelligence(source, useLlm);
    const { error: upsertErr } = await supabase
      .from('source_intelligence')
      .upsert({
        source_id: source.id,
        ...intelligence,
        last_inspected_at: new Date().toISOString(),
        inspected_by: useLlm ? 'llm' : 'automated',
      }, { onConflict: 'source_id' });

    if (upsertErr) {
      console.error(`Error upserting intelligence for ${source.name}:`, upsertErr);
    }
    results.push({ source_id: source.id, name: source.name, ...intelligence });
  }

  return new Response(
    JSON.stringify({ success: true, inspected: results.length, results }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Get Craigslist query patterns for squarebody trucks
async function getCraigslistPatterns() {
  const patterns = {
    description: 'Query patterns to find squarebody trucks on Craigslist',
    base_url: 'https://{city}.craigslist.org/search/cta',
    parameters: {
      query: 'Search term (e.g., "c10", "k10", "squarebody")',
      min_year: 'Minimum year (1973 for squarebody)',
      max_year: 'Maximum year (1987 for C/K, 1991 for R/V)',
      purveyor: '"owner" for private sellers, "dealer" for dealers',
      auto_make_model: 'Make and model code',
    },
    squarebody_queries: [
      {
        name: '73-87 Chevy C10',
        url: '/search/cta?query=c10&min_year=1973&max_year=1987&purveyor=owner',
        notes: 'Short bed, long bed, custom deluxe',
      },
      {
        name: '73-87 Chevy K10 4x4',
        url: '/search/cta?query=k10&min_year=1973&max_year=1987&purveyor=owner',
        notes: '4WD version',
      },
      {
        name: '73-87 GMC C1500/C15',
        url: '/search/cta?query=gmc+c15&min_year=1973&max_year=1987&purveyor=owner',
        notes: 'GMC equivalent',
      },
      {
        name: '73-91 Chevy Suburban',
        url: '/search/cta?query=suburban&min_year=1973&max_year=1991&purveyor=owner&auto_make_model=chevrolet',
        notes: 'R/V series went to 1991',
      },
      {
        name: '73-91 Blazer/Jimmy',
        url: '/search/cta?query=blazer+OR+jimmy&min_year=1973&max_year=1991&purveyor=owner',
        notes: 'Full-size Blazer/Jimmy',
      },
      {
        name: 'Squarebody general',
        url: '/search/cta?query=squarebody&purveyor=owner',
        notes: 'Catches listings that use the term',
      },
    ],
    major_cities: [
      'losangeles', 'phoenix', 'dallas', 'houston', 'denver',
      'seattle', 'portland', 'sfbay', 'sandiego', 'atlanta',
    ],
    tips: [
      'Owner listings often have better prices than dealer',
      'Check surrounding cities - sellers list in multiple areas',
      'Search for common misspellings: "squarebody", "square body"',
      'Use OR operator: "c10 OR k10 OR c20"',
    ],
  };

  return new Response(
    JSON.stringify({ success: true, patterns }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Get uninspected sources
async function getUninspectedSources(supabase: any, limit: number) {
  const { data: existing } = await supabase
    .from('source_intelligence')
    .select('source_id');

  const existingIds = new Set((existing || []).map((e: any) => e.source_id));

  // Get all active sources and filter locally
  const { data: allSources } = await supabase
    .from('scrape_sources')
    .select('id, name, url, source_type')
    .eq('is_active', true)
    .order('source_type')
    .limit(500);

  const uninspected = (allSources || []).filter((s: any) => !existingIds.has(s.id)).slice(0, limit);

  return new Response(
    JSON.stringify({
      success: true,
      count: uninspected.length,
      total_sources: allSources?.length || 0,
      already_inspected: existingIds.size,
      sources: uninspected,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
