/**
 * RALPH WIGGUM EXTRACTION
 *
 * Autonomous extraction loop:
 * 1. Pick a source
 * 2. Extract 1 vehicle
 * 3. Inspect extraction vs original source
 * 4. If good, extract more from same source
 * 5. If great, try more sources
 *
 * Actions:
 * - start: Begin autonomous extraction
 * - extract_one: Extract single vehicle from source
 * - inspect_extraction: Compare extraction to source
 * - get_status: Current extraction status
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractionResult {
  vehicle_id: string | null;
  source_url: string;
  extracted_data: any;
  quality_score: number;
  inspection_notes: string;
  passed: boolean;
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
    const { action = 'get_status', source_id, max_extractions = 5, source_type } = body;

    console.log('='.repeat(60));
    console.log('RALPH WIGGUM EXTRACTION');
    console.log('='.repeat(60));
    console.log(`Action: ${action}`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    switch (action) {
      case 'start':
        return await startAutonomousExtraction(supabase, max_extractions, source_type);

      case 'extract_one':
        if (!source_id) {
          return errorResponse('source_id required');
        }
        return await extractOneVehicle(supabase, source_id);

      case 'inspect_extraction':
        return await inspectRecentExtractions(supabase);

      case 'extract_craigslist':
        return await extractCraigslistSquarebodies(supabase);

      case 'extract_hemmings':
        return await extractHemmingsSquarebodies(supabase);

      case 'get_status':
        return await getExtractionStatus(supabase);

      case 'enrich':
        return await enrichVehicles(supabase, max_extractions);

      case 'run_loop':
        return await runExtractionLoop(supabase, max_extractions);

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

// Start autonomous extraction loop
async function startAutonomousExtraction(supabase: any, maxExtractions: number, sourceType?: string) {
  const results: ExtractionResult[] = [];
  let successCount = 0;
  let failCount = 0;

  // Get high-priority sources that use simple_fetch (easiest to extract)
  let query = supabase
    .from('source_intelligence')
    .select('source_id, extraction_priority, recommended_extraction_method')
    .in('recommended_extraction_method', ['simple_fetch', 'bat_extractor'])
    .order('extraction_priority', { ascending: false })
    .limit(20);

  const { data: intelligenceSources } = await query;

  if (!intelligenceSources?.length) {
    return new Response(
      JSON.stringify({ success: true, message: 'No extractable sources found', results: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get source details
  const sourceIds = intelligenceSources.map((s: any) => s.source_id);
  const { data: sources } = await supabase
    .from('scrape_sources')
    .select('id, name, url, source_type')
    .in('id', sourceIds)
    .eq('is_active', true);

  if (!sources?.length) {
    return new Response(
      JSON.stringify({ success: true, message: 'No active sources', results: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log(`Found ${sources.length} extractable sources`);

  // Extract from each source
  for (const source of sources.slice(0, maxExtractions)) {
    console.log(`\n--- Extracting from: ${source.name} ---`);
    console.log(`URL: ${source.url}`);

    const result = await tryExtractVehicle(supabase, source);
    results.push(result);

    if (result.passed) {
      successCount++;
      console.log(`✅ Success: ${result.extracted_data?.title || 'Vehicle extracted'}`);
      console.log(`   Quality: ${result.quality_score}/100`);
    } else {
      failCount++;
      console.log(`❌ Failed: ${result.inspection_notes}`);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      summary: {
        attempted: results.length,
        successful: successCount,
        failed: failCount,
        success_rate: results.length > 0 ? Math.round((successCount / results.length) * 100) : 0,
      },
      results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Try to extract a vehicle from a source
async function tryExtractVehicle(supabase: any, source: any): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    vehicle_id: null,
    source_url: source.url,
    extracted_data: null,
    quality_score: 0,
    inspection_notes: '',
    passed: false,
  };

  try {
    // Fetch the page
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      result.inspection_notes = `HTTP ${response.status}`;
      return result;
    }

    const html = await response.text();

    // Check if it's a BaT page
    if (source.url.includes('bringatrailer.com')) {
      return await extractFromBaT(supabase, source, html);
    }

    // Try generic extraction with LLM
    return await extractWithLLM(supabase, source, html);

  } catch (err: any) {
    result.inspection_notes = err.message || 'Extraction failed';
    return result;
  }
}

// Extract from BaT (we have good patterns for this)
async function extractFromBaT(supabase: any, source: any, html: string): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    vehicle_id: null,
    source_url: source.url,
    extracted_data: null,
    quality_score: 0,
    inspection_notes: '',
    passed: false,
  };

  // Find listing URLs in the page
  const listingMatches = html.match(/href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"/g);
  if (!listingMatches?.length) {
    result.inspection_notes = 'No listings found on page';
    return result;
  }

  // Get a listing URL we haven't processed
  const listingUrls = listingMatches
    .map(m => m.match(/href="([^"]+)"/)?.[1])
    .filter(Boolean) as string[];

  // Check which we already have
  const { data: existing } = await supabase
    .from('vehicles')
    .select('bat_auction_url')
    .in('bat_auction_url', listingUrls.slice(0, 10));

  const existingUrls = new Set((existing || []).map((e: any) => e.bat_auction_url));
  const newUrl = listingUrls.find(url => !existingUrls.has(url));

  if (!newUrl) {
    result.inspection_notes = 'All listings already extracted';
    result.quality_score = 100; // Not a failure, just complete
    result.passed = true;
    return result;
  }

  // Fetch the listing page
  try {
    const listingResponse = await fetch(newUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' },
    });
    const listingHtml = await listingResponse.text();

    // Extract title
    const titleMatch = listingHtml.match(/<h1[^>]*class="[^"]*listing-title[^"]*"[^>]*>([^<]+)</i) ||
                       listingHtml.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch?.[1]?.replace(' - Bring a Trailer', '').trim() || '';

    // Parse year/make/model from title
    const ymm = parseYearMakeModel(title);

    // Extract more data
    const priceMatch = listingHtml.match(/Sold\s+for\s+\$?([\d,]+)/i) ||
                       listingHtml.match(/Current\s+Bid[:\s]+\$?([\d,]+)/i);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    const vinMatch = listingHtml.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1] || null;

    const mileageMatch = listingHtml.match(/([\d,]+)\s*(?:miles|mi\b)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

    result.extracted_data = {
      title,
      year: ymm.year,
      make: ymm.make,
      model: ymm.model,
      price,
      vin,
      mileage,
      listing_url: newUrl,
    };

    // Calculate quality score
    let score = 0;
    if (ymm.year) score += 20;
    if (ymm.make) score += 20;
    if (ymm.model) score += 20;
    if (price) score += 15;
    if (vin) score += 15;
    if (mileage) score += 10;
    result.quality_score = score;

    // Save if quality is good enough
    if (score >= 40) {
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .insert({
          year: ymm.year,
          make: ymm.make,
          model: ymm.model,
          price,
          vin,
          mileage,
          bat_auction_url: newUrl,
          listing_url: newUrl,
          discovery_url: source.url,
        })
        .select()
        .single();

      if (vehicle) {
        result.vehicle_id = vehicle.id;
        result.passed = true;
        result.inspection_notes = `Extracted: ${title}`;
      } else if (error) {
        result.inspection_notes = `DB error: ${error.message}`;
      }
    } else {
      result.inspection_notes = `Quality too low: ${score}/100`;
    }

  } catch (err: any) {
    result.inspection_notes = `Listing fetch failed: ${err.message}`;
  }

  return result;
}

// Extract with LLM for unknown sources
async function extractWithLLM(supabase: any, source: any, html: string): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    vehicle_id: null,
    source_url: source.url,
    extracted_data: null,
    quality_score: 0,
    inspection_notes: '',
    passed: false,
  };

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    result.inspection_notes = 'No OpenAI key for LLM extraction';
    return result;
  }

  // Clean HTML for LLM
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);

  try {
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
            content: `Extract vehicle data from this page. Return JSON with:
- vehicles: array of {year, make, model, price, vin, mileage, listing_url, title}
- Only include vehicles you're confident about
- year should be a number, price in dollars (number), mileage as number
- If no vehicles found, return {"vehicles": []}`
          },
          {
            role: 'user',
            content: `Source: ${source.name}\nURL: ${source.url}\n\nContent:\n${textContent}`
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
      }),
    });

    const data = await llmResponse.json();
    const extracted = JSON.parse(data.choices[0].message.content);

    if (!extracted.vehicles?.length) {
      result.inspection_notes = 'No vehicles found by LLM';
      return result;
    }

    // Process first vehicle
    const v = extracted.vehicles[0];
    result.extracted_data = v;

    // Calculate quality
    let score = 0;
    if (v.year) score += 20;
    if (v.make) score += 20;
    if (v.model) score += 20;
    if (v.price) score += 15;
    if (v.vin) score += 15;
    if (v.mileage) score += 10;
    result.quality_score = score;

    if (score >= 40) {
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .insert({
          year: v.year,
          make: v.make,
          model: v.model,
          price: v.price,
          vin: v.vin,
          mileage: v.mileage,
          listing_url: v.listing_url || source.url,
          discovery_url: source.url,
        })
        .select()
        .single();

      if (vehicle) {
        result.vehicle_id = vehicle.id;
        result.passed = true;
        result.inspection_notes = `LLM extracted: ${v.year} ${v.make} ${v.model}`;
      } else if (error) {
        result.inspection_notes = `DB error: ${error.message}`;
      }
    } else {
      result.inspection_notes = `LLM quality too low: ${score}/100`;
    }

  } catch (err: any) {
    result.inspection_notes = `LLM extraction failed: ${err.message}`;
  }

  return result;
}

// Extract squarebodies from Craigslist
async function extractCraigslistSquarebodies(supabase: any) {
  const cities = ['losangeles', 'phoenix', 'dallas', 'houston', 'denver', 'sfbay'];
  const queries = [
    { name: 'C10', query: 'c10', min_year: 1973, max_year: 1987 },
    { name: 'K10', query: 'k10', min_year: 1973, max_year: 1987 },
    { name: 'Suburban', query: 'suburban', min_year: 1973, max_year: 1991 },
    { name: 'Squarebody', query: 'squarebody', min_year: 1973, max_year: 1991 },
  ];

  const results: any[] = [];
  let totalFound = 0;
  let totalSaved = 0;

  for (const city of cities.slice(0, 3)) { // Start with 3 cities
    for (const q of queries.slice(0, 2)) { // Start with 2 queries
      const url = `https://${city}.craigslist.org/search/cta?query=${q.query}&min_year=${q.min_year}&max_year=${q.max_year}&purveyor=owner`;
      console.log(`\nSearching: ${city} - ${q.name}`);
      console.log(`URL: ${url}`);

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });

        if (!response.ok) {
          console.log(`  HTTP ${response.status}`);
          continue;
        }

        const html = await response.text();

        // Find listing links
        const listingMatches = html.match(/href="(https:\/\/[^"]+\.craigslist\.org\/[^"]+\/d\/[^"]+\.html)"/g);
        if (!listingMatches?.length) {
          console.log('  No listings found');
          continue;
        }

        const listingUrls = [...new Set(
          listingMatches
            .map(m => m.match(/href="([^"]+)"/)?.[1])
            .filter(Boolean)
        )] as string[];

        console.log(`  Found ${listingUrls.length} listings`);
        totalFound += listingUrls.length;

        // Check which we already have
        const { data: existing } = await supabase
          .from('vehicles')
          .select('listing_url')
          .in('listing_url', listingUrls);

        const existingUrls = new Set((existing || []).map((e: any) => e.listing_url));
        const newUrls = listingUrls.filter(u => !existingUrls.has(u));
        console.log(`  New: ${newUrls.length}`);

        // Extract first 3 new listings
        for (const listingUrl of newUrls.slice(0, 3)) {
          const vehicle = await extractCraigslistListing(supabase, listingUrl, q.name);
          if (vehicle) {
            results.push(vehicle);
            totalSaved++;
            console.log(`  ✅ ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
          }
        }

      } catch (err: any) {
        console.log(`  Error: ${err.message}`);
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      summary: {
        listings_found: totalFound,
        vehicles_saved: totalSaved,
      },
      vehicles: results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Extract a single Craigslist listing
async function extractCraigslistListing(supabase: any, url: string, searchType: string): Promise<any | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<span[^>]*id="titletextonly"[^>]*>([^<]+)</i) ||
                       html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch?.[1]?.trim() || '';

    // Parse year/make/model
    const ymm = parseYearMakeModel(title);

    // Extract price
    const priceMatch = html.match(/\$\s*([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // Extract location
    const locationMatch = html.match(/<small>\s*\(([^)]+)\)/);
    const location = locationMatch?.[1]?.trim() || null;

    // Get posting body for mileage
    const bodyMatch = html.match(/<section[^>]*id="postingbody"[^>]*>([\s\S]*?)<\/section>/i);
    const body = bodyMatch?.[1]?.replace(/<[^>]+>/g, ' ') || '';

    const mileageMatch = body.match(/([\d,]+)\s*(?:miles|mi\b|k\s*miles)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

    // VIN
    const vinMatch = body.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) ||
                     html.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1] || null;

    if (!ymm.year || !ymm.make) {
      return null;
    }

    // Save to database
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: ymm.year,
        make: ymm.make,
        model: ymm.model || searchType,
        price,
        vin,
        mileage,
        listing_url: url,
        discovery_url: url,
        location,
        seller_type: 'private',
      })
      .select()
      .single();

    if (error) {
      console.log(`    DB error: ${error.message}`);
      return null;
    }

    return vehicle;

  } catch (err) {
    return null;
  }
}

// Parse year/make/model from title
function parseYearMakeModel(title: string): { year: number | null; make: string | null; model: string | null } {
  const result = { year: null as number | null, make: null as string | null, model: null as string | null };

  // Find year
  const yearMatch = title.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1]);
  }

  // Common makes
  const makes = [
    'Chevrolet', 'Chevy', 'GMC', 'Ford', 'Dodge', 'Toyota', 'Honda', 'BMW', 'Mercedes',
    'Porsche', 'Ferrari', 'Lamborghini', 'Jeep', 'Plymouth', 'Pontiac', 'Buick', 'Oldsmobile',
    'Cadillac', 'Lincoln', 'Mercury', 'Chrysler', 'AMC', 'International', 'Citroen'
  ];

  for (const make of makes) {
    if (title.toLowerCase().includes(make.toLowerCase())) {
      result.make = make === 'Chevy' ? 'Chevrolet' : make;
      break;
    }
  }

  // Extract model (everything after make, before common suffixes)
  if (result.make) {
    const afterMake = title.split(new RegExp(result.make, 'i'))[1];
    if (afterMake) {
      const model = afterMake
        .replace(/^\s*[-:]\s*/, '')
        .replace(/\s+(for sale|auction|bid|sold|listing).*$/i, '')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(' ');
      result.model = model || null;
    }
  }

  return result;
}

