/**
 * extract-premium-auction
 *
 * Router function that dispatches to the appropriate extractor based on site_type.
 * Used by autonomous-extraction-agent to extract from premium auction sites.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mapping of site types to their extractor functions
const SITE_EXTRACTORS: Record<string, string> = {
  carsandbids: "extract-cars-and-bids-core",
  bat: "bat-simple-extract",
  bringatrailer: "bat-simple-extract",
  hagerty: "extract-hagerty-listing",
  pcarmarket: "import-pcarmarket-listing",
  ebaymotors: "extract-ebay-motors",
  ebay: "extract-ebay-motors",
  mecum: "extract-vehicle-data-ai",
  barrettjackson: "extract-vehicle-data-ai",
  russoandsteele: "extract-vehicle-data-ai",
  rmsothebys: "extract-vehicle-data-ai",
  gooding: "extract-vehicle-data-ai",
  bonhams: "extract-vehicle-data-ai",
  generic: "extract-vehicle-data-ai",
};

// Site-specific listing page URL patterns
const SITE_LISTING_PATTERNS: Record<string, RegExp[]> = {
  carsandbids: [/carsandbids\.com\/auctions\/[A-Za-z0-9]+/],
  bat: [/bringatrailer\.com\/listing\/[a-z0-9-]+/],
  bringatrailer: [/bringatrailer\.com\/listing\/[a-z0-9-]+/],
  hagerty: [/hagerty\.com\/marketplace\/[a-zA-Z0-9-]+/],
  pcarmarket: [/pcarmarket\.com\/listing\/\d+/],
  ebaymotors: [/ebay\.com\/itm\/\d+/, /ebay\.com\/motors\/itm\/\d+/],
  ebay: [/ebay\.com\/itm\/\d+/, /ebay\.com\/motors\/itm\/\d+/],
  mecum: [/mecum\.com\/lots\/[A-Z0-9]+-[A-Z0-9]+/],
  barrettjackson: [/barrett-jackson\.com\/Events\/Auction\/Details\/\d+/],
  russoandsteele: [/russoandsteele\.com\/auction-detail\/\d+/],
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const { url, site_type, max_vehicles = 10 } = body;

    if (!url) {
      return new Response(JSON.stringify({ error: "Missing URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine site type from URL if not provided
    let detectedSiteType = site_type;
    if (!detectedSiteType) {
      for (const [type, patterns] of Object.entries(SITE_LISTING_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(url)) {
            detectedSiteType = type;
            break;
          }
        }
        if (detectedSiteType) break;
      }
    }

    if (!detectedSiteType) {
      detectedSiteType = "generic";
    }

    const extractorFunction = SITE_EXTRACTORS[detectedSiteType] || "extract-vehicle-data-ai";

    console.log(`extract-premium-auction: Routing ${url} to ${extractorFunction} (site_type: ${detectedSiteType})`);

    // For auctions index pages, we need to discover listings first
    const isIndexPage = url.endsWith('/auctions') || url.endsWith('/auctions/') ||
                       url.includes('/results') || url.includes('/catalog');

    if (isIndexPage) {
      console.log(`extract-premium-auction: Detected index page, discovering listings...`);

      const discovered = await discoverListingsFromIndex(url, detectedSiteType, max_vehicles);

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const listingUrl of discovered.slice(0, max_vehicles)) {
        try {
          const { data, error } = await supabase.functions.invoke(extractorFunction, {
            body: { url: listingUrl },
          });

          if (error) {
            console.error(`Failed to extract ${listingUrl}:`, error.message);
            errorCount++;
          } else if (data?.success) {
            successCount++;
            results.push({ url: listingUrl, vehicle_id: data.vehicle_id });
          } else {
            errorCount++;
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (e: any) {
          console.error(`Exception extracting ${listingUrl}:`, e.message);
          errorCount++;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        site_type: detectedSiteType,
        index_url: url,
        listings_discovered: discovered.length,
        vehicles_created: successCount,
        errors: errorCount,
        issues: errorCount > 0 ? [`${errorCount} extractions failed`] : [],
        timestamp: new Date().toISOString(),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For individual listing pages, extract directly
    const { data, error } = await supabase.functions.invoke(extractorFunction, {
      body: { url },
    });

    if (error) {
      throw new Error(`Extractor ${extractorFunction} failed: ${error.message}`);
    }

    return new Response(JSON.stringify({
      success: data?.success || false,
      site_type: detectedSiteType,
      extractor: extractorFunction,
      vehicle_id: data?.vehicle_id,
      vehicles_created: data?.success ? 1 : 0,
      listings_discovered: 1,
      data,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("extract-premium-auction error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error),
      vehicles_created: 0,
      listings_discovered: 0,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function discoverListingsFromIndex(
  indexUrl: string,
  siteType: string,
  maxListings: number
): Promise<string[]> {
  const firecrawlApiKey = (Deno.env.get("FIRECRAWL_API_KEY") ?? "").trim();

  if (!firecrawlApiKey) {
    console.warn("No FIRECRAWL_API_KEY, returning empty listings");
    return [];
  }

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: indexUrl,
        formats: ["html", "links"],
        waitFor: 5000,
      }),
    });

    if (!response.ok) {
      console.error(`Firecrawl returned ${response.status}`);
      return [];
    }

    const result = await response.json();
    const html = result.data?.html || "";
    const links = result.data?.links || [];

    const patterns = SITE_LISTING_PATTERNS[siteType] || [];
    const discovered: string[] = [];
    const seen = new Set<string>();

    for (const link of links) {
      if (typeof link !== 'string') continue;
      for (const pattern of patterns) {
        if (pattern.test(link) && !seen.has(link)) {
          seen.add(link);
          discovered.push(link);
          if (discovered.length >= maxListings) break;
        }
      }
      if (discovered.length >= maxListings) break;
    }

    if (discovered.length < maxListings) {
      const hrefMatches = html.matchAll(/href=["']([^"']+)["']/gi);
      for (const match of hrefMatches) {
        const href = match[1];
        for (const pattern of patterns) {
          if (pattern.test(href) && !seen.has(href)) {
            let fullUrl = href;
            if (href.startsWith('/')) {
              const baseUrl = new URL(indexUrl);
              fullUrl = `${baseUrl.protocol}//${baseUrl.host}${href}`;
            }
            seen.add(href);
            discovered.push(fullUrl);
            if (discovered.length >= maxListings) break;
          }
        }
        if (discovered.length >= maxListings) break;
      }
    }

    console.log(`Discovered ${discovered.length} listings from ${indexUrl}`);
    return discovered;

  } catch (e: any) {
    console.error(`Failed to discover listings: ${e.message}`);
    return [];
  }
}
