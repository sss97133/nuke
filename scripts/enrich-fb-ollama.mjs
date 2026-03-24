/**
 * FB Marketplace Deep Enrichment via Ollama (local LLM)
 *
 * Takes FB marketplace vehicles and runs them through local AI extraction.
 * Writes structured results to field_evidence with provenance.
 * Zero API cost. Runs on residential Mac.
 *
 * Priority tiers:
 *   Tier 1 (mega): 1960-1989 — enthusiast vehicles, restoration, collector
 *   Tier 2: 1990-1999 — emerging classics
 *   Tier 3: 2000+ — skip
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-fb-ollama.mjs                    # tier 1 (60s-80s)
 *   dotenvx run -- node scripts/enrich-fb-ollama.mjs --tier 2           # 90s
 *   dotenvx run -- node scripts/enrich-fb-ollama.mjs --limit 100        # limit batch
 *   dotenvx run -- node scripts/enrich-fb-ollama.mjs --model qwen2.5:7b # faster model
 *   dotenvx run -- node scripts/enrich-fb-ollama.mjs --dry-run          # preview only
 */

import { createClient } from "@supabase/supabase-js";

const OLLAMA_URL = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODEL = "qwen3:30b-a3b";
const BATCH_SIZE = 10; // titles per LLM call
const DELAY_BETWEEN_BATCHES_MS = 500;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- CLI args ---
const args = process.argv.slice(2);
const tier = parseInt(args.find((_, i, a) => a[i - 1] === "--tier") || "1");
const limit = parseInt(args.find((_, i, a) => a[i - 1] === "--limit") || "5000");
const model = args.find((_, i, a) => a[i - 1] === "--model") || DEFAULT_MODEL;
const dryRun = args.includes("--dry-run");

const TIER_RANGES = {
  1: [1960, 1989],
  2: [1990, 1999],
  3: [2000, 2009],
  4: [2010, 2030],
  0: [1900, 2030], // all years
};

const [yearMin, yearMax] = TIER_RANGES[tier] || TIER_RANGES[1];

console.log(`\n🔧 FB Marketplace Deep Enrichment`);
console.log(`   Model: ${model}`);
console.log(`   Tier ${tier}: ${yearMin}-${yearMax}`);
console.log(`   Limit: ${limit}`);
console.log(`   Dry run: ${dryRun}\n`);

// --- Fetch unenriched vehicles ---
async function fetchVehicles() {
  // Get vehicles that haven't been AI-enriched yet
  // We check for a specific field_evidence entry that marks AI enrichment
  const { data, error } = await supabase.rpc("get_fb_unenriched_vehicles", {
    year_min: yearMin,
    year_max: yearMax,
    batch_limit: limit,
  });

  if (error || !data) {
    // Fallback: direct query if RPC doesn't exist
    console.log("   RPC not found, using direct query...");
    return await fetchVehiclesDirect();
  }
  return data;
}

async function fetchVehiclesDirect() {
  // Get FB marketplace vehicles in year range that don't have AI enrichment evidence
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, year, make, model, description, listing_url, asking_price, mileage, transmission, drivetrain")
    .eq("source", "facebook_marketplace")
    .eq("status", "active")
    .gte("year", yearMin)
    .lte("year", yearMax)
    .order("year", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("Error fetching vehicles:", error.message);
    return [];
  }

  // Get titles from marketplace_listings
  const vehicleIds = vehicles.map((v) => v.id);
  const { data: listings } = await supabase
    .from("marketplace_listings")
    .select("vehicle_id, title, description")
    .in("vehicle_id", vehicleIds);

  const listingMap = {};
  for (const l of listings || []) {
    listingMap[l.vehicle_id] = l;
  }

  // Filter out vehicles that already have AI enrichment
  const { data: enriched } = await supabase
    .from("field_evidence")
    .select("vehicle_id")
    .in("vehicle_id", vehicleIds)
    .eq("source_type", "ai_title_extraction")
    .limit(10000);

  const enrichedIds = new Set((enriched || []).map((e) => e.vehicle_id));

  return vehicles
    .filter((v) => !enrichedIds.has(v.id))
    .map((v) => ({
      ...v,
      listing_title:
        listingMap[v.id]?.title || `${v.year} ${v.make} ${v.model}`,
      listing_description:
        v.description || listingMap[v.id]?.description || null,
    }));
}

