/**
 * extract-specialty-builder
 *
 * Self-healing extractor for specialty builder sites (Velocity, Kindred, RUF, Singer, Brabus, Cool N Vintage)
 *
 * Features:
 * - Uses Firecrawl for JS-heavy sites
 * - Falls back to Ollama when OpenAI quota exhausted
 * - Built-in validation and inspection
 * - Self-healing: re-scrapes when fields are missing
 * - Extracts descriptions, timeline events, VIN/chassis numbers properly
 *
 * Deploy: supabase functions deploy extract-specialty-builder --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRACTOR_VERSION = "extract-specialty-builder:1.0.0";

// Specialty builder configurations
const BUILDER_CONFIGS: Record<string, BuilderConfig> = {
  "velocityrestorations.com": {
    name: "Velocity Restorations",
    inventoryUrl: "https://www.velocityrestorations.com/for-sale/",
    soldUrl: "https://www.velocityrestorations.com/restorations/",
    needsPlaywright: true,
    specializations: ["restoration", "classic_cars"],
    extractionRules: {
      requiresDescription: true,
      requiresChassisNumber: true, // For high-end builds
      extractTimeline: true,
      extractAuctionAffiliation: true,
    }
  },
  "kindredmotorworks.com": {
    name: "Kindred Motorworks",
    inventoryUrl: "https://kindredmotorworks.com/for-sale",
    needsPlaywright: true,
    specializations: ["custom_conversion", "ev_conversion"],
    extractionRules: {
      requiresDescription: true,
      extractTimeline: true,
    }
  },
  "singervehicledesign.com": {
    name: "Singer Vehicle Design",
    inventoryUrl: null, // To be discovered
    needsPlaywright: true,
    specializations: ["restoration", "custom_conversion"],
    extractionRules: {
      requiresDescription: true,
      requiresChassisNumber: true,
      extractTimeline: true,
    }
  },
  "ruf-automobile.de": {
    name: "RUF Automobile",
    inventoryUrl: null,
    needsPlaywright: true,
    specializations: ["tuning", "custom_conversion"],
    extractionRules: {
      requiresDescription: true,
      requiresChassisNumber: true,
      extractTimeline: true,
    }
  },
  "brabus.com": {
    name: "Brabus",
    inventoryUrl: null,
    needsPlaywright: true,
    specializations: ["tuning", "custom_conversion"],
    extractionRules: {
      requiresDescription: true,
      extractTimeline: true,
    }
  },
  "coolnvintage.com": {
    name: "Cool N Vintage",
    inventoryUrl: null,
    needsPlaywright: true,
    specializations: ["restoration", "classic_cars"],
    extractionRules: {
      requiresDescription: true,
      extractTimeline: true,
    }
  },
};

interface BuilderConfig {
  name: string;
  inventoryUrl: string | null;
  soldUrl?: string;
  needsPlaywright: boolean;
  specializations: string[];
  extractionRules: {
    requiresDescription: boolean;
    requiresChassisNumber?: boolean;
    extractTimeline: boolean;
    extractAuctionAffiliation?: boolean;
  };
}

interface ExtractionRequest {
  url: string;
  builder?: string; // Domain key from BUILDER_CONFIGS
  action?: "extract" | "inspect" | "discover_inventory" | "self_heal";
  queue_id?: string;
  force_rescrape?: boolean;
}

interface ExtractedVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  series: string | null;
  trim: string | null;
  vin: string | null;
  chassis_number: string | null;
  mileage: number | null;
  price: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  body_style: string | null;
  description: string | null;
  location: string | null;
  seller: string | null;
  builder: string | null;
  image_urls: string[];
  timeline_events: TimelineEvent[];
  auction_affiliation: string | null;
  lot_number: string | null;
  confidence: number;
  missing_fields: string[];
  needs_rescrape: boolean;
}

interface TimelineEvent {
  date: string | null;
  event_type: string;
  description: string;
  auction_name?: string;
  lot_number?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body: ExtractionRequest = await req.json();
    const { url, builder, action = "extract", queue_id, force_rescrape } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Determine builder from URL if not specified
    const domain = new URL(url).hostname.replace("www.", "");
    const config = builder ? BUILDER_CONFIGS[builder] : BUILDER_CONFIGS[domain];

    if (!config) {
      console.warn(`[specialty-builder] Unknown builder domain: ${domain}`);
      // Fall back to generic extraction
    }

    console.log(`[specialty-builder] Action: ${action}, URL: ${url}, Builder: ${config?.name || "unknown"}`);

    let result;
    switch (action) {
      case "discover_inventory":
        result = await discoverInventory(url, config, supabase);
        break;
      case "inspect":
        result = await inspectExtraction(url, config, supabase);
        break;
      case "self_heal":
        result = await selfHeal(url, config, queue_id, supabase);
        break;
      case "extract":
      default:
        result = await extractVehicle(url, config, queue_id, force_rescrape, supabase);
        break;
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
        duration_ms: Date.now() - startTime,
        extractor_version: EXTRACTOR_VERSION,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[specialty-builder] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Extract vehicle data from specialty builder listing
 */
