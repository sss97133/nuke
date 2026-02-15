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
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

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
        // Step 1: Fetch the collection page (Firecrawl for JS-rendered content)
        const collectionUrl = col.website || `${ECR_BASE}/collection/${col.slug}`;
        console.log(`\n📦 Processing: ${col.business_name} (${collectionUrl})`);

        const { html, markdown, error: fetchError } = await archiveFetch(collectionUrl, {
          platform: "ecr",
          maxAgeSec: 86400 * 7, // 7 day cache
          useFirecrawl: true, // ECR loads vehicle listings via JS
          waitForJs: 3000, // Wait for car cards to render
          includeMarkdown: true,
          callerName: "scrape-ecr-collection-inventory",
        });

        if (fetchError || (!html && !markdown)) {
          collectionResult.errors.push(`Fetch failed: ${fetchError || "empty response"}`);
          results.push(collectionResult);
          continue;
        }

        // Step 2: Extract car data from collection page
        const content = html || markdown || "";
        const carUrls = extractCarUrls(content);
        console.log(`   Found ${carUrls.length} car detail links`);

        // Parse make/model from URL patterns: /details/make/model/id
        const urlVehicles = parseVehiclesFromUrls(carUrls);
        console.log(`   Parsed ${urlVehicles.length} vehicles from URLs`);

        // Also extract vehicle names directly from page text (skeleton profiles)
        const textVehicles = extractVehicleNames(content);
        console.log(`   Found ${textVehicles.length} vehicle names from text`);

        // Merge: URL-parsed vehicles take priority, then add text ones not already found
        const allVehicles = [...urlVehicles];
        const seenKeys = new Set(urlVehicles.map(v => `${v.make}-${v.model}`.toLowerCase()));
        for (const tv of textVehicles) {
          const key = `${tv.make}-${tv.model}`.toLowerCase();
          if (!seenKeys.has(key)) {
            allVehicles.push(tv);
            seenKeys.add(key);
          }
        }

        collectionResult.cars_found = allVehicles.length;

        if (dry_run) {
          console.log(`   Vehicles: ${allVehicles.map(v => v.title).join(', ')}`);
          results.push(collectionResult);
          continue;
        }

        // Step 3: Create/link skeleton vehicles
        for (const tv of allVehicles) {
          try {
            // Use ECR detail URL if available, otherwise build a synthetic unique URL
            const vehicleSlug = `${tv.year || "unknown"}-${tv.make}-${tv.model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const uniqueDiscoveryUrl = (tv as any).ecrUrl || `${collectionUrl}/vehicle/${vehicleSlug}`;

            // Check if we already created this skeleton vehicle (from a prior run)
            const { data: existingByDiscovery } = await supabase
              .from("vehicles")
              .select("id")
              .eq("discovery_url", uniqueDiscoveryUrl)
              .limit(1);

            if (existingByDiscovery?.length) {
              // Already created — just make sure it's linked
              await supabase
                .from("business_vehicle_fleet")
                .upsert(
                  { business_id: col.id, vehicle_id: existingByDiscovery[0].id, fleet_role: "inventory", relationship_type: "owned", status: "active" },
                  { onConflict: "business_id,vehicle_id" },
                );
              collectionResult.cars_linked++;
              continue;
            }

            // Check if a matching vehicle already exists by year+make+model
            if (tv.year && tv.make && tv.model) {
              const { data: existing } = await supabase
                .from("vehicles")
                .select("id")
                .eq("year", tv.year)
                .ilike("make", tv.make)
                .ilike("model", tv.model.split(/\s/)[0]) // Match first word of model
                .limit(1);

              if (existing?.length) {
                // Link existing vehicle
                const { error: linkErr } = await supabase
                  .from("business_vehicle_fleet")
                  .upsert(
                    { business_id: col.id, vehicle_id: existing[0].id, fleet_role: "inventory", relationship_type: "owned", status: "active" },
                    { onConflict: "business_id,vehicle_id" },
                  );
                if (linkErr) {
                  collectionResult.errors.push(`Fleet link error for ${tv.title}: ${linkErr.message}`);
                } else {
                  collectionResult.cars_linked++;
                }
                continue;
              }
            }

            // Create skeleton vehicle record with unique discovery_url
            const { data: newVehicle, error: insertErr } = await supabase
              .from("vehicles")
              .insert({
                year: tv.year,
                make: tv.make,
                model: tv.model,
                discovery_source: "ecr_collection_text",
                discovery_url: uniqueDiscoveryUrl,
                origin_metadata: { ecr_collection_url: collectionUrl, ecr_title: tv.title, source: "ecr_collection_scrape" },
              })
              .select("id")
              .single();

            if (insertErr || !newVehicle?.id) {
              collectionResult.errors.push(`Skeleton insert error for ${tv.title}: ${insertErr?.message}`);
              continue;
            }

            const { error: linkErr2 } = await supabase
              .from("business_vehicle_fleet")
              .upsert(
                { business_id: col.id, vehicle_id: newVehicle.id, fleet_role: "inventory", relationship_type: "owned", status: "active" },
                { onConflict: "business_id,vehicle_id" },
              );
            if (linkErr2) {
              collectionResult.errors.push(`Fleet link error for new ${tv.title}: ${linkErr2.message}`);
            } else {
              collectionResult.cars_linked++;
            }
          } catch (tvErr: any) {
            collectionResult.errors.push(`Text vehicle ${tv.title}: ${tvErr.message}`);
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
 * ECR patterns: /details/make/model/id or /car/...
 */
function extractCarUrls(content: string): string[] {
  const urls = new Set<string>();

  // HTML: <a href="/details/..."> (current ECR pattern)
  const detailsRegex = /href=["']([^"']*\/details\/[^"']+)["']/gi;
  let match;
  while ((match = detailsRegex.exec(content)) !== null) {
    const url = match[1];
    urls.add(url.startsWith("http") ? url : `${ECR_BASE}${url}`);
  }

  // HTML: <a href="/car/..."> (legacy pattern)
  const carRegex = /href=["']([^"']*\/car\/[^"']+)["']/gi;
  while ((match = carRegex.exec(content)) !== null) {
    const url = match[1];
    urls.add(url.startsWith("http") ? url : `${ECR_BASE}${url}`);
  }

  // Markdown: [text](/details/...) or [text](/car/...)
  const mdDetailsRegex = /\]\(([^)]*\/details\/[^)]+)\)/gi;
  while ((match = mdDetailsRegex.exec(content)) !== null) {
    const url = match[1];
    urls.add(url.startsWith("http") ? url : `${ECR_BASE}${url}`);
  }

  const mdCarRegex = /\]\(([^)]*\/car\/[^)]+)\)/gi;
  while ((match = mdCarRegex.exec(content)) !== null) {
    const url = match[1];
    urls.add(url.startsWith("http") ? url : `${ECR_BASE}${url}`);
  }

  return [...urls];
}

/**
 * Parse make/model from ECR detail URLs.
 * URL pattern: /details/make/model/id → { make: "Ferrari", model: "Daytona SP3" }
 */
function parseVehiclesFromUrls(urls: string[]): Array<{ year: number | null; make: string; model: string; title: string; ecrUrl: string }> {
  const vehicles: Array<{ year: number | null; make: string; model: string; title: string; ecrUrl: string }> = [];
  const seen = new Set<string>();

  for (const url of urls) {
    // /details/ferrari/daytona-sp3/73775
    const match = url.match(/\/details\/([^/]+)\/([^/]+)(?:\/(\d+))?/i);
    if (!match) continue;

    const rawMake = match[1].replace(/-/g, " ");
    const rawModel = match[2].replace(/-/g, " ");

    // Title-case the make and model
    const make = rawMake.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    // Fix common make names
    const fixedMake = make
      .replace(/^Mercedes Benz$/i, "Mercedes-Benz")
      .replace(/^Aston Martin$/i, "Aston Martin")
      .replace(/^Rolls Royce$/i, "Rolls-Royce")
      .replace(/^Alfa Romeo$/i, "Alfa Romeo")
      .replace(/^De Tomaso$/i, "De Tomaso")
      .replace(/^Gordon Murray$/i, "Gordon Murray");

    const model = rawModel.split(" ").map(w => {
      // Keep common acronyms uppercase
      if (/^(gt[a-z]?|gto|gtb|gts|lm|sp|xx|f\d+)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");

    const key = `${fixedMake}-${model}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    vehicles.push({
      year: null,
      make: fixedMake,
      model,
      title: `${fixedMake} ${model}`,
      ecrUrl: url,
    });
  }

  return vehicles;
}

