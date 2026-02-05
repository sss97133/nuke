import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch source_registry
    const { data: registry, error: regErr } = await supabase
      .from("source_registry")
      .select("slug, display_name, category, status, total_extracted, total_vehicles_created, data_quality_score");

    if (regErr) throw regErr;

    // Fetch observation_sources for additional sources
    const { data: obsSources, error: obsErr } = await supabase
      .from("observation_sources")
      .select("slug, display_name, category, base_trust_score");

    if (obsErr) throw obsErr;

    // Fetch census data
    const { data: census, error: censusErr } = await supabase
      .from("source_census")
      .select(`
        source_id,
        universe_total,
        universe_active,
        census_method,
        census_at
      `)
      .order("census_at", { ascending: false });

    // Get observation_sources to map source_id to slug
    const { data: obsForCensus } = await supabase
      .from("observation_sources")
      .select("id, slug");

    // Build census map (latest per source)
    const censusMap: Record<string, number> = {};
    const sourceIdToSlug: Record<string, string> = {};

    if (obsForCensus) {
      obsForCensus.forEach((s: any) => {
        sourceIdToSlug[s.id] = s.slug;
      });
    }

    if (census) {
      const seen = new Set<string>();
      census.forEach((c: any) => {
        const slug = sourceIdToSlug[c.source_id];
        if (slug && !seen.has(slug)) {
          seen.add(slug);
          censusMap[slug] = c.universe_total;
        }
      });
    }

    // Merge data - registry takes precedence
    const slugSet = new Set((registry || []).map((r: any) => r.slug));
    const merged: any[] = [...(registry || [])];

    (obsSources || []).forEach((obs: any) => {
      if (!slugSet.has(obs.slug)) {
        merged.push({
          slug: obs.slug,
          display_name: obs.display_name,
          category: obs.category,
          status: "not_started",
          total_extracted: 0,
          total_vehicles_created: 0,
          data_quality_score: obs.base_trust_score,
        });
      }
    });

    // Default universe estimates for sources without census
    const defaultUniverse: Record<string, number> = {
      bringatrailer: 95000,
      bat: 95000,
      mecum: 150000,
      "cars-and-bids": 12000,
      pcarmarket: 8000,
      "barrett-jackson": 75000,
      "rm-sothebys": 25000,
      bonhams: 15000,
      gooding: 8000,
      "classic-com": 50000,
      hemmings: 25000,
      craigslist: 500000,
      "ebay-motors": 500000,
      facebook_marketplace: 1000000,
      copart: 200000,
      manheim: 500000,
      cargurus: 2000000,
      "cars-com": 1500000,
      autotrader: 1000000,
      "collecting-cars": 5000,
      hagerty: 3000,
      "dupont-registry": 15000,
      "mobile-de": 800000,
      "autoscout24-de": 600000,
      rennlist: 50000,
      corvetteforum: 60000,
      thesamba: 80000,
      ferrarichat: 15000,
    };

    // Build final response
    const sources = merged.map((s: any) => ({
      slug: s.slug,
      name: s.display_name,
      category: s.category || "other",
      status: s.status || "not_started",
      extracted: s.total_extracted || 0,
      vehicles: s.total_vehicles_created || 0,
      quality: s.data_quality_score,
      universe: censusMap[s.slug] || defaultUniverse[s.slug] || 1000,
    }));

    // Compute totals
    const totalSources = sources.length;
    const totalUniverse = sources.reduce((sum: number, s: any) => sum + s.universe, 0);
    const totalExtracted = sources.reduce((sum: number, s: any) => sum + s.extracted, 0);

    return new Response(
      JSON.stringify({
        sources,
        stats: {
          totalSources,
          totalUniverse,
          totalExtracted,
          coverage: totalUniverse > 0 ? (totalExtracted / totalUniverse) * 100 : 0,
        },
        generated_at: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