async function extractVehicle(
  url: string,
  config: BuilderConfig | undefined,
  queue_id: string | undefined,
  force_rescrape: boolean | undefined,
  supabase: any
): Promise<any> {
  console.log(`[specialty-builder] Extracting: ${url}`);

  // Step 1: Fetch content with Firecrawl (handles JS rendering)
  const scraped = await scrapeWithFirecrawl(url);

  if (!scraped.success) {
    console.error(`[specialty-builder] Scrape failed: ${scraped.error}`);
    throw new Error(`Failed to scrape: ${scraped.error}`);
  }

  // Step 2: Extract using Ollama (since OpenAI quota exhausted)
  const extracted = await extractWithOllama(url, scraped.markdown, config, supabase);

  // Step 3: Validate extraction quality
  const validation = validateExtraction(extracted, config);

  // Step 4: If missing critical fields, mark for self-healing
  if (validation.needs_rescrape) {
    console.warn(`[specialty-builder] Extraction incomplete, needs self-healing: ${validation.missing_fields.join(", ")}`);
  }

  // Step 5: Save to import_queue if queue_id provided
  if (queue_id) {
    await saveToQueue(queue_id, extracted, validation, supabase);
  }

  return {
    data: extracted,
    validation,
    scrape_method: scraped.method,
  };
}

/**
 * Scrape content using Firecrawl or direct fetch
 */
async function scrapeWithFirecrawl(url: string): Promise<any> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

  if (!firecrawlKey) {
    console.warn("[specialty-builder] Firecrawl not configured, using direct fetch");
    return await directFetch(url);
  }

  try {
    console.log(`[specialty-builder] Scraping with Firecrawl: ${url}`);

    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["html", "markdown"],
        onlyMainContent: false,
        waitFor: 5000,
        timeout: 30000,
      }),
      signal: AbortSignal.timeout(90000),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.warn(`[specialty-builder] Firecrawl failed: ${data.error}, falling back to direct fetch`);
      return await directFetch(url);
    }

    return {
      success: true,
      html: data.data?.html || "",
      markdown: data.data?.markdown || "",
      method: "firecrawl",
    };

  } catch (error: any) {
    console.warn(`[specialty-builder] Firecrawl error: ${error.message}, falling back to direct fetch`);
    return await directFetch(url);
  }
}

/**
 * Direct fetch fallback
 */
async function directFetch(url: string): Promise<any> {
  console.log(`[specialty-builder] Direct fetch: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}` };
  }

  const html = await response.text();

  return {
    success: true,
    html,
    markdown: htmlToMarkdown(html),
    method: "direct",
  };
}

/**
 * Extract vehicle data using Ollama (local fallback)
 */
async function extractWithOllama(
  url: string,
  content: string,
  config: BuilderConfig | undefined,
  supabase: any
): Promise<ExtractedVehicle> {
  console.log(`[specialty-builder] Extracting with Ollama`);

  const ollamaUrl = Deno.env.get("OLLAMA_URL") || "http://host.docker.internal:11434";

  // Build extraction prompt with builder-specific requirements
  const prompt = buildExtractionPrompt(url, content, config);

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1:8b",
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 3000,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    const extracted = parseJsonFromResponse(data.response);

    if (!extracted) {
      throw new Error("Failed to parse Ollama response");
    }

    return normalizeExtraction(extracted, url, config);

  } catch (error: any) {
    console.error(`[specialty-builder] Ollama extraction failed: ${error.message}`);

    // If Ollama fails, return minimal extraction
    return {
      url,
      title: null,
      year: null,
      make: null,
      model: null,
      series: null,
      trim: null,
      vin: null,
      chassis_number: null,
      mileage: null,
      price: null,
      exterior_color: null,
      interior_color: null,
      transmission: null,
      engine: null,
      body_style: null,
      description: null,
      location: null,
      seller: config?.name || null,
      builder: config?.name || null,
      image_urls: [],
      timeline_events: [],
      auction_affiliation: null,
      lot_number: null,
      confidence: 0.1,
      missing_fields: ["all"],
      needs_rescrape: true,
    };
  }
}