// --- Ollama extraction ---
const SYSTEM_PROMPT = `You are a vehicle data extraction system for a collector vehicle database. Given vehicle listing titles and descriptions from Facebook Marketplace, extract structured data.

For each vehicle, return a JSON object with these fields:
- year (integer)
- make (string, standardized — e.g., "Chevrolet" not "Chevy")
- model (string, specific — e.g., "K10" not "pickup")
- trim (string or null — e.g., "Silverado", "Scottsdale", "Custom Deluxe", "SE", "GT")
- body_style (string or null — e.g., "Shortbed Stepside", "Coupe", "Convertible", "Sedan", "Wagon", "SUV")
- engine (string or null — e.g., "350ci V8", "302 V8", "1.8L I4", "5.9L Cummins diesel")
- transmission (string or null — e.g., "4-speed manual", "TH350 automatic", "5-speed", "3-on-the-tree")
- drivetrain (string or null — "4WD", "4x4", "RWD", "FWD", "AWD")
- vehicle_type (string — one of: "car", "truck", "suv", "van", "motorcycle", "boat", "tractor", "atv", "trailer", "other")
- is_automobile (boolean — true ONLY for cars, trucks, SUVs, vans)
- condition_notes (string or null — any condition info: "project", "restored", "barn find", "runs and drives", etc.)
- special_features (string or null — notable features: "matching numbers", "T-tops", "4bbl", "big block", etc.)
- confidence (integer 0-100)

IMPORTANT RULES:
- "Chevy" → "Chevrolet", "Merc" → "Mercury", "Olds" → "Oldsmobile", "Caddy" → "Cadillac"
- C10/C20/C30 = 2WD trucks, K10/K20/K30 = 4WD trucks
- If title mentions "350", "302", "454", "383" etc. those are engine displacements in cubic inches
- "3 on the tree" = 3-speed manual column shift
- Farm equipment (John Deere, Kubota, Allis Chalmers, Massey Ferguson) → vehicle_type: "tractor"
- Harley-Davidson, Honda CB/CR/XR/VTX, Yamaha, Suzuki, Kawasaki bikes → vehicle_type: "motorcycle"
- Boats, jet skis, PWC → vehicle_type: "boat"
- ATVs, UTVs, side-by-sides → vehicle_type: "atv"

Return a JSON array. No markdown, no explanation, just the array.`;

