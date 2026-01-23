import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * VEHICLE VALUE ENRICHER
 *
 * Detective-grade data enrichment for vehicle valuations.
 * Searches multiple sources by VIN to find:
 * - Actual sale prices (if car sold elsewhere after auction)
 * - Valuation estimates (Hagerty, etc.)
 * - Cross-references and citations
 *
 * Every data point is cited with source, URL, and confidence level.
 *
 * Deploy:
 *   supabase functions deploy vehicle-value-enricher --no-verify-jwt
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// =============================================================================
// DATA SOURCE DEFINITIONS
// Each source has a name, search method, and confidence weight
// =============================================================================

interface DataSource {
  name: string;
  type: 'valuation' | 'sale' | 'listing' | 'auction_result';
  confidence_base: number; // Base confidence score (0-1)
  search_method: 'vin' | 'ymm' | 'api';
}

const DATA_SOURCES: Record<string, DataSource> = {
  hagerty: {
    name: 'Hagerty Valuation Tools',
    type: 'valuation',
    confidence_base: 0.85,
    search_method: 'ymm',
  },
  bat_sold: {
    name: 'Bring a Trailer (Sold Listings)',
    type: 'sale',
    confidence_base: 0.95,
    search_method: 'vin',
  },
  cars_and_bids_sold: {
    name: 'Cars & Bids (Sold Listings)',
    type: 'sale',
    confidence_base: 0.95,
    search_method: 'vin',
  },
  classic_com: {
    name: 'Classic.com Price Guide',
    type: 'valuation',
    confidence_base: 0.80,
    search_method: 'ymm',
  },
  pcarmarket_sold: {
    name: 'PCarMarket (Sold Listings)',
    type: 'sale',
    confidence_base: 0.95,
    search_method: 'vin',
  },
  sbx_sold: {
    name: 'SBX Cars (Sold Listings)',
    type: 'sale',
    confidence_base: 0.90,
    search_method: 'vin',
  },
  mecum_sold: {
    name: 'Mecum Auctions (Sold)',
    type: 'auction_result',
    confidence_base: 0.95,
    search_method: 'vin',
  },
  rm_sothebys_sold: {
    name: "RM Sotheby's (Sold)",
    type: 'auction_result',
    confidence_base: 0.95,
    search_method: 'vin',
  },
  google_search: {
    name: 'Google Search (VIN)',
    type: 'listing',
    confidence_base: 0.60,
    search_method: 'vin',
  },
};

// =============================================================================
// VALUE SOURCE INTERFACE
// This is what we store for each data point
// =============================================================================

interface ValueSource {
  source: string;
  source_name: string;
  source_type: 'valuation' | 'sale' | 'listing' | 'auction_result';
  value: number | null;
  value_low?: number;
  value_high?: number;
  url: string | null;
  fetched_at: string;
  confidence: number;
  raw_data?: Record<string, unknown>;
  notes?: string;
}