/**
 * Build extraction prompt for Ollama with builder-specific requirements
 */
function buildExtractionPrompt(url: string, content: string, config?: BuilderConfig): string {
  const builderContext = config ? `
Builder: ${config.name}
Specializations: ${config.specializations.join(", ")}
Requirements:
${config.extractionRules.requiresDescription ? "- MUST extract full description" : ""}
${config.extractionRules.requiresChassisNumber ? "- MUST extract VIN or chassis number" : ""}
${config.extractionRules.extractTimeline ? "- MUST extract timeline events (build dates, auction history)" : ""}
${config.extractionRules.extractAuctionAffiliation ? "- MUST extract auction affiliation and lot numbers" : ""}
` : "";

  return `You are a specialty vehicle builder data extraction specialist. Extract comprehensive vehicle information from this listing.

URL: ${url}
${builderContext}

Page Content (first 15k chars):
${content.substring(0, 15000)}

Extract the following fields as JSON. Return ONLY valid JSON, no other text:
{
  "vin": "17-character VIN if found",
  "chassis_number": "Chassis/serial number if VIN not available (common for high-end/custom builds)",
  "year": 1974,
  "make": "Chevrolet",
  "model": "C10",
  "series": "C10 or series designation",
  "trim": "Cheyenne or trim level",
  "engine": "350 V8 or detailed engine description",
  "mileage": 123456,
  "price": 25000,
  "exterior_color": "Red",
  "interior_color": "Black",
  "transmission": "Automatic or Manual",
  "body_style": "Pickup or body type",
  "description": "FULL DESCRIPTION - extract ALL text describing the vehicle, build process, specifications, history. This is CRITICAL.",
  "location": "City, State",
  "seller": "Seller/builder name",
  "builder": "Builder name if specialty build",
  "image_urls": ["url1", "url2"],
  "title": "Full listing title",
  "timeline_events": [
    {
      "date": "2024-01",
      "event_type": "built|restored|auctioned|sold|service",
      "description": "Event description",
      "auction_name": "Auction house if applicable",
      "lot_number": "Lot number if applicable"
    }
  ],
  "auction_affiliation": "Auction house if listed/sold via auction",
  "lot_number": "Lot number if applicable",
  "confidence": 0.85
}

RULES:
1. Return ONLY valid JSON, no explanations
2. Use null for missing fields, not empty strings
3. Extract FULL description - look for paragraphs describing the vehicle, build process, specifications
4. For high-end/custom builds, chassis number is as important as VIN
5. Look for timeline events: "built in 2022", "auctioned at Mecum", "sold for $X"
6. Extract auction affiliation from phrases like "offered at", "sold at", "lot #"
7. Set confidence 0-1 based on completeness
8. If description is missing, set confidence below 0.5

JSON:`;
}

/**
 * Parse JSON from Ollama response
 */
function parseJsonFromResponse(response: string): any {
  try {
    return JSON.parse(response.trim());
  } catch {
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        // Continue
      }
    }

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fix common issues
        let jsonStr = jsonMatch[0].replace(/,\s*([}\]])/g, "$1");
        try {
          return JSON.parse(jsonStr);
        } catch {
          // Give up
        }
      }
    }
  }

  return null;
}

/**
 * Normalize extracted data
 */
function normalizeExtraction(data: any, url: string, config?: BuilderConfig): ExtractedVehicle {
  const timelineEvents = Array.isArray(data.timeline_events)
    ? data.timeline_events.map((e: any) => ({
        date: e.date || null,
        event_type: e.event_type || "unknown",
        description: e.description || "",
        auction_name: e.auction_name || undefined,
        lot_number: e.lot_number || undefined,
      }))
    : [];

  return {
    url,
    title: data.title || null,
    year: data.year || null,
    make: data.make || null,
    model: data.model || null,
    series: data.series || null,
    trim: data.trim || null,
    vin: data.vin || null,
    chassis_number: data.chassis_number || data.vin || null,
    mileage: data.mileage || null,
    price: data.price || null,
    exterior_color: data.exterior_color || null,
    interior_color: data.interior_color || null,
    transmission: data.transmission || null,
    engine: data.engine || null,
    body_style: data.body_style || null,
    description: data.description || null,
    location: data.location || null,
    seller: data.seller || config?.name || null,
    builder: data.builder || config?.name || null,
    image_urls: Array.isArray(data.image_urls) ? data.image_urls : [],
    timeline_events: timelineEvents,
    auction_affiliation: data.auction_affiliation || null,
    lot_number: data.lot_number || null,
    confidence: typeof data.confidence === "number" ? data.confidence : 0.5,
    missing_fields: [],
    needs_rescrape: false,
  };
}

