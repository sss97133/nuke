/**
 * Import Facebook Saved Vehicles into Nuke
 *
 * Reads data/fb-saved-vehicles-2026-03-16.json (500 vehicles scraped from FB Saved Items)
 * and inserts them into the vehicles table with proper Y/M/M parsing and normalization.
 *
 * Two-pass title parsing:
 *   1. Local regex: extract year, make, model from title (~90% of titles)
 *   2. Haiku batch: send hard titles to haiku-extraction-worker parse_titles action
 *
 * Usage:
 *   dotenvx run -- node scripts/import-fb-saved.mjs --dry-run   # preview
 *   dotenvx run -- node scripts/import-fb-saved.mjs             # execute
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");
const BATCH_SIZE = 50;

// ─── Supabase client ───────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(supabaseUrl, supabaseKey);

// ─── Make aliases (mirrors normalizeVehicle.ts MAKE_ALIASES) ───────
const MAKE_ALIASES = {
  chevy: "Chevrolet", chev: "Chevrolet", chevrolet: "Chevrolet",
  vw: "Volkswagen", volkswagen: "Volkswagen",
  merc: "Mercedes-Benz", mercedes: "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz",
  alfa: "Alfa Romeo", "alfa romeo": "Alfa Romeo",
  bmw: "BMW", gmc: "GMC", amg: "Mercedes-AMG",
  "aston martin": "Aston Martin", "rolls royce": "Rolls-Royce", "rolls-royce": "Rolls-Royce",
  "land rover": "Land Rover", "range rover": "Land Rover",
  "austin healey": "Austin-Healey", "austin-healey": "Austin-Healey",
  "de tomaso": "De Tomaso", detomaso: "De Tomaso",
  ford: "Ford", dodge: "Dodge", jeep: "Jeep", toyota: "Toyota",
  nissan: "Nissan", honda: "Honda", porsche: "Porsche", ferrari: "Ferrari",
  lamborghini: "Lamborghini", maserati: "Maserati", bugatti: "Bugatti",
  bentley: "Bentley", jaguar: "Jaguar", lotus: "Lotus", mclaren: "McLaren",
  audi: "Audi", volvo: "Volvo", saab: "Saab", subaru: "Subaru",
  mazda: "Mazda", mitsubishi: "Mitsubishi", hyundai: "Hyundai", kia: "Kia",
  lexus: "Lexus", infiniti: "Infiniti", acura: "Acura", genesis: "Genesis",
  lincoln: "Lincoln", cadillac: "Cadillac", buick: "Buick", pontiac: "Pontiac",
  oldsmobile: "Oldsmobile", chrysler: "Chrysler", plymouth: "Plymouth",
  ram: "RAM", tesla: "Tesla", rivian: "Rivian", mini: "MINI", fiat: "FIAT",
  lancia: "Lancia", triumph: "Triumph", mg: "MG", tvr: "TVR", morgan: "Morgan",
  sunbeam: "Sunbeam", datsun: "Datsun", shelby: "Shelby", delorean: "DeLorean",
  pantera: "De Tomaso", studebaker: "Studebaker", packard: "Packard",
  hudson: "Hudson", nash: "Nash", willys: "Willys",
  international: "International", "international harvester": "International Harvester",
  ih: "International Harvester", hummer: "Hummer", "am general": "AM General",
  amc: "AMC", amx: "AMC", cord: "Cord", auburn: "Auburn",
  duesenberg: "Duesenberg", desoto: "DeSoto", "de soto": "DeSoto",
  edsel: "Edsel", mercury: "Mercury", kaiser: "Kaiser", frazer: "Frazer",
  crosley: "Crosley", avanti: "Avanti", checker: "Checker",
  "land cruiser": "Toyota", landcruiser: "Toyota",
  suzuki: "Suzuki", isuzu: "Isuzu",
  berkeley: "Berkeley",
};

function normalizeMake(make) {
  if (!make || typeof make !== "string") return null;
  const trimmed = make.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (MAKE_ALIASES[lower]) return MAKE_ALIASES[lower];
  // Title-case fallback
  return trimmed.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(trimmed.includes("-") ? "-" : " ");
}

// ─── Non-vehicle keyword filter ────────────────────────────────────
const NON_VEHICLE_KEYWORDS = [
  /\bsailboat\b/i, /\bairstream\b/i, /\bcamper\b/i, /\btrailer\b/i,
  /\bgarage\b.*\bbarn\b/i, /\bbarn\b.*\bgarage\b/i, /\bdouble garage\b/i,
  /\brims\b.*\blugs\b/i, /\b\d+ x \d+\b.*\bgarage\b/i,
  /\btruck bed trailer\b/i, /\bforklift\b/i, /\bkalmar\b/i,
];

// Non-auto makes to filter out (motorcycles, boats, RVs, commercial trucks, etc.)
const NON_AUTO_MAKES_LC = new Set([
  "harley-davidson", "harley", "ducati", "ktm", "husqvarna", "aprilia",
  "moto guzzi", "norton", "buell", "royal enfield", "indian", "bimota",
  "benelli", "mv agusta", "vespa", "piaggio", "bsa", "yamaha", "kawasaki",
  "polaris", "arctic cat", "can-am", "ski-doo",
  "sea-doo", "sea ray", "bayliner", "boston whaler", "mastercraft", "chris-craft",
  "fleetwood", "winnebago", "coachmen", "jayco", "keystone", "forest river", "thor",
  "john deere", "kubota", "caterpillar", "bobcat", "case ih", "new holland",
  "freightliner", "peterbilt", "kenworth", "mack", "hino", "western star",
  "ezgo", "club car", "cushman", "cessna", "piper",
]);

function isNonVehicle(title) {
  return NON_VEHICLE_KEYWORDS.some(re => re.test(title));
}

function isNonAutoMake(make) {
  if (!make) return false;
  return NON_AUTO_MAKES_LC.has(make.toLowerCase().trim());
}

// ─── Known makes list for regex parsing ────────────────────────────
const KNOWN_MAKES = [
  // Multi-word first (greedy match)
  "International Harvester", "International Scout", "Alfa Romeo", "Aston Martin",
  "Austin-Healey", "De Tomaso", "Land Rover", "Mercedes-Benz", "Rolls-Royce",
  "AM General",
  // Single word
  "Chevrolet", "Chevy", "Chev", "Ford", "Dodge", "Pontiac", "Oldsmobile",
  "Buick", "Cadillac", "Chrysler", "Plymouth", "Lincoln", "Mercury",
  "GMC", "Jeep", "AMC", "Hummer", "RAM", "Tesla",
  "Toyota", "Honda", "Nissan", "Datsun", "Mazda", "Subaru", "Mitsubishi",
  "Suzuki", "Isuzu", "Lexus", "Infiniti", "Acura", "Hyundai", "Kia",
  "BMW", "Audi", "Volkswagen", "VW", "Porsche", "Mercedes",
  "Volvo", "Saab", "Jaguar", "Bentley", "Ferrari", "Lamborghini",
  "Maserati", "Lotus", "McLaren", "Triumph", "MG", "Sunbeam",
  "Shelby", "DeLorean", "Studebaker", "Packard", "Hudson", "Nash",
  "Willys", "International", "Cord", "DeSoto", "Edsel", "Kaiser",
  "Checker", "Berkeley", "FIAT", "Lancia",
];

// Build a regex that matches any known make (case-insensitive)
const MAKE_PATTERN = new RegExp(
  `\\b(${KNOWN_MAKES.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i"
);

// ─── Model-implies-make mapping ────────────────────────────────────
// Models/sub-brands that unambiguously identify a make when the title omits it
const MODEL_IMPLIES_MAKE = {
  // Chevrolet
  "c10": "Chevrolet", "c-10": "Chevrolet", "c20": "Chevrolet", "c-20": "Chevrolet",
  "c30": "Chevrolet", "c-30": "Chevrolet", "k10": "Chevrolet", "k-10": "Chevrolet",
  "k20": "Chevrolet", "k-20": "Chevrolet", "k30": "Chevrolet", "k-30": "Chevrolet",
  "k5": "Chevrolet", "k 10": "Chevrolet", "k 20": "Chevrolet", "k 30": "Chevrolet",
  "k 5": "Chevrolet", "c 10": "Chevrolet", "c 20": "Chevrolet", "c 30": "Chevrolet",
  "k15": "GMC", "k-15": "GMC", "k 15": "GMC",
  "corvette": "Chevrolet", "stingray": "Chevrolet", "camaro": "Chevrolet",
  "chevelle": "Chevrolet", "nova": "Chevrolet", "el camino": "Chevrolet",
  "impala": "Chevrolet", "bel air": "Chevrolet", "monte carlo": "Chevrolet",
  "silverado": "Chevrolet", "suburban": "Chevrolet", "blazer": "Chevrolet",
  "square body": "Chevrolet", "squarebody": "Chevrolet",
  // Ford
  "f-100": "Ford", "f100": "Ford", "f-150": "Ford", "f150": "Ford",
  "f-250": "Ford", "f250": "Ford", "f-350": "Ford", "f350": "Ford",
  "bronco": "Ford", "mustang": "Ford", "thunderbird": "Ford",
  "fairlane": "Ford", "galaxie": "Ford", "falcon": "Ford",
  // Dodge/Plymouth
  "charger": "Dodge", "challenger": "Dodge", "coronet": "Dodge",
  "roadrunner": "Plymouth", "road runner": "Plymouth",
  "barracuda": "Plymouth", "'cuda": "Plymouth", "cuda": "Plymouth",
  "duster": "Plymouth", "satellite": "Plymouth", "gtx": "Plymouth",
  // Pontiac
  "firebird": "Pontiac", "trans am": "Pontiac", "gto": "Pontiac",
  // Misc
  "scout": "International Harvester",
  "moke": "MINI",
};

// ─── Title Parser (Pass 1: local regex) ────────────────────────────
function parseTitleLocal(title) {
  if (!title) return null;
  // Clean FB middot separators
  const clean = title.replace(/\s*·\s*/g, " ").replace(/,\s*/g, " ").trim();

  let year = null;
  let make = null;
  let model = null;
  let remainder = clean;

  // Extract year: 4-digit (1920-2026) or 2-digit prefix ('73, 73)
  const year4 = remainder.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  if (year4) {
    year = parseInt(year4[1]);
    remainder = remainder.replace(year4[0], "").trim();
  } else {
    const year2 = remainder.match(/^['']?(\d{2})\b/);
    if (year2) {
      const yy = parseInt(year2[1]);
      year = yy >= 20 && yy <= 99 ? 1900 + yy : yy < 26 ? 2000 + yy : null;
      if (year) remainder = remainder.replace(year2[0], "").trim();
    }
  }

  // Extract make
  const makeMatch = remainder.match(MAKE_PATTERN);
  if (makeMatch) {
    make = normalizeMake(makeMatch[1]);
    remainder = remainder.replace(makeMatch[0], "").trim();
  }

  // If no explicit make found, check if the remaining text starts with a known model/sub-brand
  if (!make) {
    const remLower = remainder.toLowerCase();
    for (const [keyword, impliedMake] of Object.entries(MODEL_IMPLIES_MAKE)) {
      const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(remLower)) {
        make = impliedMake;
        break;
      }
    }
  }

  // Model is whatever's left, cleaned up
  model = remainder
    .replace(/^\s*[-–—]\s*/, "")  // leading dash
    .replace(/\s+/g, " ")
    .trim();

  // Drop generic suffixes that aren't model info
  model = model
    .replace(/\b(Regular Cab|Extended Cab|Crew Cab|Sport Utility|Coupe|Sedan|Convertible|Pickup|Minivan)\s*\d*D?\b/gi, "")
    .replace(/\b(Short Bed|Long Bed|Standard Bed)\b/gi, "")
    .replace(/\b\d+\s*ft\b/gi, "")
    .replace(/\b(HD|LWB|SWB|4D|2D|4x4|RWD|FWD|AWD)\b/gi, (m) => m.toUpperCase()) // keep but normalize case
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!model || model.length < 1) model = null;

  // Confidence: 0.9 for clean regex match, 0.7 if partially parsed
  const conf = year && make ? 0.9 : 0.7;

  if (!year && !make) return null; // totally unparseable

  return { year, make, model, confidence: conf };
}

