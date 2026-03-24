/**
 * fb-marketplace-to-vehicles.mjs — Link unlinked FB Marketplace listings to vehicles
 *
 * Handles 3 categories of unlinked marketplace_listings:
 * 1. Has parsed_year/make/model → create vehicle + link
 * 2. Has title but no parsed data → parse title, then create vehicle + link
 * 3. Empty stubs (no title, no data) → mark as reviewed/skip
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-marketplace-to-vehicles.mjs
 *   dotenvx run -- node scripts/fb-marketplace-to-vehicles.mjs --dry-run
 *   dotenvx run -- node scripts/fb-marketplace-to-vehicles.mjs --limit 100
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1], 10)
  : null;

// ---------------------------------------------------------------------------
// Title parser — extract year/make/model from FB listing titles
// ---------------------------------------------------------------------------
const YEAR_RE = /\b(19[2-9]\d|20[0-2]\d)\b/;
const KNOWN_MAKES = new Map([
  ["chevy", "Chevrolet"], ["chevrolet", "Chevrolet"], ["gmc", "GMC"],
  ["ford", "Ford"], ["dodge", "Dodge"], ["plymouth", "Plymouth"],
  ["chrysler", "Chrysler"], ["jeep", "Jeep"], ["buick", "Buick"],
  ["cadillac", "Cadillac"], ["oldsmobile", "Oldsmobile"],
  ["pontiac", "Pontiac"], ["lincoln", "Lincoln"], ["mercury", "Mercury"],
  ["amc", "AMC"], ["studebaker", "Studebaker"], ["desoto", "DeSoto"],
  ["willys", "Willys"], ["packard", "Packard"], ["hudson", "Hudson"],
  ["nash", "Nash"], ["international", "International"],
  ["toyota", "Toyota"], ["honda", "Honda"], ["nissan", "Nissan"],
  ["datsun", "Datsun"], ["mazda", "Mazda"], ["subaru", "Subaru"],
  ["mitsubishi", "Mitsubishi"], ["suzuki", "Suzuki"], ["lexus", "Lexus"],
  ["acura", "Acura"], ["infiniti", "Infiniti"],
  ["bmw", "BMW"], ["mercedes", "Mercedes-Benz"], ["mercedes-benz", "Mercedes-Benz"],
  ["audi", "Audi"], ["volkswagen", "Volkswagen"], ["vw", "Volkswagen"],
  ["porsche", "Porsche"], ["volvo", "Volvo"], ["saab", "Saab"],
  ["jaguar", "Jaguar"], ["land rover", "Land Rover"], ["rover", "Rover"],
  ["mg", "MG"], ["triumph", "Triumph"], ["austin-healey", "Austin-Healey"],
  ["lotus", "Lotus"], ["bentley", "Bentley"], ["rolls-royce", "Rolls-Royce"],
  ["aston martin", "Aston Martin"], ["mclaren", "McLaren"],
  ["ferrari", "Ferrari"], ["lamborghini", "Lamborghini"],
  ["maserati", "Maserati"], ["alfa romeo", "Alfa Romeo"], ["fiat", "Fiat"],
  ["lancia", "Lancia"], ["de tomaso", "De Tomaso"],
  ["shelby", "Shelby"], ["tesla", "Tesla"], ["rivian", "Rivian"],
  ["scout", "Scout"], ["delorean", "DeLorean"],
]);

function parseTitleYMM(title) {
  if (!title) return null;

  // Clean common prefixes
  let cleaned = title
    .replace(/^(Sold\s*·?\s*|Listed\s*·?\s*)/i, "")
    .replace(/·/g, " ")
    .trim();

  // Extract year
  const yearMatch = cleaned.match(YEAR_RE);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[1], 10);

  // Everything after year is potential make/model
  const afterYear = cleaned.substring(cleaned.indexOf(yearMatch[0]) + yearMatch[0].length).trim();
  if (!afterYear) return null;

  const words = afterYear.split(/\s+/);

  // Try two-word make first (e.g., "Land Rover", "Alfa Romeo", "Aston Martin")
  let make = null;
  let modelStart = 1;
  if (words.length >= 2) {
    const twoWord = `${words[0]} ${words[1]}`.toLowerCase();
    if (KNOWN_MAKES.has(twoWord)) {
      make = KNOWN_MAKES.get(twoWord);
      modelStart = 2;
    }
  }
  if (!make && words.length >= 1) {
    const oneWord = words[0].toLowerCase();
    if (KNOWN_MAKES.has(oneWord)) {
      make = KNOWN_MAKES.get(oneWord);
      modelStart = 1;
    }
  }

  if (!make) return null;

  // Model is the rest, truncated to ~3 meaningful words
  const modelWords = words.slice(modelStart, modelStart + 3)
    .filter(w => w.length > 0 && !/^\d+$/.test(w));
  const model = modelWords.join(" ") || null;

  return { year, make, model };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[fb→vehicles] Starting FB Marketplace → Vehicle pipeline`);
  console.log(`  dry-run: ${dryRun}, limit: ${limitArg ?? "all"}`);

  // Fetch unlinked listings
  let query = supabase
    .from("marketplace_listings")
    .select("id, title, url, parsed_year, parsed_make, parsed_model, price, location, image_url, all_images, facebook_id, description")
    .is("vehicle_id", null);

  if (limitArg) query = query.limit(limitArg);
  else query = query.limit(1000);

  const { data: listings, error } = await query;
  if (error) {
    console.error("Failed to fetch listings:", error.message);
    process.exit(1);
  }

  console.log(`[fb→vehicles] Found ${listings.length} unlinked listings`);

  const stats = {
    withParsedData: 0,
    titleParsed: 0,
    emptyStubs: 0,
    vehiclesCreated: 0,
    vehiclesLinked: 0,
    existingMatches: 0,
    parseFailures: 0,
    errors: 0,
  };

  const BATCH_SIZE = 50;
  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE);

    for (const listing of batch) {
      let year = listing.parsed_year;
      let make = listing.parsed_make;
      let model = listing.parsed_model;

      // Category 3: empty stub
      if (!listing.title && !year) {
        stats.emptyStubs++;
        if (!dryRun) {
          await supabase
            .from("marketplace_listings")
            .update({ reviewed: true, review_notes: "empty_stub_no_data" })
            .eq("id", listing.id);
        }
        continue;
      }

      // Category 2: has title but no parsed data — parse it
      if (!year && listing.title) {
        const parsed = parseTitleYMM(listing.title);
        if (parsed) {
          year = parsed.year;
          make = parsed.make;
          model = parsed.model;
          stats.titleParsed++;

          // Save parsed data back
          if (!dryRun) {
            await supabase
              .from("marketplace_listings")
              .update({
                parsed_year: year,
                parsed_make: make,
                parsed_model: model,
              })
              .eq("id", listing.id);
          }
        } else {
          stats.parseFailures++;
          if (!dryRun) {
            await supabase
              .from("marketplace_listings")
              .update({ reviewed: true, review_notes: "title_parse_failed" })
              .eq("id", listing.id);
          }
          continue;
        }
      }

      if (year) stats.withParsedData++;

      // Skip if still no year/make
      if (!year || !make) {
        stats.parseFailures++;
        continue;
      }

      // Check if vehicle already exists (by listing URL or year+make+model match)
      const fbUrl = listing.url;
      const { data: existingByUrl } = await supabase
        .from("vehicles")
        .select("id")
        .eq("listing_url", fbUrl)
        .limit(1)
        .maybeSingle();

      if (existingByUrl) {
        // Link existing vehicle
        if (!dryRun) {
          await supabase
            .from("marketplace_listings")
            .update({ vehicle_id: existingByUrl.id })
            .eq("id", listing.id);
        }
        stats.existingMatches++;
        stats.vehiclesLinked++;
        continue;
      }

      // Create new vehicle
      if (dryRun) {
        console.log(`  [dry-run] Would create: ${year} ${make} ${model || "?"} — ${fbUrl}`);
        stats.vehiclesCreated++;
        continue;
      }

      const insertData = {
        year,
        make: make.charAt(0).toUpperCase() + make.slice(1),
        model: model || null,
        listing_url: fbUrl,
        asking_price: listing.price ? Math.round(listing.price) : null,
        description: listing.description || null,
        listing_location: listing.location || null,
        status: "active",
        source: "facebook_marketplace",
        auction_source: "facebook_marketplace",
        discovery_source: "facebook_marketplace",
        primary_image_url: listing.image_url || null,
      };

      const { data: newVeh, error: vehErr } = await supabase
        .from("vehicles")
        .insert(insertData)
        .select("id")
        .single();

      if (vehErr) {
        console.error(`  Vehicle insert error: ${vehErr.message}`);
        stats.errors++;
        continue;
      }

      // Link marketplace listing to vehicle
      await supabase
        .from("marketplace_listings")
        .update({ vehicle_id: newVeh.id })
        .eq("id", listing.id);

      stats.vehiclesCreated++;
      stats.vehiclesLinked++;
    }

    if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= listings.length) {
      console.log(
        `[fb→vehicles] Progress: ${Math.min(i + BATCH_SIZE, listings.length)}/${listings.length} | ` +
        `created: ${stats.vehiclesCreated}, linked: ${stats.vehiclesLinked}, ` +
        `existing: ${stats.existingMatches}, stubs: ${stats.emptyStubs}, ` +
        `parsed: ${stats.titleParsed}, failed: ${stats.parseFailures}`
      );
    }
  }

  console.log(`\n[fb→vehicles] COMPLETE`);
  console.log(`  With parsed data: ${stats.withParsedData}`);
  console.log(`  Titles parsed: ${stats.titleParsed}`);
  console.log(`  Empty stubs marked: ${stats.emptyStubs}`);
  console.log(`  Vehicles created: ${stats.vehiclesCreated}`);
  console.log(`  Vehicles linked: ${stats.vehiclesLinked}`);
  console.log(`  Existing matches: ${stats.existingMatches}`);
  console.log(`  Parse failures: ${stats.parseFailures}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Dry run: ${dryRun}`);
}

main().catch((e) => {
  console.error("[fb→vehicles] Fatal:", e);
  process.exit(1);
});