/**
 * Validate extraction quality against builder requirements
 */
function validateExtraction(extracted: ExtractedVehicle, config?: BuilderConfig): any {
  const missingFields: string[] = [];
  let needsRescrape = false;

  // Check critical fields
  if (!extracted.description || extracted.description.length < 50) {
    missingFields.push("description");
    if (config?.extractionRules.requiresDescription) {
      needsRescrape = true;
    }
  }

  if (!extracted.vin && !extracted.chassis_number) {
    missingFields.push("vin/chassis_number");
    if (config?.extractionRules.requiresChassisNumber) {
      needsRescrape = true;
    }
  }

  if (config?.extractionRules.extractTimeline && extracted.timeline_events.length === 0) {
    missingFields.push("timeline_events");
  }

  if (config?.extractionRules.extractAuctionAffiliation && !extracted.auction_affiliation) {
    missingFields.push("auction_affiliation");
  }

  if (!extracted.year || !extracted.make || !extracted.model) {
    missingFields.push("year/make/model");
    needsRescrape = true;
  }

  extracted.missing_fields = missingFields;
  extracted.needs_rescrape = needsRescrape;

  return {
    is_valid: !needsRescrape,
    quality_score: extracted.confidence,
    missing_fields: missingFields,
    needs_rescrape: needsRescrape,
    completeness_pct: ((15 - missingFields.length) / 15) * 100,
  };
}

/**
 * Save extraction to import_queue
 */
async function saveToQueue(queue_id: string, extracted: ExtractedVehicle, validation: any, supabase: any): Promise<void> {
  console.log(`[specialty-builder] Saving to queue: ${queue_id}`);

  await supabase
    .from("import_queue")
    .update({
      status: validation.is_valid ? "complete" : "pending",
      listing_title: extracted.title,
      listing_year: extracted.year,
      listing_make: extracted.make,
      listing_model: extracted.model,
      listing_price: extracted.price,
      raw_data: {
        ...extracted,
        validation,
        extractor_version: EXTRACTOR_VERSION,
      },
      processed_at: validation.is_valid ? new Date().toISOString() : null,
      error_message: validation.needs_rescrape ? `Missing fields: ${validation.missing_fields.join(", ")}` : null,
    })
    .eq("id", queue_id);
}

/**
 * Discover inventory listings from builder site
 */
async function discoverInventory(url: string, config: BuilderConfig | undefined, supabase: any): Promise<any> {
  console.log(`[specialty-builder] Discovering inventory: ${url}`);

  // TODO: Implement inventory discovery
  // - Scrape inventory page
  // - Extract all listing URLs
  // - Add to import_queue with source

  return {
    discovered: 0,
    message: "Inventory discovery not yet implemented",
  };
}

/**
 * Inspect extraction quality by re-scraping and comparing
 */
async function inspectExtraction(url: string, config: BuilderConfig | undefined, supabase: any): Promise<any> {
  console.log(`[specialty-builder] Inspecting: ${url}`);

  // TODO: Implement inspection
  // - Re-scrape URL
  // - Compare with existing extraction
  // - Report missing/incorrect fields

  return {
    inspection_complete: false,
    message: "Inspection not yet implemented",
  };
}

/**
 * Self-heal: re-extract missing fields
 */
async function selfHeal(url: string, config: BuilderConfig | undefined, queue_id: string | undefined, supabase: any): Promise<any> {
  console.log(`[specialty-builder] Self-healing: ${url}`);

  // Re-extract with force_rescrape
  return await extractVehicle(url, config, queue_id, true, supabase);
}

/**
 * Simple HTML to Markdown converter
 */
function htmlToMarkdown(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/\s+/g, " ").trim();
  return text;
}