// ─── Title Parser (Pass 2: Haiku batch) ────────────────────────────
async function parseHardTitles(titles) {
  if (!titles.length) return [];
  console.log(`  Sending ${titles.length} hard titles to haiku-extraction-worker...`);

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/haiku-extraction-worker`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "parse_titles",
        titles: titles.map(t => t.title),
      }),
    });

    if (!resp.ok) {
      console.warn(`  Haiku worker returned ${resp.status}: ${await resp.text()}`);
      return titles.map(() => null);
    }

    const data = await resp.json();
    if (!data.results || !Array.isArray(data.results)) {
      console.warn("  Haiku worker returned unexpected shape:", JSON.stringify(data).slice(0, 200));
      return titles.map(() => null);
    }

    return data.results.map((r) => {
      if (!r || (!r.year && !r.make)) return null;
      return {
        year: r.year || null,
        make: normalizeMake(r.make) || null,
        model: r.model || null,
        confidence: r.confidence || 0.75,
      };
    });
  } catch (err) {
    console.warn(`  Haiku worker error: ${err.message}`);
    return titles.map(() => null);
  }
}

// ─── Dedup check ───────────────────────────────────────────────────
async function findExistingVehicles(parsed) {
  // Build unique (year, make, model) tuples
  const tuples = parsed
    .filter(p => p && p.year && p.make)
    .map(p => ({ year: p.year, make: p.make.toLowerCase(), model: (p.model || "").toLowerCase() }));

  if (!tuples.length) return new Set();

  // Query existing vehicles with same YMM
  const { data, error } = await sb.rpc("sql", {
    query: `
      SELECT year, LOWER(make) as make, LOWER(COALESCE(model,'')) as model,
             source, asking_price
      FROM vehicles
      WHERE status NOT IN ('deleted','merged','duplicate')
        AND year IS NOT NULL AND make IS NOT NULL
        AND (source = 'facebook-saved' OR discovery_source ILIKE '%facebook%')
    `,
  });

  if (error) {
    // Fallback: just query directly
    const { data: d2 } = await sb.from("vehicles")
      .select("year, make, model, source, asking_price")
      .not("status", "in", "(deleted,merged,duplicate)")
      .eq("source", "facebook-saved");
    if (d2) {
      return new Set(d2.map(v => `${v.year}|${(v.make || "").toLowerCase()}|${(v.model || "").toLowerCase()}`));
    }
  }

  if (data) {
    return new Set(data.map(v => `${v.year}|${v.make}|${v.model}`));
  }
  return new Set();
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== FB Saved Vehicles Import ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  // Load JSON
  const jsonPath = resolve(__dirname, "../data/fb-saved-vehicles-2026-03-16.json");
  const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
  console.log(`Loaded ${raw.vehicles.length} vehicles (${raw.active_count} active, ${raw.sold_count} sold)\n`);

  // ─── Pass 1: Local regex parse ───────────────────────────────────
  const results = [];
  const hardTitles = []; // titles that need Haiku help

  for (const v of raw.vehicles) {
    const title = v.title || "";

    // Non-vehicle filter
    if (isNonVehicle(title)) {
      results.push({ ...v, parsed: null, skip: "non-vehicle" });
      continue;
    }

    const parsed = parseTitleLocal(title);
    if (parsed && parsed.make) {
      results.push({ ...v, parsed });
    } else {
      // Queue for Haiku
      hardTitles.push({ idx: results.length, title, original: v });
      results.push({ ...v, parsed: parsed || null, needsHaiku: true });
    }
  }

  const pass1Success = results.filter(r => r.parsed && r.parsed.make && !r.needsHaiku).length;
  const pass1Filtered = results.filter(r => r.skip === "non-vehicle").length;
  console.log(`Pass 1 (regex): ${pass1Success} parsed, ${pass1Filtered} filtered, ${hardTitles.length} need Haiku\n`);

  // ─── Pass 2: Haiku batch for hard titles ─────────────────────────
  if (hardTitles.length > 0 && !DRY_RUN) {
    const haikuResults = await parseHardTitles(hardTitles);
    for (let i = 0; i < hardTitles.length; i++) {
      const { idx } = hardTitles[i];
      if (haikuResults[i]) {
        results[idx].parsed = haikuResults[i];
        results[idx].parsed.source = "haiku";
        delete results[idx].needsHaiku;
      }
    }
    const pass2Success = haikuResults.filter(r => r && r.make).length;
    console.log(`Pass 2 (haiku): ${pass2Success} of ${hardTitles.length} resolved\n`);
  } else if (hardTitles.length > 0) {
    console.log(`Pass 2 (haiku): SKIPPED in dry run — ${hardTitles.length} titles would be sent\n`);
  }

  // ─── Dedup check ─────────────────────────────────────────────────
  const existing = DRY_RUN ? new Set() : await findExistingVehicles(results.map(r => r.parsed));

  // ─── Build insert rows ───────────────────────────────────────────
  const toInsert = [];
  const skipped = { nonVehicle: 0, nonAutoMake: 0, unparseable: 0, duplicate: 0, noMake: 0 };

  for (const r of results) {
    if (r.skip === "non-vehicle") { skipped.nonVehicle++; continue; }
    if (!r.parsed) { skipped.unparseable++; continue; }
    if (!r.parsed.make) { skipped.noMake++; continue; }
    if (isNonAutoMake(r.parsed.make)) { skipped.nonAutoMake++; continue; }

    const p = r.parsed;
    const dedupKey = `${p.year || ""}|${(p.make || "").toLowerCase()}|${(p.model || "").toLowerCase()}`;
    if (existing.has(dedupKey)) { skipped.duplicate++; continue; }

    const isSold = !!r.sold;
    const isHaiku = p.source === "haiku";
    const parseMethod = isHaiku ? "haiku" : "facebook_saved_title_parse";
    const conf = Math.round((p.confidence || 0.9) * 100); // integer 0-100

    toInsert.push({
      year: p.year || null,
      make: p.make,
      model: p.model || null,
      asking_price: r.price || null,
      status: isSold ? "sold" : "discovered",
      source: "facebook-saved",
      discovery_source: "facebook-saved",
      is_for_sale: !isSold,
      auction_status: isSold ? "ended" : "active",
      notes: `Seller: ${r.seller || "unknown"} | Original title: ${r.title}`,
      year_source: p.year ? parseMethod : null,
      make_source: parseMethod,
      model_source: p.model ? parseMethod : null,
      year_confidence: p.year ? conf : null,
      make_confidence: conf,
      model_confidence: p.model ? conf : null,
      listing_title: r.title || null,
      seller_name: r.seller || null,
      entry_type: "contributor_data",
      verification_status: "unverified",
      platform_source: "facebook",
      canonical_platform: "facebook",
      listing_kind: "vehicle",
    });
  }

  console.log(`Ready to insert: ${toInsert.length} vehicles`);
  console.log(`Skipped: ${JSON.stringify(skipped)}\n`);

  // ─── Show sample ─────────────────────────────────────────────────
  if (VERBOSE || DRY_RUN) {
    console.log("Sample (first 10):");
    for (const v of toInsert.slice(0, 10)) {
      console.log(`  ${v.year || "????"} ${v.make} ${v.model || "?"} — $${v.asking_price || "?"} [${v.status}]`);
    }

    // Show hard titles and what happened
    console.log("\nHard titles (needed Haiku):");
    for (const h of hardTitles.slice(0, 15)) {
      const r = results[h.idx];
      const p = r.parsed;
      console.log(`  "${h.title}" → ${p ? `${p.year} ${p.make} ${p.model}` : "FAILED"}`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("DRY RUN — no database writes. Use without --dry-run to execute.\n");

    // Summary stats
    const byStatus = {};
    for (const v of toInsert) {
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    }
    console.log("By status:", byStatus);

    const byMake = {};
    for (const v of toInsert) {
      byMake[v.make] = (byMake[v.make] || 0) + 1;
    }
    const topMakes = Object.entries(byMake).sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log("Top makes:", topMakes.map(([m, c]) => `${m}(${c})`).join(", "));
    return;
  }

  // ─── Batch insert ────────────────────────────────────────────────
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { data, error } = await sb.from("vehicles").insert(batch).select("id");

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);

      // Try one-by-one for this batch
      for (const row of batch) {
        const { error: e2 } = await sb.from("vehicles").insert(row);
        if (e2) {
          if (VERBOSE) console.error(`  Failed: ${row.year} ${row.make} ${row.model} — ${e2.message}`);
          errors++;
        } else {
          inserted++;
        }
      }
    } else {
      inserted += (data || batch).length;
    }

    // Brief pause between batches to be gentle on the DB
    await new Promise(r => setTimeout(r, 200));

    process.stdout.write(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toInsert.length / BATCH_SIZE)} (${inserted} total)\r`);
  }

  console.log(`\n\nDone! Inserted ${inserted} vehicles, ${errors} errors.\n`);

  // ─── Verification ────────────────────────────────────────────────
  const { data: verify, count } = await sb
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("source", "facebook-saved");
  console.log(`Verification: ${count ?? "?"} total facebook-saved vehicles in DB`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
