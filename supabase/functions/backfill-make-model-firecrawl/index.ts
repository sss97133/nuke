import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CliOptions {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  excludeMerged: boolean;
}

function parseOptions(req: Request): CliOptions {
  const url = new URL(req.url);
  return {
    dryRun: url.searchParams.get("dry-run") === "true",
    limit: parseInt(url.searchParams.get("limit") || "0", 10),
    batchSize: parseInt(url.searchParams.get("batch-size") || "10", 10),
    excludeMerged: url.searchParams.get("include-merged") !== "true",
  };
}

/**
 * Scrape URL with Firecrawl and extract make/model
 */
async function scrapeWithFirecrawl(
  url: string,
  firecrawlApiKey: string
): Promise<{ make: string | null; model: string | null; markdown?: string; error?: string }> {
  try {
    const extractionSchema = {
      type: "object",
      properties: {
        title: { type: "string" },
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        trim: { type: "string" },
        vin: { type: "string" },
        asking_price: { type: "number" },
        price: { type: "number" },
        mileage: { type: "number" },
        location: { type: "string" },
        description: { type: "string" },
      },
    };

    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["extract", "markdown", "html"],
        extract: { schema: extractionSchema },
        onlyMainContent: false,
        waitFor: 5000,
      }),
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { make: null, model: null, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }

    const result = await resp.json();

    if (!result.success) {
      return {
        make: null,
        model: null,
        error: result.error || "Firecrawl extraction failed",
      };
    }

    // Try structured extraction first
    const extracted = result.data?.extract;
    if (extracted?.make && extracted?.model) {
      return {
        make: cleanMakeName(extracted.make),
        model: cleanModelName(extracted.model),
        markdown: result.data?.markdown,
      };
    }

    // Fallback: Parse from markdown/HTML
    const markdown = result.data?.markdown || "";
    const html = result.data?.html || "";
    const combined = `${markdown}\n${html}`;

    // Extract from title patterns in markdown
    const titleMatch = combined.match(/(\d{4})\s+([A-Za-z][A-Za-z\s&-]+?)\s+(.+?)(?:\s|$|\n|#|##)/);
    if (titleMatch) {
      const make = titleMatch[2].trim();
      const model = titleMatch[3].trim();
      if (make.length > 1 && make.length < 50 && model.length > 1) {
        return {
          make: cleanMakeName(make),
          model: cleanModelName(model),
          markdown,
        };
      }
    }

    // Try to find make/model in common patterns
    const makeModelPatterns = [
      /Make[:\s]+([A-Za-z][A-Za-z\s&-]+)/i,
      /Manufacturer[:\s]+([A-Za-z][A-Za-z\s&-]+)/i,
      /Brand[:\s]+([A-Za-z][A-Za-z\s&-]+)/i,
    ];

    const modelPatterns = [
      /Model[:\s]+([A-Za-z0-9][A-Za-z0-9\s&-]+)/i,
      /Vehicle[:\s]+([A-Za-z0-9][A-Za-z0-9\s&-]+)/i,
    ];

    let extractedMake: string | null = null;
    let extractedModel: string | null = null;

    for (const pattern of makeModelPatterns) {
      const match = combined.match(pattern);
      if (match && match[1]) {
        extractedMake = cleanMakeName(match[1].trim());
        break;
      }
    }

    for (const pattern of modelPatterns) {
      const match = combined.match(pattern);
      if (match && match[1]) {
        extractedModel = cleanModelName(match[1].trim());
        break;
      }
    }

    if (extractedMake && extractedModel) {
      return { make: extractedMake, model: extractedModel, markdown };
    }

    return { make: null, model: null, markdown };
  } catch (err: any) {
    return {
      make: null,
      model: null,
      error: err.message || String(err),
    };
  }
}

/**
 * Clean make name
 */
