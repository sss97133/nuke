/**
 * VALIDATE SOURCE EXTRACTION
 *
 * Tests each scrape source to see if it yields vehicle data.
 * Extracts 1 vehicle from each source to validate:
 * - Is this a vehicle source or not?
 * - What extractor works for it?
 * - What data quality can we expect?
 *
 * Actions:
 * - validate_all: Test all sources (batched)
 * - validate_source: Test a single source by ID
 * - get_validation_results: Get results summary
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidationResult {
  source_id: string;
  source_name: string;
  source_url: string;
  source_type: string;
  is_vehicle_source: boolean;
  extraction_method: string | null;
  sample_vehicle_id: string | null;
  sample_vehicle_title: string | null;
  error: string | null;
  validated_at: string;
}

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
    const { action = 'get_validation_results', source_id, batch_size = 10, offset = 0 } = body;

    console.log('='.repeat(70));
    console.log('VALIDATE SOURCE EXTRACTION');
    console.log('='.repeat(70));
    console.log(`Action: ${action}`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    switch (action) {
      case 'validate_all':
        return await validateAllSources(supabase, batch_size, offset);

      case 'validate_source':
        if (!source_id) {
          return new Response(
            JSON.stringify({ error: 'source_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return await validateSingleSource(supabase, source_id);

      case 'get_validation_results':
        return await getValidationResults(supabase);

      case 'get_unvalidated':
        return await getUnvalidatedSources(supabase, batch_size);

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Validate all sources (batched)
async function validateAllSources(supabase: any, batchSize: number, offset: number) {
  console.log(`Validating sources (batch_size=${batchSize}, offset=${offset})...\n`);

  // Get sources that haven't been validated yet
  const { data: sources, error: sourcesErr } = await supabase
    .from('scrape_sources')
    .select('id, name, url, source_type')
    .is('validation_status', null)
    .eq('is_active', true)
    .order('source_type')
    .range(offset, offset + batchSize - 1);

  if (sourcesErr) {
    return new Response(
      JSON.stringify({ success: false, error: sourcesErr.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!sources || sources.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        message: 'No more sources to validate',
        validated: 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const results: ValidationResult[] = [];

  for (const source of sources) {
    console.log(`\nValidating: ${source.name} (${source.source_type})`);
    console.log(`  URL: ${source.url}`);

    const result = await testSourceExtraction(supabase, source);
    results.push(result);

    // Update source with validation result
    await supabase
      .from('scrape_sources')
      .update({
        validation_status: result.is_vehicle_source ? 'vehicle_source' : 'non_vehicle_source',
        validation_error: result.error,
        validated_at: result.validated_at,
        sample_vehicle_id: result.sample_vehicle_id,
      })
      .eq('id', source.id);

    console.log(`  Result: ${result.is_vehicle_source ? '✅ VEHICLE SOURCE' : '❌ NOT A VEHICLE SOURCE'}`);
    if (result.error) console.log(`  Error: ${result.error}`);
  }

  const vehicleSources = results.filter(r => r.is_vehicle_source).length;
  const nonVehicleSources = results.filter(r => !r.is_vehicle_source).length;

  return new Response(
    JSON.stringify({
      success: true,
      validated: results.length,
      vehicle_sources: vehicleSources,
      non_vehicle_sources: nonVehicleSources,
      results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Test extraction from a single source
async function testSourceExtraction(supabase: any, source: any): Promise<ValidationResult> {
  const result: ValidationResult = {
    source_id: source.id,
    source_name: source.name,
    source_url: source.url,
    source_type: source.source_type,
    is_vehicle_source: false,
    extraction_method: null,
    sample_vehicle_id: null,
    sample_vehicle_title: null,
    error: null,
    validated_at: new Date().toISOString(),
  };

  try {
    // Extract hostname for matching
    let hostname = '';
    try {
      hostname = new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      hostname = source.url;
    }

    // Determine extraction method based on source type and URL
    const extractionMethod = determineExtractionMethod(source);
    result.extraction_method = extractionMethod;

    // Check if we already have vehicles from this source (multiple matching strategies)
    const { data: existingVehicles, error: existingErr } = await supabase
      .from('vehicles')
      .select('id, year, make, model, listing_url')
      .or(`listing_url.ilike.%${hostname}%,bat_auction_url.ilike.%${hostname}%,discovery_url.ilike.%${hostname}%`)
      .not('listing_url', 'is', null)
      .limit(3);

    if (!existingErr && existingVehicles && existingVehicles.length > 0) {
      result.is_vehicle_source = true;
      result.sample_vehicle_id = existingVehicles[0].id;
      result.sample_vehicle_title = `${existingVehicles[0].year || ''} ${existingVehicles[0].make || ''} ${existingVehicles[0].model || ''}`.trim();
      return result;
    }

    // Known vehicle source types
    const knownVehicleSources = [
      'bringatrailer.com',
      'carsandbids.com',
      'pcarmarket.com',
      'collectingcars.com',
      'mecum.com',
      'rmsothebys.com',
      'barrett-jackson.com',
      'hemmings.com',
      'classiccars.com',
      'autotrader.com',
      'ebay.com/motors',
    ];

    if (knownVehicleSources.some(ks => hostname.includes(ks) || source.url.includes(ks))) {
      result.is_vehicle_source = true;
      result.error = 'known_vehicle_platform';
      return result;
    }

    // Try to extract based on method
    switch (extractionMethod) {
      case 'bat':
        result.is_vehicle_source = true; // BaT is always a vehicle source
        break;

      case 'firecrawl_scrape':
        // Would need Firecrawl - still mark as potential vehicle source if it's a dealer
        if (source.source_type === 'dealer') {
          result.is_vehicle_source = true; // Dealers are vehicle sources
          result.error = 'needs_firecrawl_for_extraction';
        } else {
          result.error = 'requires_firecrawl';
        }
        break;

      case 'simple_fetch':
        // Try simple fetch and look for vehicle patterns
        const hasVehicles = await checkForVehiclePatterns(source.url);
        result.is_vehicle_source = hasVehicles;
        if (!hasVehicles) {
          // If it's marked as dealer type, assume it's a vehicle source
          if (source.source_type === 'dealer') {
            result.is_vehicle_source = true;
            result.error = 'assumed_vehicle_source_dealer';
          } else {
            result.error = 'no_vehicle_patterns_found';
          }
        }
        break;

      case 'api':
        // API sources need custom handlers
        result.is_vehicle_source = true; // Assume API sources are vehicle sources
        result.error = 'api_source_needs_custom_handler';
        break;

      default:
        result.error = 'unknown_extraction_method';
    }

  } catch (err: any) {
    result.error = err.message || 'unknown_error';
  }

  return result;
}

// Determine extraction method for a source
function determineExtractionMethod(source: any): string | null {
  const url = source.url.toLowerCase();
  const sourceType = source.source_type;

  // BaT has dedicated extractors
  if (url.includes('bringatrailer.com')) return 'bat';

  // Auction sites
  if (sourceType === 'auction') {
    if (url.includes('carsandbids.com')) return 'simple_fetch';
    if (url.includes('pcarmarket.com')) return 'simple_fetch';
    if (url.includes('collectingcars.com')) return 'simple_fetch';
    return 'firecrawl_scrape'; // Most auctions need JS rendering
  }

  // Dealer sites
  if (sourceType === 'dealer') {
    // Check for known platforms
    if (url.includes('dealerspike.com')) return 'simple_fetch';
    if (url.includes('dealerfire.com')) return 'simple_fetch';
    return 'firecrawl_scrape'; // Most dealers need JS rendering
  }

  // Marketplace
  if (sourceType === 'marketplace') {
    return 'simple_fetch';
  }

  // Classifieds
  if (sourceType === 'classifieds') {
    return 'simple_fetch';
  }

  return 'firecrawl_scrape';
}

// Check URL for vehicle patterns using simple fetch
async function checkForVehiclePatterns(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
        'Accept': 'text/html',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) return false;

    const html = await response.text();
    const contentLower = html.toLowerCase();

    // Vehicle patterns
    const vehiclePatterns = [
      /\b(19|20)\d{2}\s+(chevrolet|chevy|ford|dodge|gmc|toyota|honda|bmw|mercedes|porsche|ferrari|lamborghini)/i,
      /\bvin[:\s]*[A-HJ-NPR-Z0-9]{17}/i,
      /\bmileage[:\s]*[\d,]+/i,
      /\bodometer[:\s]*[\d,]+/i,
      /\b(for sale|listed|asking|price)[:\s]*\$[\d,]+/i,
      /class=".*vehicle.*"/i,
      /class=".*inventory.*"/i,
      /class=".*listing.*"/i,
    ];

    let matchCount = 0;
    for (const pattern of vehiclePatterns) {
      if (pattern.test(html)) matchCount++;
    }

    // If we match at least 2 patterns, consider it a vehicle source
    return matchCount >= 2;

  } catch {
    return false;
  }
}

// Validate a single source
async function validateSingleSource(supabase: any, sourceId: string) {
  const { data: source, error: sourceErr } = await supabase
    .from('scrape_sources')
    .select('id, name, url, source_type')
    .eq('id', sourceId)
    .single();

  if (sourceErr || !source) {
    return new Response(
      JSON.stringify({ success: false, error: 'Source not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const result = await testSourceExtraction(supabase, source);

  // Update source with validation result
  await supabase
    .from('scrape_sources')
    .update({
      validation_status: result.is_vehicle_source ? 'vehicle_source' : 'non_vehicle_source',
      validation_error: result.error,
      validated_at: result.validated_at,
      sample_vehicle_id: result.sample_vehicle_id,
    })
    .eq('id', source.id);

  return new Response(
    JSON.stringify({ success: true, result }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Get validation results summary
async function getValidationResults(supabase: any) {
  const { data: sources, error } = await supabase
    .from('scrape_sources')
    .select('id, name, source_type, validation_status, validation_error, validated_at, sample_vehicle_id')
    .eq('is_active', true)
    .order('validation_status', { nullsFirst: true });

  if (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const summary = {
    total: sources.length,
    validated: sources.filter((s: any) => s.validation_status).length,
    unvalidated: sources.filter((s: any) => !s.validation_status).length,
    vehicle_sources: sources.filter((s: any) => s.validation_status === 'vehicle_source').length,
    non_vehicle_sources: sources.filter((s: any) => s.validation_status === 'non_vehicle_source').length,
    by_type: {} as Record<string, { total: number; vehicle: number; non_vehicle: number }>,
  };

  // Group by source_type
  for (const source of sources) {
    if (!summary.by_type[source.source_type]) {
      summary.by_type[source.source_type] = { total: 0, vehicle: 0, non_vehicle: 0 };
    }
    summary.by_type[source.source_type].total++;
    if (source.validation_status === 'vehicle_source') {
      summary.by_type[source.source_type].vehicle++;
    } else if (source.validation_status === 'non_vehicle_source') {
      summary.by_type[source.source_type].non_vehicle++;
    }
  }

  return new Response(
    JSON.stringify({ success: true, summary, sources }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Get list of unvalidated sources
async function getUnvalidatedSources(supabase: any, limit: number) {
  const { data: sources, error } = await supabase
    .from('scrape_sources')
    .select('id, name, url, source_type')
    .is('validation_status', null)
    .eq('is_active', true)
    .order('source_type')
    .limit(limit);

  if (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      count: sources.length,
      sources,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