/**
 * Extract vehicle names directly from collection page content.
 * This catches vehicles listed as text even without detail links.
 * Returns skeleton vehicle data (year/make/model from text patterns).
 */
function extractVehicleNames(content: string): Array<{ year: number | null; make: string; model: string; title: string }> {
  const vehicles: Array<{ year: number | null; make: string; model: string; title: string }> = [];
  const seen = new Set<string>();

  // Known car makes for matching
  const MAKES = [
    'Ferrari', 'Porsche', 'Lamborghini', 'McLaren', 'Bugatti', 'Pagani', 'Koenigsegg',
    'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi', 'Aston Martin', 'Bentley', 'Rolls-Royce',
    'Jaguar', 'Ford', 'Chevrolet', 'Dodge', 'Shelby', 'Corvette',
    'Alfa Romeo', 'Maserati', 'Lotus', 'De Tomaso', 'Lancia',
    'Toyota', 'Nissan', 'Honda', 'Mazda', 'Lexus', 'Acura',
    'Rimac', 'Gordon Murray', 'Singer', 'RUF', 'Brabus',
    'Lola', 'March', 'Tyrrell', 'Dallara', 'Cunningham',
    'AC', 'Allard', 'Horch', 'Hispano-Suiza', 'Delahaye', 'Talbot',
  ];

  // Pattern: "Year Make Model" (e.g., "1967 Ferrari 275 GTB/4")
  let match;
  const yearMakePattern = /\b((?:19|20)\d{2})\s+((?:[A-Z][a-z]+(?:[-\s][A-Z][a-z]+)*))\s+([A-Za-z0-9][\w\s/.-]{1,40}?)(?:\s*[\n|<,;]|$)/gm;
  while ((match = yearMakePattern.exec(content)) !== null) {
    const year = parseInt(match[1]);
    const possibleMake = match[2].trim();
    const model = match[3].trim();

    // Validate it's a known make
    if (!MAKES.some(m => possibleMake.toLowerCase().startsWith(m.toLowerCase()))) continue;
    if (year < 1886 || year > 2027) continue;

    const key = `${year}-${possibleMake}-${model}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    vehicles.push({ year, make: possibleMake, model, title: `${year} ${possibleMake} ${model}` });
  }

  // Pattern: "Make Model" without year (e.g., "Ferrari SF90 XX Spider")
  for (const makeName of MAKES) {
    const regex = new RegExp(`\\b${makeName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+([A-Za-z0-9][\\w\\s/.-]{1,40}?)(?:\\s*[\\n|<,;]|$)`, 'gm');
    while ((match = regex.exec(content)) !== null) {
      const model = match[1].trim();
      // Skip generic words
      if (['Collection', 'Museum', 'Gallery', 'Racing', 'Team', 'Club', 'Owner', 'Motorsport'].includes(model)) continue;
      if (model.length < 2) continue;

      const key = `0-${makeName}-${model}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      vehicles.push({ year: null, make: makeName, model, title: `${makeName} ${model}` });
    }
  }

  return vehicles;
}

