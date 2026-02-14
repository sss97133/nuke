import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { archiveFetch } from "../_shared/archiveFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ECR_BASE = "https://exclusivecarregistry.com";

interface ScrapeRequest {
  business_id?: string;
  batch?: boolean;
  limit?: number;
  dry_run?: boolean;
}

/**
 * Scrape ECR Collection Inventory
 *
 * Fetches collection pages from exclusivecarregistry.com, extracts car links,
 * then scrapes each car page for year/make/model/VIN/chassis.
 *
 * Usage:
 *   POST { "business_id": "uuid" }           — scrape one collection
 *   POST { "batch": true, "limit": 10 }      — scrape next 10 unprocessed
 *   POST { "dry_run": true, "batch": true }   — preview without writing
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
      limit = 10,
      dry_run = false,
    }: ScrapeRequest = await req.json().catch(() => ({}));

    let collections: { id: string; slug: string; website: string; business_name: string }[] = [];

    if (business_id) {
      // Single collection mode
      const { data, error } = await supabase
        .from("businesses")
        .select("id, slug, website, business_name")
        .eq("id", business_id)
        .eq("business_type", "collection")
        .single();

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "Collection not found", detail: error?.message }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      collections = [data];
    } else if (batch) {
      // Batch mode: find collections that haven't been scraped recently
      const { data, error } = await supabase
        .from("businesses")
        .select("id, slug, website, business_name")
        .eq("business_type", "collection")
        .not("website", "is", null)
        .or("last_inventory_sync.is.null,last_inventory_sync.lt." + new Date(Date.now() - 7 * 86400000).toISOString())
        .order("last_inventory_sync", { ascending: true, nullsFirst: true })
        .limit(limit);

      if (error) {
        return new Response(
          JSON.stringify({ error: "Query failed", detail: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      collections = data || [];
    } else {
      return new Response(
        JSON.stringify({ error: "Specify business_id or batch: true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`\n🔍 SCRAPE ECR COLLECTION INVENTORY`);
    console.log(`Collections to process: ${collections.length}`);
    console.log(`Dry run: ${dry_run}\n`);

    const results: {
      business_id: string;
      name: string;
      cars_found: number;
      cars_linked: number;
      errors: string[];
    }[] = [];

    for (const col of collections) {
      const collectionResult = {
        business_id: col.id,
        name: col.business_name,
        cars_found: 0,
        cars_linked: 0,
        errors: [] as string[],
      };

      try {
        // Step 1: Fetch the collection page
        const collectionUrl = col.website || `${ECR_BASE}/collection/${col.slug}`;
        console.log(`\n📦 Processing: ${col.business_name} (${collectionUrl})`);

        const { html, markdown, error: fetchError } = await archiveFetch(collectionUrl, {
          platform: "ecr",
          maxAgeSec: 86400, // 24h cache
          callerName: "scrape-ecr-collection-inventory",
        });

        if (fetchError || (!html && !markdown)) {
          collectionResult.errors.push(`Fetch failed: ${fetchError || "empty response"}`);
          results.push(collectionResult);
          continue;
        }

        // Step 2: Extract car URLs from collection page
        const content = html || markdown || "";
        const carUrls = extractCarUrls(content);
        collectionResult.cars_found = carUrls.length;
        console.log(`   Found ${carUrls.length} car links`);

        if (dry_run) {
          results.push(collectionResult);
          continue;
        }

        // Step 3: Process each car page
        for (const carUrl of carUrls) {
          try {
            const carData = await scrapeCarPage(carUrl);
            if (!carData) continue;

            // Step 4: Upsert vehicle into vehicles table
            const vehicleId = await upsertVehicle(supabase, carData);
            if (!vehicleId) {
              collectionResult.errors.push(`Failed to upsert vehicle: ${carUrl}`);
              continue;
            }

            // Step 5: Link vehicle to collection via business_vehicle_fleet
            const { error: linkError } = await supabase
              .from("business_vehicle_fleet")
              .upsert(
                {
                  business_id: col.id,
                  vehicle_id: vehicleId,
                  fleet_role: "inventory",
                  relationship_type: "owned",
                  status: "active",
                },
                { onConflict: "business_id,vehicle_id" },
              );

            if (linkError) {
              collectionResult.errors.push(`Fleet link error: ${linkError.message}`);
            } else {
              collectionResult.cars_linked++;
            }
          } catch (carErr: any) {
            collectionResult.errors.push(`Car ${carUrl}: ${carErr.message}`);
          }
        }

        // Step 6: Update collection's total_inventory count
        const { count } = await supabase
          .from("business_vehicle_fleet")
          .select("*", { count: "exact", head: true })
          .eq("business_id", col.id)
          .eq("status", "active");

        await supabase
          .from("businesses")
          .update({
            total_inventory: count || collectionResult.cars_linked,
            last_inventory_sync: new Date().toISOString(),
          })
          .eq("id", col.id);

        console.log(`   Linked ${collectionResult.cars_linked}/${carUrls.length} vehicles`);
      } catch (err: any) {
        collectionResult.errors.push(`Collection error: ${err.message}`);
      }

      results.push(collectionResult);
    }

    const totalFound = results.reduce((s, r) => s + r.cars_found, 0);
    const totalLinked = results.reduce((s, r) => s + r.cars_linked, 0);

    console.log(`\n✅ Scraping complete:`);
    console.log(`   Collections: ${results.length}`);
    console.log(`   Cars found: ${totalFound}`);
    console.log(`   Cars linked: ${totalLinked}`);

    return new Response(
      JSON.stringify({
        success: true,
        dry_run,
        collections_processed: results.length,
        total_cars_found: totalFound,
        total_cars_linked: totalLinked,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("scrape-ecr-collection-inventory error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ---- Parsing helpers ----

/**
 * Extract car URLs from HTML/markdown content.
 * ECR pattern: <a href="/car/...">
 */