// Inspect recent extractions
async function inspectRecentExtractions(supabase: any) {
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, price, vin, mileage, listing_url, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const inspections = [];

  for (const v of vehicles || []) {
    let score = 0;
    const issues = [];

    if (v.year) score += 20; else issues.push('missing year');
    if (v.make) score += 20; else issues.push('missing make');
    if (v.model) score += 20; else issues.push('missing model');
    if (v.price) score += 15; else issues.push('no price');
    if (v.vin) score += 15; else issues.push('no VIN');
    if (v.mileage) score += 10; else issues.push('no mileage');

    inspections.push({
      vehicle_id: v.id,
      title: `${v.year || '?'} ${v.make || '?'} ${v.model || '?'}`,
      quality_score: score,
      issues,
      listing_url: v.listing_url,
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      inspections,
      summary: {
        total: inspections.length,
        avg_score: Math.round(inspections.reduce((a, i) => a + i.quality_score, 0) / inspections.length),
        high_quality: inspections.filter(i => i.quality_score >= 70).length,
        needs_enrichment: inspections.filter(i => i.quality_score < 50).length,
      },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Extract squarebodies from Hemmings
async function extractHemmingsSquarebodies(supabase: any) {
  const urls = [
    { name: 'C10', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/c10' },
    { name: 'K10', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/k10' },
    { name: 'C20', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/c20' },
    { name: 'Suburban', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/suburban' },
    { name: 'GMC Jimmy', url: 'https://www.hemmings.com/classifieds/cars-for-sale/gmc/jimmy' },
    { name: 'GMC C1500', url: 'https://www.hemmings.com/classifieds/cars-for-sale/gmc/c1500' },
  ];

  const results: any[] = [];
  let totalFound = 0;
  let totalSaved = 0;

  for (const { name, url } of urls) {
    console.log(`\n--- Hemmings: ${name} ---`);
    console.log(`URL: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
      });

      if (!response.ok) {
        console.log(`  HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();

      // Find listing cards - Hemmings uses listing-card class
      const listingMatches = html.match(/<a[^>]+href="(\/classifieds\/cars-for-sale\/[^"]+)"[^>]*class="[^"]*listing[^"]*"/gi) ||
                             html.match(/href="(https:\/\/www\.hemmings\.com\/classifieds\/cars-for-sale\/[^"]+\d+)"/gi);

      if (!listingMatches?.length) {
        console.log('  No listings found');
        // Try alternate pattern
        const altMatches = html.match(/\/classifieds\/cars-for-sale\/[^"]+\/\d+/g);
        if (altMatches?.length) {
          console.log(`  Found ${altMatches.length} via alternate pattern`);
        }
        continue;
      }

      const listingUrls = [...new Set(
        listingMatches
          .map(m => {
            const match = m.match(/href="([^"]+)"/);
            if (match) {
              return match[1].startsWith('http') ? match[1] : `https://www.hemmings.com${match[1]}`;
            }
            return null;
          })
          .filter(Boolean)
      )] as string[];

      console.log(`  Found ${listingUrls.length} listings`);
      totalFound += listingUrls.length;

      // Check which we already have
      const { data: existing } = await supabase
        .from('vehicles')
        .select('listing_url')
        .in('listing_url', listingUrls);

      const existingUrls = new Set((existing || []).map((e: any) => e.listing_url));
      const newUrls = listingUrls.filter(u => !existingUrls.has(u));
      console.log(`  New: ${newUrls.length}`);

      // Extract up to 5 new listings per category
      for (const listingUrl of newUrls.slice(0, 5)) {
        const vehicle = await extractHemmingsListing(supabase, listingUrl);
        if (vehicle) {
          results.push(vehicle);
          totalSaved++;
          console.log(`  ✅ ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        }
      }

    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      summary: {
        listings_found: totalFound,
        vehicles_saved: totalSaved,
      },
      vehicles: results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Extract a single Hemmings listing
async function extractHemmingsListing(supabase: any, url: string): Promise<any | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                       html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch?.[1]?.replace(/\s*[-|].*$/, '').trim() || '';

    // Parse year/make/model
    const ymm = parseYearMakeModel(title);

    // Extract price
    const priceMatch = html.match(/\$\s*([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // Extract mileage
    const mileageMatch = html.match(/([\d,]+)\s*(?:miles|mi\b)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

    // Extract VIN
    const vinMatch = html.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1] || null;

    // Extract location
    const locationMatch = html.match(/Location[:\s]*([^<\n]+)/i);
    const location = locationMatch?.[1]?.trim() || null;

    if (!ymm.year || !ymm.make) {
      return null;
    }

    // Filter for squarebody years (1973-1991)
    if (ymm.year < 1973 || ymm.year > 1991) {
      return null;
    }

    // Save to database
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: ymm.year,
        make: ymm.make,
        model: ymm.model,
        price,
        vin,
        mileage,
        listing_url: url,
        discovery_url: url,
        location,
        seller_type: 'dealer',
      })
      .select()
      .single();

    if (error) {
      console.log(`    DB error: ${error.message}`);
      return null;
    }

    return vehicle;

  } catch (err) {
    return null;
  }
}

// Get extraction status
async function getExtractionStatus(supabase: any) {
  const { count: totalVehicles } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true });

  const { count: todayVehicles } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const { count: sourcesCount } = await supabase
    .from('scrape_sources')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  const { data: recentVehicles } = await supabase
    .from('vehicles')
    .select('year, make, model, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  return new Response(
    JSON.stringify({
      success: true,
      status: {
        total_vehicles: totalVehicles || 0,
        vehicles_last_24h: todayVehicles || 0,
        active_sources: sourcesCount || 0,
        recent_extractions: recentVehicles || [],
      },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Enrich vehicles by fetching their listing pages
async function enrichVehicles(supabase: any, maxVehicles: number) {
  // Find vehicles missing key data
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, price, vin, mileage, listing_url, bat_auction_url')
    .or('price.is.null,vin.is.null,mileage.is.null')
    .not('listing_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(maxVehicles);

  if (!vehicles?.length) {
    return new Response(
      JSON.stringify({ success: true, message: 'No vehicles need enrichment', enriched: 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log(`Found ${vehicles.length} vehicles to enrich`);
  const results: any[] = [];

  for (const v of vehicles) {
    const url = v.bat_auction_url || v.listing_url;
    if (!url) continue;

    console.log(`\nEnriching: ${v.year} ${v.make} ${v.model}`);
    console.log(`URL: ${url}`);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' },
      });

      if (!response.ok) {
        console.log(`  HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      const updates: any = {};

      // Extract price if missing
      if (!v.price) {
        const priceMatch = html.match(/Sold\s+for\s+\$?([\d,]+)/i) ||
                          html.match(/Current\s+Bid[:\s]+\$?([\d,]+)/i) ||
                          html.match(/Price[:\s]+\$?([\d,]+)/i) ||
                          html.match(/\$\s*([\d,]+)/);
        if (priceMatch) {
          updates.price = parseInt(priceMatch[1].replace(/,/g, ''));
        }
      }

      // Extract VIN if missing
      if (!v.vin) {
        const vinMatch = html.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
        if (vinMatch) {
          updates.vin = vinMatch[1];
        }
      }

      // Extract mileage if missing
      if (!v.mileage) {
        const mileageMatch = html.match(/([\d,]+)\s*(?:miles|mi\b)/i);
        if (mileageMatch) {
          const miles = parseInt(mileageMatch[1].replace(/,/g, ''));
          if (miles < 1000000) { // Sanity check
            updates.mileage = miles;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', v.id);

        if (!error) {
          console.log(`  ✅ Updated: ${JSON.stringify(updates)}`);
          results.push({ vehicle_id: v.id, updates });
        } else {
          console.log(`  ❌ Update failed: ${error.message}`);
        }
      } else {
        console.log(`  No new data found`);
      }

    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      enriched: results.length,
      attempted: vehicles.length,
      results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Run extraction loop - extract and enrich continuously
async function runExtractionLoop(supabase: any, rounds: number) {
  const summary = {
    rounds_completed: 0,
    vehicles_extracted: 0,
    vehicles_enriched: 0,
    errors: [] as string[],
  };

  for (let i = 0; i < rounds; i++) {
    console.log(`\n${'='.repeat(40)}`);
    console.log(`ROUND ${i + 1}/${rounds}`);
    console.log(`${'='.repeat(40)}`);

    // Extract from BaT sources
    try {
      const extractResult = await startAutonomousExtraction(supabase, 3, undefined);
      const extractData = await extractResult.json();
      summary.vehicles_extracted += extractData.summary?.successful || 0;
    } catch (err: any) {
      summary.errors.push(`Extract: ${err.message}`);
    }

    // Enrich existing vehicles
    try {
      const enrichResult = await enrichVehicles(supabase, 5);
      const enrichData = await enrichResult.json();
      summary.vehicles_enriched += enrichData.enriched || 0;
    } catch (err: any) {
      summary.errors.push(`Enrich: ${err.message}`);
    }

    summary.rounds_completed++;

    // Small delay between rounds
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Get final status
  const { count: totalVehicles } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true });

  return new Response(
    JSON.stringify({
      success: true,
      summary,
      final_vehicle_count: totalVehicles,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