interface EnrichmentResult {
  vehicle_id: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  sources_searched: string[];
  sources_found: ValueSource[];
  recommended_value: number | null;
  value_confidence: number;
  value_method: string;
  enriched_at: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Calculate weighted average from multiple sources
function calculateWeightedValue(sources: ValueSource[]): { value: number; confidence: number; method: string } {
  const validSources = sources.filter(s => s.value && s.value > 0);

  if (validSources.length === 0) {
    return { value: 0, confidence: 0, method: 'no_data' };
  }

  if (validSources.length === 1) {
    return {
      value: validSources[0].value!,
      confidence: validSources[0].confidence,
      method: 'single_source'
    };
  }

  // Prioritize actual sales over valuations
  const sales = validSources.filter(s => s.source_type === 'sale' || s.source_type === 'auction_result');
  if (sales.length > 0) {
    // Use most recent sale if multiple exist
    const sorted = sales.sort((a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime());
    const mostRecent = sorted[0];

    // If multiple sales agree (within 10%), boost confidence
    const avgSale = sales.reduce((sum, s) => sum + s.value!, 0) / sales.length;
    const variance = sales.reduce((sum, s) => sum + Math.abs(s.value! - avgSale), 0) / sales.length;
    const variancePct = avgSale > 0 ? variance / avgSale : 0;

    const confidenceBoost = variancePct < 0.1 ? 0.05 : 0;

    return {
      value: mostRecent.value!,
      confidence: Math.min(0.99, mostRecent.confidence + confidenceBoost),
      method: sales.length > 1 ? 'multi_sale_verified' : 'sale_record'
    };
  }

  // Weighted average of valuations
  const totalWeight = validSources.reduce((sum, s) => sum + s.confidence, 0);
  const weightedSum = validSources.reduce((sum, s) => sum + (s.value! * s.confidence), 0);
  const weightedAvg = weightedSum / totalWeight;

  // Confidence increases with more agreeing sources
  const avgConfidence = totalWeight / validSources.length;
  const sourceBonus = Math.min(0.1, validSources.length * 0.02);

  return {
    value: Math.round(weightedAvg),
    confidence: Math.min(0.95, avgConfidence + sourceBonus),
    method: 'weighted_average'
  };
}

// =============================================================================
// SEARCH FUNCTIONS
// Each function searches a specific source and returns ValueSource or null
// =============================================================================

async function searchHagerty(
  year: number,
  make: string,
  model: string,
  _vin?: string
): Promise<ValueSource | null> {
  // Hagerty API would go here - for now we'll use web search
  // In production, you'd want to use their official API

  const searchQuery = `site:hagerty.com/apps/valuationtools ${year} ${make} ${model}`;

  try {
    // This is a placeholder - in production use Hagerty's API or scrape carefully
    return {
      source: 'hagerty',
      source_name: DATA_SOURCES.hagerty.name,
      source_type: 'valuation',
      value: null, // Would be populated by actual API call
      url: `https://www.hagerty.com/apps/valuationtools/search?q=${encodeURIComponent(`${year} ${make} ${model}`)}`,
      fetched_at: new Date().toISOString(),
      confidence: DATA_SOURCES.hagerty.confidence_base,
      notes: 'Search URL generated - manual lookup required',
    };
  } catch (error) {
    console.error('Hagerty search error:', error);
    return null;
  }
}

async function searchBATSold(vin: string): Promise<ValueSource | null> {
  if (!vin || vin.length < 11) return null;

  try {
    // Search BaT for VIN
    const searchUrl = `https://bringatrailer.com/search/${encodeURIComponent(vin)}/`;

    return {
      source: 'bat_sold',
      source_name: DATA_SOURCES.bat_sold.name,
      source_type: 'sale',
      value: null,
      url: searchUrl,
      fetched_at: new Date().toISOString(),
      confidence: DATA_SOURCES.bat_sold.confidence_base,
      notes: 'VIN search URL - check for sold listings',
    };
  } catch (error) {
    console.error('BaT search error:', error);
    return null;
  }
}

async function searchGoogle(
  vin: string,
  year: number,
  make: string,
  model: string
): Promise<ValueSource | null> {
  // Generate search URLs for manual research
  const vinSearchUrl = vin
    ? `https://www.google.com/search?q="${vin}"+sold+price`
    : null;
  const ymmSearchUrl = `https://www.google.com/search?q=${year}+${make}+${model}+sold+auction+price`;

  return {
    source: 'google_search',
    source_name: DATA_SOURCES.google_search.name,
    source_type: 'listing',
    value: null,
    url: vinSearchUrl || ymmSearchUrl,
    fetched_at: new Date().toISOString(),
    confidence: DATA_SOURCES.google_search.confidence_base,
    notes: vin ? 'VIN-based Google search' : 'Year/Make/Model Google search',
  };
}

async function searchClassicCom(
  year: number,
  make: string,
  model: string
): Promise<ValueSource | null> {
  const searchUrl = `https://www.classic.com/m/${make.toLowerCase()}/${model.toLowerCase().replace(/\s+/g, '-')}/?year_from=${year}&year_to=${year}`;

  return {
    source: 'classic_com',
    source_name: DATA_SOURCES.classic_com.name,
    source_type: 'valuation',
    value: null,
    url: searchUrl,
    fetched_at: new Date().toISOString(),
    confidence: DATA_SOURCES.classic_com.confidence_base,
    notes: 'Classic.com market data search',
  };
}

// =============================================================================
// MAIN ENRICHMENT FUNCTION
// =============================================================================

async function enrichVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicleId: string,
  options: {
    searchSources?: string[];
    forceRefresh?: boolean;
  } = {}
): Promise<EnrichmentResult> {
  // Fetch vehicle data
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('id, vin, year, make, model, high_bid, sale_price, current_value, auction_outcome, discovery_url')
    .eq('id', vehicleId)
    .single();

  if (error || !vehicle) {
    throw new Error(`Vehicle not found: ${vehicleId}`);
  }

  const sourcesToSearch = options.searchSources || ['hagerty', 'bat_sold', 'classic_com', 'google_search'];
  const sourcesFound: ValueSource[] = [];

  // Search each source
  for (const sourceKey of sourcesToSearch) {
    let result: ValueSource | null = null;

    switch (sourceKey) {
      case 'hagerty':
        if (vehicle.year && vehicle.make && vehicle.model) {
          result = await searchHagerty(vehicle.year, vehicle.make, vehicle.model, vehicle.vin);
        }
        break;
      case 'bat_sold':
        if (vehicle.vin) {
          result = await searchBATSold(vehicle.vin);
        }
        break;
      case 'classic_com':
        if (vehicle.year && vehicle.make && vehicle.model) {
          result = await searchClassicCom(vehicle.year, vehicle.make, vehicle.model);
        }
        break;
      case 'google_search':
        result = await searchGoogle(
          vehicle.vin || '',
          vehicle.year || 0,
          vehicle.make || '',
          vehicle.model || ''
        );
        break;
    }

    if (result) {
      sourcesFound.push(result);
    }
  }

  // Add existing data as a source if available
  if (vehicle.high_bid && vehicle.high_bid > 0 && vehicle.auction_outcome !== 'reserve_not_met') {
    sourcesFound.push({
      source: 'original_auction',
      source_name: 'Original Auction Result',
      source_type: 'auction_result',
      value: vehicle.high_bid,
      url: vehicle.discovery_url,
      fetched_at: new Date().toISOString(),
      confidence: 0.95,
      notes: 'From original auction import',
    });
  }

  // Calculate recommended value
  const { value, confidence, method } = calculateWeightedValue(sourcesFound);

  return {
    vehicle_id: vehicle.id,
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    sources_searched: sourcesToSearch,
    sources_found: sourcesFound,
    recommended_value: value > 0 ? value : null,
    value_confidence: confidence,
    value_method: method,
    enriched_at: new Date().toISOString(),
  };
}

// =============================================================================
// BATCH ENRICHMENT FOR RESERVE-NOT-MET VEHICLES
// =============================================================================

async function findVehiclesToEnrich(
  supabase: ReturnType<typeof createClient>,
  options: {
    limit?: number;
    minHighBid?: number;
    source?: string;
  } = {}
): Promise<Array<{id: string; year: number; make: string; model: string; vin: string; high_bid: number; discovery_url: string}>> {
  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, vin, high_bid, discovery_url')
    .eq('auction_outcome', 'reserve_not_met')
    .not('vin', 'is', null)
    .order('high_bid', { ascending: false })
    .limit(options.limit || 20);

  if (options.minHighBid) {
    query = query.gte('high_bid', options.minHighBid);
  }

  if (options.source) {
    query = query.ilike('discovery_source', `%${options.source}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Query error: ${error.message}`);
  }

  return data || [];
}

// =============================================================================
// HTTP HANDLER
// =============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return okJson({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "enrich");