function cleanMakeName(make: string | null): string | null {
  if (!make) return null;
  const m = make.trim();
  if (m.length === 0) return null;

  if (m.toLowerCase().match(/^mercedes[-\s]?benz$/i)) return "Mercedes-Benz";
  if (m.toLowerCase() === "mercedes") return "Mercedes-Benz";

  return m
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return "";
      if (word.length === 1) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Clean model name
 */
function cleanModelName(model: string | null): string | null {
  if (!model) return null;
  const m = model.trim();
  if (m.length === 0) return null;

  return m
    .split(/\s+/)
    .map((word) => {
      if (word.length === 0) return "";
      if (word.length <= 3 && word.match(/^[A-Z]+$/)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Process vehicles in batches with rate limiting
 */
async function processBatch(
  vehicles: any[],
  firecrawlApiKey: string,
  supabase: any,
  opts: CliOptions
): Promise<{ processed: number; extracted: number; updated: number; errors: string[] }> {
  const results = {
    processed: 0,
    extracted: 0,
    updated: 0,
    errors: [] as string[],
  };

  // Process in parallel batches
  for (let i = 0; i < vehicles.length; i += opts.batchSize) {
    const batch = vehicles.slice(i, i + opts.batchSize);
    const promises = batch.map(async (vehicle) => {
      results.processed++;

      // Get URL to scrape
      const url =
        vehicle.discovery_url || vehicle.listing_url || vehicle.bat_auction_url || vehicle.platform_url;

      if (!url) {
        return;
      }

      const extracted = await scrapeWithFirecrawl(url, firecrawlApiKey);

      if (extracted.error) {
        results.errors.push(`Vehicle ${vehicle.id}: ${extracted.error}`);
        return;
      }

      if (extracted.make && extracted.model) {
        results.extracted++;

        if (!opts.dryRun) {
          const { error } = await supabase
            .from("vehicles")
            .update({
              make: extracted.make,
              model: extracted.model,
              updated_at: new Date().toISOString(),
            })
            .eq("id", vehicle.id);

          if (error) {
            results.errors.push(`Failed to update ${vehicle.id}: ${error.message}`);
          } else {
            results.updated++;
          }
        }
      }

      // Rate limiting: small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    await Promise.all(promises);

    // Longer delay between batches
    if (i + opts.batchSize < vehicles.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return results;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const opts = parseOptions(req);
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");

    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build query for vehicles missing make
    let query = supabase
      .from("vehicles")
      .select("id,discovery_url,listing_url,bat_auction_url,platform_url")
      .or("make.is.null,make.eq.");

    if (opts.excludeMerged) {
      query = query.neq("status", "merged");
    }

    // Apply limit if specified
    if (opts.limit > 0) {
      query = query.limit(opts.limit);
    }

    // Filter to only vehicles with URLs
    const { data: vehicles, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch vehicles: ${fetchError.message}`);
    }

    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No vehicles found missing make with URLs",
          processed: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Filter to vehicles with URLs
    const vehiclesWithUrls = vehicles.filter(
      (v) => v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url
    );

    if (opts.dryRun) {
      return new Response(
        JSON.stringify({
          message: "DRY RUN - Would process vehicles",
          total_vehicles: vehicles.length,
          vehicles_with_urls: vehiclesWithUrls.length,
          sample_urls: vehiclesWithUrls.slice(0, 5).map((v) => ({
            id: v.id,
            url: v.discovery_url || v.listing_url || v.bat_auction_url || v.platform_url,
          })),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Process vehicles
    const results = await processBatch(vehiclesWithUrls, firecrawlApiKey, supabase, opts);

    return new Response(
      JSON.stringify({
        message: "Backfill complete",
        total_vehicles: vehicles.length,
        vehicles_with_urls: vehiclesWithUrls.length,
        processed: results.processed,
        extracted: results.extracted,
        updated: results.updated,
        errors: results.errors.slice(0, 10), // Limit error output
        error_count: results.errors.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