function extractCarUrls(content: string): string[] {
  const urls = new Set<string>();

  // HTML: <a href="/car/...">
  const hrefRegex = /href=["']([^"']*\/car\/[^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(content)) !== null) {
    const url = match[1];
    urls.add(url.startsWith("http") ? url : `${ECR_BASE}${url}`);
  }

  // Markdown: [text](url) where url contains /car/
  const mdRegex = /\]\(([^)]*\/car\/[^)]+)\)/gi;
  while ((match = mdRegex.exec(content)) !== null) {
    const url = match[1];
    urls.add(url.startsWith("http") ? url : `${ECR_BASE}${url}`);
  }

  return [...urls];
}

/**
 * Scrape a single ECR car page for structured vehicle data.
 */
async function scrapeCarPage(url: string): Promise<{
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis: string | null;
  color: string | null;
  images: string[];
} | null> {
  try {
    const { html, markdown, error } = await archiveFetch(url, {
      platform: "ecr",
      maxAgeSec: 86400 * 7, // 7 day cache for car pages
      callerName: "scrape-ecr-collection-inventory",
    });

    if (error || (!html && !markdown)) return null;

    const content = html || markdown || "";

    // Extract title from <h1> or first heading
    let title = "";
    const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      title = h1Match[1].trim();
    } else {
      // Markdown heading
      const mdH1 = content.match(/^#\s+(.+)/m);
      if (mdH1) title = mdH1[1].trim();
    }

    if (!title) return null;

    // Parse year/make/model from title: "1967 Ferrari 275 GTB/4"
    const titleMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);
    const year = titleMatch ? parseInt(titleMatch[1]) : null;
    const make = titleMatch ? titleMatch[2] : null;
    const model = titleMatch ? titleMatch[3] : null;

    // Extract VIN
    const vinMatch = content.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch ? vinMatch[1].toUpperCase() : null;

    // Extract chassis/serial number
    const chassisMatch = content.match(/(?:Chassis|S\/N|Serial)[:\s#]*([A-Z0-9-]+)/i);
    const chassis = chassisMatch ? chassisMatch[1] : null;

    // Extract color (common patterns)
    let color: string | null = null;
    const colorPatterns = [
      /(?:Color|Colour|Exterior)[:\s]*([A-Za-z\s]+?)(?:\s*[,|<\n])/i,
      /(?:painted|finished)\s+(?:in\s+)?([A-Za-z\s]+?)(?:\s*[,.|<\n])/i,
    ];
    for (const pattern of colorPatterns) {
      const colorMatch = content.match(pattern);
      if (colorMatch) {
        color = colorMatch[1].trim();
        if (color.length > 30) color = null; // Too long, probably not a color
        break;
      }
    }

    // Extract image URLs
    const images: string[] = [];
    const imgRegex = /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(content)) !== null) {
      const imgUrl = imgMatch[1];
      // Filter out tiny icons and logos
      if (imgUrl.includes("logo") || imgUrl.includes("icon") || imgUrl.includes("favicon")) continue;
      images.push(imgUrl.startsWith("http") ? imgUrl : `${ECR_BASE}${imgUrl}`);
    }

    return { url, title, year, make, model, vin, chassis, color, images: images.slice(0, 20) };
  } catch (err) {
    console.warn(`  Car page parse error for ${url}:`, err);
    return null;
  }
}

/**
 * Upsert a vehicle into the vehicles table.
 * Returns the vehicle ID.
 */
async function upsertVehicle(
  supabase: any,
  carData: {
    url: string;
    title: string;
    year: number | null;
    make: string | null;
    model: string | null;
    vin: string | null;
    chassis: string | null;
    color: string | null;
    images: string[];
  },
): Promise<string | null> {
  // Try to find existing vehicle by VIN first
  if (carData.vin) {
    const { data: existing } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", carData.vin)
      .limit(1)
      .single();

    if (existing?.id) return existing.id;
  }

  // Try to find by ECR URL in metadata
  const { data: existingByUrl } = await supabase
    .from("vehicles")
    .select("id")
    .contains("metadata", { ecr_url: carData.url })
    .limit(1);

  if (existingByUrl?.[0]?.id) return existingByUrl[0].id;

  // Insert new vehicle
  const { data: inserted, error } = await supabase
    .from("vehicles")
    .insert({
      year: carData.year,
      make: carData.make,
      model: carData.model,
      vin: carData.vin,
      exterior_color: carData.color,
      vehicle_image_url: carData.images[0] || null,
      metadata: {
        ecr_url: carData.url,
        ecr_title: carData.title,
        chassis_number: carData.chassis,
        source: "ecr_collection_scrape",
      },
    })
    .select("id")
    .single();

  if (error) {
    console.warn(`  Vehicle insert error: ${error.message}`);
    return null;
  }

  // Insert additional images
  if (inserted?.id && carData.images.length > 1) {
    const imageRows = carData.images.slice(1, 10).map((url, i) => ({
      vehicle_id: inserted.id,
      image_url: url,
      url,
      sort_order: i + 1,
      source: "ecr",
    }));

    await supabase.from("vehicle_images").insert(imageRows).catch(() => {});
  }

  return inserted?.id || null;
}