async function extractBatch(vehicles) {
  const input = vehicles
    .map((v, i) => {
      let entry = `${i + 1}. TITLE: ${v.listing_title}`;
      if (v.listing_description) {
        // Truncate long descriptions
        const desc = v.listing_description.substring(0, 300);
        entry += `\n   DESC: ${desc}`;
      }
      if (v.asking_price) entry += `\n   PRICE: $${v.asking_price}`;
      return entry;
    })
    .join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0.1, num_predict: 4096 },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Extract from these ${vehicles.length} listings:\n\n${input}` },
      ],
    }),
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  const content = result.message?.content || "";

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = content;
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("   JSON parse error, trying to salvage...");
    // Try to fix common issues
    try {
      return JSON.parse(jsonStr.replace(/,\s*]/g, "]").replace(/,\s*}/g, "}"));
    } catch (e2) {
      console.error("   Could not parse response:", content.substring(0, 200));
      return null;
    }
  }
}

// --- Write to field_evidence ---
async function writeEvidence(vehicleId, extraction) {
  const fields = [];
  const sourceType = "ai_title_extraction";
  const assignedBy = "algorithm";

  const addField = (fieldName, value, confidence, context) => {
    if (value === null || value === undefined || value === "") return;
    fields.push({
      vehicle_id: vehicleId,
      field_name: fieldName,
      proposed_value: String(value),
      source_type: sourceType,
      source_confidence: confidence,
      extraction_context: context,
      assigned_by: assignedBy,
      status: "accepted",
      raw_extraction_data: { model, extraction_method: "ollama_local" },
    });
  };

  const conf = extraction.confidence || 70;

  addField("vehicle_type", extraction.vehicle_type, conf, "AI classification from title");
  addField("is_automobile", String(extraction.is_automobile), conf, "AI classification");
  if (extraction.trim) addField("trim", extraction.trim, conf, "AI extracted from title");
  if (extraction.body_style) addField("body_style", extraction.body_style, conf, "AI extracted from title");
  if (extraction.engine) addField("engine", extraction.engine, conf, "AI extracted from title/desc");
  if (extraction.transmission) addField("transmission", extraction.transmission, conf, "AI extracted from title/desc");
  if (extraction.drivetrain) addField("drivetrain", extraction.drivetrain, conf, "AI extracted from title/desc");
  if (extraction.condition_notes) addField("condition", extraction.condition_notes, conf - 10, "AI inferred from title/desc");
  if (extraction.special_features) addField("special_features", extraction.special_features, conf - 5, "AI extracted from title/desc");

  // Standardized make (if different from what we have)
  if (extraction.make) addField("make_standardized", extraction.make, conf, "AI standardized make name");

  if (fields.length === 0) return 0;

  const { error } = await supabase.from("field_evidence").insert(fields);
  if (error) {
    // On conflict, skip silently
    if (error.code === "23505") return 0;
    console.error(`   Error writing evidence for ${vehicleId}:`, error.message);
    return 0;
  }

  return fields.length;
}

// --- Update vehicle table with key fields ---
async function updateVehicle(vehicleId, extraction) {
  if (!extraction.is_automobile) {
    // Tag non-automobiles
    await supabase
      .from("vehicles")
      .update({ source_listing_category: extraction.vehicle_type })
      .eq("id", vehicleId);
    return;
  }

  const updates = {};
  if (extraction.transmission && !extraction._existing?.transmission)
    updates.transmission = extraction.transmission;
  if (extraction.drivetrain && !extraction._existing?.drivetrain)
    updates.drivetrain = extraction.drivetrain;
  if (extraction.body_style)
    updates.body_style = extraction.body_style;

  if (Object.keys(updates).length > 0) {
    await supabase.from("vehicles").update(updates).eq("id", vehicleId);
  }
}

// --- Main ---
async function main() {
  // Check Ollama is running
  try {
    const health = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!health.ok) throw new Error("Ollama not responding");
    console.log("✓ Ollama connected\n");
  } catch (e) {
    console.error("✗ Ollama not running at", OLLAMA_URL);
    process.exit(1);
  }

  console.log("Fetching unenriched vehicles...");
  const vehicles = await fetchVehiclesDirect();
  console.log(`Found ${vehicles.length} vehicles to enrich\n`);

  if (vehicles.length === 0) {
    console.log("Nothing to do!");
    return;
  }

  if (dryRun) {
    console.log("DRY RUN — first 5 titles:");
    vehicles.slice(0, 5).forEach((v) => console.log(`  ${v.listing_title}`));
    return;
  }

  let totalEvidence = 0;
  let totalVehicles = 0;
  let automobiles = 0;
  let nonAutomobiles = 0;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(vehicles.length / BATCH_SIZE);

    process.stdout.write(
      `Batch ${batchNum}/${totalBatches} (${batch.length} vehicles)... `
    );

    try {
      const extractions = await extractBatch(batch);
      if (!extractions || extractions.length === 0) {
        console.log("⚠ empty response, skipping");
        continue;
      }

      // Match extractions to vehicles (by index)
      for (let j = 0; j < Math.min(extractions.length, batch.length); j++) {
        const vehicle = batch[j];
        const extraction = extractions[j];

        extraction._existing = {
          transmission: vehicle.transmission,
          drivetrain: vehicle.drivetrain,
        };

        const evidenceCount = await writeEvidence(vehicle.id, extraction);
        await updateVehicle(vehicle.id, extraction);

        totalEvidence += evidenceCount;
        totalVehicles++;

        if (extraction.is_automobile) automobiles++;
        else nonAutomobiles++;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (totalVehicles / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(
        `✓ ${extractions.length} extracted | ${totalEvidence} evidence rows | ${rate}/s | ${elapsed}s`
      );
    } catch (e) {
      console.log(`✗ error: ${e.message}`);
    }

    if (i + BATCH_SIZE < vehicles.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n━━━ COMPLETE ━━━`);
  console.log(`Vehicles processed: ${totalVehicles}`);
  console.log(`  Automobiles: ${automobiles}`);
  console.log(`  Non-auto (tagged): ${nonAutomobiles}`);
  console.log(`Evidence rows written: ${totalEvidence}`);
  console.log(`Time: ${elapsed}s`);
  console.log(`Rate: ${(totalVehicles / (elapsed / 1)).toFixed(1)} vehicles/sec`);
}

main().catch(console.error);
