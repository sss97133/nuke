import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EnrichRequest {
  business_id?: string;
  batch?: boolean;
  limit?: number;
  skip_ai?: boolean;
}

/**
 * Enrich Collection Intelligence
 *
 * Computes franchise-style business intelligence for collection-type businesses:
 * - Capacity estimation & utilization
 * - Demographic context (from geo_demographics)
 * - Nearby market analysis (vehicles, competitors in radius)
 * - Make/era/value distribution
 * - Demand scoring (0-100)
 * - AI opportunity writeup
 *
 * Usage:
 *   POST { "business_id": "uuid" }              — enrich one
 *   POST { "batch": true, "limit": 20 }         — enrich next 20 stale
 *   POST { "batch": true, "skip_ai": true }      — skip AI writeup
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    "";
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const {
      business_id,
      batch = false,
      limit = 20,
      skip_ai = false,
    }: EnrichRequest = await req.json().catch(() => ({}));

    let collections: { id: string; business_name: string; latitude: number; longitude: number; city: string; country: string; total_inventory: number }[] = [];

    if (business_id) {
      const { data, error } = await supabase
        .from("businesses")
        .select("id, business_name, latitude, longitude, city, country, total_inventory")
        .eq("id", business_id)
        .eq("business_type", "collection")
        .single();

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "Collection not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      collections = [data];
    } else if (batch) {
      // Find collections needing enrichment (no intelligence or stale > 7 days)
      const { data: allCols } = await supabase
        .from("businesses")
        .select("id, business_name, latitude, longitude, city, country, total_inventory")
        .eq("business_type", "collection")
        .not("latitude", "is", null);

      const { data: enriched } = await supabase
        .from("collection_intelligence")
        .select("business_id, calculated_at")
        .gte("calculated_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      const recentIds = new Set((enriched || []).map((e: any) => e.business_id));
      collections = (allCols || []).filter((c: any) => !recentIds.has(c.id)).slice(0, limit);
    } else {
      return new Response(
        JSON.stringify({ error: "Specify business_id or batch: true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`\n📊 ENRICH COLLECTION INTELLIGENCE`);
    console.log(`Collections to process: ${collections.length}\n`);

    const results: { business_id: string; name: string; demand_score: number; status: string }[] = [];

    for (const col of collections) {
      try {
        console.log(`\n🏛️ ${col.business_name}`);
        const intel = await computeIntelligence(supabase, col, skip_ai);

        // Upsert into collection_intelligence
        const { error: upsertError } = await supabase
          .from("collection_intelligence")
          .upsert(
            {
              business_id: col.id,
              ...intel,
              calculated_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "business_id" },
          );

        if (upsertError) {
          console.error(`   Upsert error: ${upsertError.message}`);
          results.push({ business_id: col.id, name: col.business_name, demand_score: 0, status: `error: ${upsertError.message}` });
        } else {
          results.push({ business_id: col.id, name: col.business_name, demand_score: intel.demand_score || 0, status: "enriched" });
        }
      } catch (err: any) {
        console.error(`   Error: ${err.message}`);
        results.push({ business_id: col.id, name: col.business_name, demand_score: 0, status: `error: ${err.message}` });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        collections_enriched: results.filter((r) => r.status === "enriched").length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("enrich-collection-intelligence error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ---- Intelligence computation ----

async function computeIntelligence(
  supabase: any,
  col: { id: string; business_name: string; latitude: number; longitude: number; city: string; country: string; total_inventory: number },
  skipAi: boolean,
) {
  const lat = Number(col.latitude);
  const lng = Number(col.longitude);

  // 1. Current inventory count
  const { count: currentInventory } = await supabase
    .from("business_vehicle_fleet")
    .select("*", { count: "exact", head: true })
    .eq("business_id", col.id)
    .eq("status", "active");

  const invCount = currentInventory || col.total_inventory || 0;

  // 2. Demographic lookup (find nearest ZIP)
  const demo = await findNearestDemographics(supabase, lat, lng);

  // 3. Capacity estimation
  const capacity = estimateCapacity(demo, col.country);
  const capacityUtilization = capacity > 0 ? Math.min(100, (invCount / capacity) * 100) : null;

  // 4. Nearby market analysis
  const market = await analyzeNearbyMarket(supabase, lat, lng, col.id);

  // 5. Vehicle distribution
  const distributions = await computeDistributions(supabase, col.id);

  // 6. Demand scoring
  const demandScore = computeDemandScore(demo, market, invCount);
  const demandSignals = {
    population_weight: demo.population ? Math.min(30, (demo.population / 500000) * 30) : 0,
    income_weight: demo.medianIncome ? Math.min(20, (demo.medianIncome / 100000) * 20) : 0,
    vehicle_density: market.vehicles25mi > 0 ? Math.min(20, (market.vehicles25mi / 100) * 20) : 0,
    competition_inverse: Math.max(0, 15 - (market.competingCollections + market.competingDealers) * 2),
    inventory_signal: invCount > 0 ? 15 : 0,
  };

  // 7. AI opportunity summary
  let opportunitySummary: string | null = null;
  let opportunityScore: number | null = null;

  if (!skipAi) {
    const aiResult = await generateOpportunityWriteup(
      col,
      invCount,
      capacity,
      demo,
      market,
      distributions,
      demandScore,
    );
    opportunitySummary = aiResult.summary;
    opportunityScore = aiResult.score;
  }

  return {
    estimated_capacity: capacity,
    current_inventory: invCount,
    capacity_utilization: capacityUtilization ? Number(capacityUtilization.toFixed(2)) : null,
    capacity_method: demo.population ? "metro_population_bracket" : "default",
    metro_area: demo.metroArea,
    metro_population: demo.population,
    zip_median_income: demo.medianIncome,
    zip_population: demo.zipPopulation,
    demand_score: Number(demandScore.toFixed(2)),
    demand_signals: demandSignals,
    vehicles_within_25mi: market.vehicles25mi,
    vehicles_within_50mi: market.vehicles50mi,
    avg_vehicle_value_25mi: market.avgValue25mi,
    competing_collections_25mi: market.competingCollections,
    competing_dealers_25mi: market.competingDealers,
    make_distribution: distributions.makes,
    era_distribution: distributions.eras,
    value_distribution: distributions.values,
    opportunity_summary: opportunitySummary,
    opportunity_score: opportunityScore,
  };
}

// ---- Demographic lookup ----

async function findNearestDemographics(supabase: any, lat: number, lng: number) {
  // Find the nearest ZIP code using lat/lng distance
  // Approximation: 1 degree lat ≈ 69 miles, 1 degree lng ≈ 69 * cos(lat) miles
  const { data } = await supabase
    .from("geo_demographics")
    .select("*")
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .gte("latitude", lat - 0.5)
    .lte("latitude", lat + 0.5)
    .gte("longitude", lng - 0.5)
    .lte("longitude", lng + 0.5)
    .limit(5);

  if (!data || data.length === 0) {
    return { metroArea: null, population: null, medianIncome: null, zipPopulation: null };
  }

  // Pick the closest one
  let closest = data[0];
  let minDist = Infinity;
  for (const row of data) {
    const dist = Math.sqrt(Math.pow(row.latitude - lat, 2) + Math.pow(row.longitude - lng, 2));
    if (dist < minDist) {
      minDist = dist;
      closest = row;
    }
  }

  return {
    metroArea: closest.metro_area || null,
    population: closest.population || null,
    medianIncome: closest.median_household_income || null,
    zipPopulation: closest.population || null,
  };
}

// ---- Capacity estimation ----

function estimateCapacity(
  demo: { population: number | null; medianIncome: number | null },
  country: string,
): number {
  // Base capacity by population bracket
  const pop = demo.population || 0;
  let base: number;

  if (pop > 1000000) base = 150; // Major metro
  else if (pop > 500000) base = 100; // Large city
  else if (pop > 100000) base = 60; // Suburban
  else if (pop > 0) base = 30; // Rural
  else base = 50; // Unknown, assume moderate

  // Income multiplier (wealthy areas can support larger collections)
  const income = demo.medianIncome || 60000;
  const incomeMultiplier = Math.max(0.5, Math.min(2.0, income / 75000));

  // International discount (less data for non-US)
  const intlFactor = country === "USA" || country === "US" ? 1.0 : 0.8;

  return Math.round(base * incomeMultiplier * intlFactor);
}

// ---- Nearby market analysis ----

async function analyzeNearbyMarket(supabase: any, lat: number, lng: number, excludeId: string) {
  // 25mi ≈ 0.36 degrees latitude
  const radius25 = 0.36;
  const radius50 = 0.72;

  // Count vehicles within 25mi via nearby businesses' fleet
  const { data: nearbyBizIds } = await supabase
    .from("businesses")
    .select("id")
    .gte("latitude", lat - radius25)
    .lte("latitude", lat + radius25)
    .gte("longitude", lng - radius25)
    .lte("longitude", lng + radius25);

  let vehicles25 = 0;
  if (nearbyBizIds?.length) {
    const ids = nearbyBizIds.map((b: any) => b.id);
    const { count } = await supabase
      .from("business_vehicle_fleet")
      .select("*", { count: "exact", head: true })
      .in("business_id", ids);
    vehicles25 = count || 0;
  }

  // Count competing collections within 25mi
  const { data: nearbyCollections } = await supabase
    .from("businesses")
    .select("id")
    .eq("business_type", "collection")
    .neq("id", excludeId)
    .gte("latitude", lat - radius25)
    .lte("latitude", lat + radius25)
    .gte("longitude", lng - radius25)
    .lte("longitude", lng + radius25);

  // Count competing dealers within 25mi
  const { data: nearbyDealers } = await supabase
    .from("businesses")
    .select("id")
    .in("business_type", ["dealership", "dealer"])
    .gte("latitude", lat - radius25)
    .lte("latitude", lat + radius25)
    .gte("longitude", lng - radius25)
    .lte("longitude", lng + radius25);

  return {
    vehicles25mi: vehicles25 || 0,
    vehicles50mi: 0, // Simplified — full geo query would be expensive
    avgValue25mi: null,
    competingCollections: nearbyCollections?.length || 0,
    competingDealers: nearbyDealers?.length || 0,
  };
}

// ---- Vehicle distributions ----

async function computeDistributions(supabase: any, businessId: string) {
  const { data: fleetVehicles } = await supabase
    .from("business_vehicle_fleet")
    .select("vehicle_id, vehicles(year, make, model, sale_price)")
    .eq("business_id", businessId)
    .eq("status", "active")
    .limit(500);

  const makes: Record<string, number> = {};
  const eras: Record<string, number> = {};
  const values: Record<string, number> = {};

  for (const fv of fleetVehicles || []) {
    const v = fv.vehicles as any;
    if (!v) continue;

    // Make distribution
    if (v.make) {
      makes[v.make] = (makes[v.make] || 0) + 1;
    }

    // Era distribution
    if (v.year) {
      const era = getEra(v.year);
      eras[era] = (eras[era] || 0) + 1;
    }

    // Value distribution
    if (v.sale_price) {
      const bracket = getValueBracket(v.sale_price);
      values[bracket] = (values[bracket] || 0) + 1;
    }
  }

  return { makes, eras, values };
}

function getEra(year: number): string {
  if (year < 1950) return "Pre-War & Early";
  if (year < 1960) return "1950s";
  if (year < 1970) return "1960s";
  if (year < 1980) return "1970s";
  if (year < 1990) return "1980s";
  if (year < 2000) return "1990s";
  if (year < 2010) return "2000s";
  return "2010s+";
}

function getValueBracket(price: number): string {
  if (price < 25000) return "Under $25k";
  if (price < 50000) return "$25k-$50k";
  if (price < 100000) return "$50k-$100k";
  if (price < 250000) return "$100k-$250k";
  if (price < 500000) return "$250k-$500k";
  if (price < 1000000) return "$500k-$1M";
  return "$1M+";
}

// ---- Demand scoring ----

function computeDemandScore(
  demo: { population: number | null; medianIncome: number | null },
  market: { vehicles25mi: number; competingCollections: number; competingDealers: number },
  inventoryCount: number,
): number {
  let score = 0;

  // Population density (30% weight)
  const pop = demo.population || 0;
  score += Math.min(30, (pop / 500000) * 30);

  // Median income (20% weight)
  const income = demo.medianIncome || 0;
  score += Math.min(20, (income / 100000) * 20);

  // Vehicle density in radius (20% weight)
  score += Math.min(20, (market.vehicles25mi / 100) * 20);

  // Competition inverse (15% weight) — less competition = more opportunity
  const competition = market.competingCollections + market.competingDealers;
  score += Math.max(0, 15 - competition * 2);

  // Inventory signal (15% weight) — having inventory shows activity
  score += inventoryCount > 0 ? Math.min(15, (inventoryCount / 20) * 15) : 0;

  return Math.min(100, Math.max(0, score));
}

// ---- AI opportunity writeup ----

async function generateOpportunityWriteup(
  col: { business_name: string; city: string; country: string },
  inventory: number,
  capacity: number,
  demo: { metroArea: string | null; population: number | null; medianIncome: number | null },
  market: { vehicles25mi: number; competingCollections: number; competingDealers: number },
  distributions: { makes: Record<string, number>; eras: Record<string, number> },
  demandScore: number,
): Promise<{ summary: string; score: number }> {
  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return { summary: null as any, score: demandScore };
    }

    const topMakes = Object.entries(distributions.makes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([m, c]) => `${m} (${c})`)
      .join(", ");

    const topEras = Object.entries(distributions.eras)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([e, c]) => `${e} (${c})`)
      .join(", ");

    const prompt = `Write a concise 2-3 paragraph franchise-territory-style business intelligence summary for this vehicle collection:

Collection: ${col.business_name}
Location: ${col.city}, ${col.country}
Metro Area: ${demo.metroArea || "Unknown"}
Metro Population: ${demo.population?.toLocaleString() || "Unknown"}
Median Income: ${demo.medianIncome ? "$" + Math.round(demo.medianIncome).toLocaleString() : "Unknown"}

Current Inventory: ${inventory} vehicles
Estimated Capacity: ${capacity} vehicles
Utilization: ${capacity > 0 ? Math.round((inventory / capacity) * 100) : "N/A"}%

Market Context:
- Vehicles tracked within 25mi: ${market.vehicles25mi}
- Competing collections nearby: ${market.competingCollections}
- Competing dealers nearby: ${market.competingDealers}

Top Makes: ${topMakes || "N/A"}
Top Eras: ${topEras || "N/A"}

Demand Score: ${demandScore.toFixed(1)}/100

Write this as if you're briefing an investor. Focus on market opportunity, competitive positioning, and growth potential. Be specific with numbers. Do not use bullet points.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      console.warn("OpenAI API error:", resp.status);
      return { summary: null as any, score: demandScore };
    }

    const data = await resp.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || null;

    return { summary, score: demandScore };
  } catch (err) {
    console.warn("AI writeup error:", err);
    return { summary: null as any, score: demandScore };
  }
}
