// Source Census Function
// Counts the universe size for any registered source
// Usage: POST { "source": "bat" } or { "source": "all" }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Census strategies per source
// Each returns { total, active?, byYear?, byMake?, confidence, method }
const CENSUS_STRATEGIES: Record<string, CensusStrategy> = {

  // Bring a Trailer - sitemap based
  "bat": {
    method: "sitemap",
    confidence: 0.95,
    async execute(ctx: CensusContext) {
      // BaT sitemap index: https://bringatrailer.com/sitemap_index.xml
      // Contains listing sitemaps with all historical auctions
      const sitemapUrl = "https://bringatrailer.com/sitemap_index.xml";

      try {
        const resp = await fetch(sitemapUrl);
        const xml = await resp.text();

        // Count listing sitemap entries
        // Pattern: <loc>https://bringatrailer.com/sitemap-listings-*.xml</loc>
        const listingSitemaps = xml.match(/sitemap-listings-\d+\.xml/g) || [];

        // Each sitemap has ~1000 entries, estimate total
        // For accuracy, we'd fetch each sitemap and count <url> tags
        // Quick estimate: count sitemaps * 1000
        const estimatedTotal = listingSitemaps.length * 1000;

        // Get active count from main page
        const activeResp = await fetch("https://bringatrailer.com/auctions/");
        const activeHtml = await activeResp.text();
        const activeMatch = activeHtml.match(/(\d+)\s*Active\s*Auctions/i);
        const activeCount = activeMatch ? parseInt(activeMatch[1]) : null;

        return {
          total: estimatedTotal,
          active: activeCount,
          confidence: 0.85, // Estimate, not exact count
          url: sitemapUrl,
          notes: `${listingSitemaps.length} listing sitemaps found`
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  },

  // Cars & Bids - pagination based
  "cars-and-bids": {
    method: "pagination",
    confidence: 0.90,
    async execute(ctx: CensusContext) {
      try {
        // C&B shows total count in search results
        const resp = await fetch("https://carsandbids.com/past-auctions/");
        const html = await resp.text();

        // Look for "X results" or pagination info
        const totalMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:results|auctions)/i);
        const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

        // Active auctions
        const activeResp = await fetch("https://carsandbids.com/");
        const activeHtml = await activeResp.text();
        const activeMatch = activeHtml.match(/(\d+)\s*(?:live|active)/i);
        const active = activeMatch ? parseInt(activeMatch[1]) : null;

        return {
          total,
          active,
          confidence: total ? 0.90 : 0.50,
          url: "https://carsandbids.com/past-auctions/",
          notes: total ? "From pagination count" : "Could not extract count"
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  },

  // Mecum - API/pagination hybrid
  "mecum": {
    method: "pagination",
    confidence: 0.85,
    async execute(ctx: CensusContext) {
      try {
        // Mecum results page shows total
        const resp = await fetch("https://www.mecum.com/lots/");
        const html = await resp.text();

        // Look for total in pagination or results text
        const totalMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:lots|results|vehicles)/i);
        const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

        return {
          total,
          confidence: total ? 0.85 : 0.50,
          url: "https://www.mecum.com/lots/",
          notes: total ? "From results count" : "Could not extract count"
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  },

  // PCarMarket
  "pcarmarket": {
    method: "pagination",
    confidence: 0.90,
    async execute(ctx: CensusContext) {
      try {
        const resp = await fetch("https://pcarmarket.com/listings/all-results/");
        const html = await resp.text();

        const totalMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:results|listings)/i);
        const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

        return {
          total,
          confidence: total ? 0.90 : 0.50,
          url: "https://pcarmarket.com/listings/all-results/"
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  },

  // RM Sotheby's
  "rm-sothebys": {
    method: "pagination",
    confidence: 0.85,
    async execute(ctx: CensusContext) {
      try {
        const resp = await fetch("https://rmsothebys.com/en/results");
        const html = await resp.text();

        const totalMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:lots|results)/i);
        const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

        return {
          total,
          confidence: total ? 0.85 : 0.50,
          url: "https://rmsothebys.com/en/results"
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  },

  // Barrett-Jackson
  "barrett-jackson": {
    method: "pagination",
    confidence: 0.80,
    async execute(ctx: CensusContext) {
      try {
        const resp = await fetch("https://www.barrett-jackson.com/Archive/");
        const html = await resp.text();

        const totalMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:lots|vehicles|results)/i);
        const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

        return {
          total,
          confidence: total ? 0.80 : 0.50,
          url: "https://www.barrett-jackson.com/Archive/"
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  },

  // Hemmings
  "hemmings": {
    method: "pagination",
    confidence: 0.85,
    async execute(ctx: CensusContext) {
      try {
        const resp = await fetch("https://www.hemmings.com/classifieds/cars-for-sale");
        const html = await resp.text();

        const totalMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:vehicles|listings|results)/i);
        const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

        return {
          total,
          confidence: total ? 0.85 : 0.50,
          url: "https://www.hemmings.com/classifieds/cars-for-sale",
          notes: "Active listings only (classifieds rotate)"
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  },

  // Hagerty Marketplace
  "hagerty-marketplace": {
    method: "pagination",
    confidence: 0.85,
    async execute(ctx: CensusContext) {
      try {
        const resp = await fetch("https://www.hagerty.com/marketplace");
        const html = await resp.text();

        const totalMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:vehicles|listings)/i);
        const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : null;

        return {
          total,
          confidence: total ? 0.85 : 0.50,
          url: "https://www.hagerty.com/marketplace"
        };
      } catch (e) {
        return { error: e.message };
      }
    }
  }
};

interface CensusStrategy {
  method: string;
  confidence: number;
  execute: (ctx: CensusContext) => Promise<CensusResult>;
}

interface CensusContext {
  supabase: any;
  sourceSlug: string;
}

interface CensusResult {
  total?: number | null;
  active?: number | null;
  confidence?: number;
  url?: string;
  notes?: string;
  byYear?: Record<string, number>;
  byMake?: Record<string, number>;
  error?: string;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { source, action = "census" } = await req.json();

    // List available strategies
    if (action === "list") {
      return new Response(
        JSON.stringify({
          success: true,
          available_sources: Object.keys(CENSUS_STRATEGIES),
          total_strategies: Object.keys(CENSUS_STRATEGIES).length
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Run census for all sources
    if (source === "all") {
      const results: Record<string, any> = {};
      const errors: string[] = [];

      for (const [slug, strategy] of Object.entries(CENSUS_STRATEGIES)) {
        try {
          const result = await strategy.execute({ supabase, sourceSlug: slug });

          if (result.error) {
            errors.push(`${slug}: ${result.error}`);
            results[slug] = { error: result.error };
          } else if (result.total) {
            // Record the census
            const { data, error } = await supabase.rpc("record_census", {
              p_source_slug: slug,
              p_universe_total: result.total,
              p_universe_active: result.active,
              p_census_method: strategy.method,
              p_census_confidence: result.confidence || strategy.confidence,
              p_census_url: result.url,
              p_by_year: result.byYear || {},
              p_by_make: result.byMake || {}
            });

            results[slug] = {
              total: result.total,
              active: result.active,
              confidence: result.confidence || strategy.confidence,
              recorded: !error,
              census_id: data
            };
          } else {
            results[slug] = { total: null, notes: result.notes || "Could not determine count" };
          }
        } catch (e) {
          errors.push(`${slug}: ${e.message}`);
          results[slug] = { error: e.message };
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          census_results: results,
          sources_processed: Object.keys(results).length,
          errors: errors.length > 0 ? errors : undefined
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Single source census
    const strategy = CENSUS_STRATEGIES[source];
    if (!strategy) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `No census strategy for source: ${source}`,
          available: Object.keys(CENSUS_STRATEGIES)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startTime = Date.now();
    const result = await strategy.execute({ supabase, sourceSlug: source });
    const duration = Date.now() - startTime;

    if (result.error) {
      return new Response(
        JSON.stringify({
          success: false,
          source,
          error: result.error
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record the census
    let censusId = null;
    if (result.total) {
      const { data, error } = await supabase.rpc("record_census", {
        p_source_slug: source,
        p_universe_total: result.total,
        p_universe_active: result.active,
        p_census_method: strategy.method,
        p_census_confidence: result.confidence || strategy.confidence,
        p_census_url: result.url,
        p_by_year: result.byYear || {},
        p_by_make: result.byMake || {}
      });

      if (error) {
        console.error("Failed to record census:", error);
      } else {
        censusId = data;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        source,
        census: {
          universe_total: result.total,
          universe_active: result.active,
          method: strategy.method,
          confidence: result.confidence || strategy.confidence,
          url: result.url,
          notes: result.notes,
          duration_ms: duration,
          recorded: !!censusId,
          census_id: censusId
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