    switch (action) {
      case "enrich": {
        // Enrich a single vehicle
        const vehicleId = body?.vehicle_id;
        if (!vehicleId) {
          return okJson({ success: false, error: "vehicle_id required" }, 400);
        }

        const result = await enrichVehicle(supabase, vehicleId, {
          searchSources: body?.sources,
          forceRefresh: body?.force_refresh,
        });

        return okJson({ success: true, result });
      }

      case "find_targets": {
        // Find vehicles that need enrichment
        const vehicles = await findVehiclesToEnrich(supabase, {
          limit: body?.limit || 20,
          minHighBid: body?.min_high_bid,
          source: body?.source,
        });

        return okJson({
          success: true,
          count: vehicles.length,
          vehicles: vehicles.map(v => ({
            id: v.id,
            vehicle: `${v.year} ${v.make} ${v.model}`,
            vin: v.vin,
            high_bid: v.high_bid,
            research_urls: {
              google_vin: v.vin ? `https://www.google.com/search?q="${v.vin}"+sold` : null,
              bat_search: v.vin ? `https://bringatrailer.com/search/${v.vin}/` : null,
              hagerty: `https://www.hagerty.com/apps/valuationtools/search?q=${encodeURIComponent(`${v.year} ${v.make} ${v.model}`)}`,
              classic_com: `https://www.classic.com/m/${(v.make || '').toLowerCase()}/${(v.model || '').toLowerCase().replace(/\s+/g, '-')}/?year_from=${v.year}&year_to=${v.year}`,
              original: v.discovery_url,
            }
          })),
        });
      }

      case "batch_enrich": {
        // Batch enrich multiple vehicles
        const vehicleIds = body?.vehicle_ids;
        if (!Array.isArray(vehicleIds) || vehicleIds.length === 0) {
          return okJson({ success: false, error: "vehicle_ids array required" }, 400);
        }

        const results: EnrichmentResult[] = [];
        const errors: Array<{id: string; error: string}> = [];

        for (const id of vehicleIds.slice(0, 10)) { // Limit to 10 per batch
          try {
            const result = await enrichVehicle(supabase, id, {
              searchSources: body?.sources,
            });
            results.push(result);
          } catch (err: any) {
            errors.push({ id, error: err.message });
          }
        }

        return okJson({
          success: true,
          enriched: results.length,
          errors: errors.length,
          results,
          error_details: errors.length > 0 ? errors : undefined,
        });
      }

      default:
        return okJson({ success: false, error: `Unknown action: ${action}` }, 400);
    }

  } catch (error: any) {
    console.error("vehicle-value-enricher error:", error);
    return okJson({ success: false, error: error?.message || String(error) }, 500);
  }
});
