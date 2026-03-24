#!/usr/bin/env node
/**
 * enrich-fb-rules.mjs
 *
 * Deterministic rule-based enrichment for 483 Facebook Saved vehicles.
 * No LLM required. Uses domain knowledge to extract:
 *   - body_style from FB title suffixes ("Coupe 2D", "Short Bed", "Convertible")
 *   - drivetrain from model (K-series=4WD, C-series=RWD, "4x4"=4WD)
 *   - vehicle_type (car/truck/suv/van)
 *   - trim from title (Silverado, SS, GT, Custom Deluxe, etc.)
 *   - engine inference from era/model
 *
 * Also writes field_evidence with provenance.
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-fb-rules.mjs             # run
 *   dotenvx run -- node scripts/enrich-fb-rules.mjs --dry-run   # preview
 */

import pg from "pg";
const { Pool } = pg;

const DRY_RUN = process.argv.includes("--dry-run");

const pool = new Pool({
  host: "aws-0-us-west-1.pooler.supabase.com",
  port: 6543,
  user: `postgres.${process.env.SUPABASE_PROJECT_ID || "qkgaybvrernstplzjaam"}`,
  password: process.env.SUPABASE_DB_PASSWORD || "RbzKq32A0uhqvJMQ",
  database: "postgres",
  max: 3,
  statement_timeout: 60000,
});

// ─── Vehicle Type Classification ─────────────────────────────────────
const TRUCK_MODELS = new Set([
  "c10", "c-10", "c20", "c-20", "c30", "c-30", "c/k 10", "c/k 20", "c/k 30",
  "k10", "k-10", "k20", "k-20", "k30", "k-30", "k5", "c/k 1500", "c/k 2500", "c/k 3500",
  "silverado", "sierra", "colorado", "canyon", "s10", "s-10", "sonoma",
  "f-100", "f100", "f-150", "f150", "f-250", "f250", "f-350", "f350", "ranger",
  "ram", "d100", "d150", "d200", "d250", "d350", "w100", "w150", "w200", "w250", "w350",
  "power wagon", "dakota", "tacoma", "tundra", "hilux", "frontier", "titan",
  "el camino", "ranchero",
  "1500", "2500", "3500", "c10", "c20", "c30", "k10", "k20", "k30",
]);

const SUV_MODELS = new Set([
  "blazer", "k5 blazer", "k5", "jimmy", "tahoe", "suburban", "yukon",
  "bronco", "excursion", "explorer", "expedition",
  "scout", "wagoneer", "grand wagoneer", "cherokee", "grand cherokee",
  "4runner", "land cruiser", "fj40", "fj60", "fj62", "fj80",
  "range rover", "defender", "discovery",
  "h1", "h2", "h3",
  "ramcharger", "trailduster",
  "pathfinder", "xterra",
]);

const VAN_MODELS = new Set([
  "van", "cargo van", "econoline", "e-150", "e-250", "e-350",
  "g10", "g20", "g30", "vandura", "rally",
  "previa", "vanagon", "bus",
]);

const MOTORCYCLE_MAKES = new Set([
  "harley-davidson", "harley", "ducati", "triumph", "norton",
  "yamaha", "kawasaki", "suzuki", "honda",
]);

// Note: honda/yamaha/suzuki/kawasaki could be car or motorcycle — need model context

function classifyVehicleType(make, model, title) {
  const makeLc = (make || "").toLowerCase();
  const modelLc = (model || "").toLowerCase();
  const titleLc = (title || "").toLowerCase();

  // Check title for explicit type markers
  if (/\b(motorcycle|bike|harley|chopper|bobber)\b/i.test(titleLc)) return "motorcycle";
  if (/\b(boat|sailboat|jet\s*ski|pwc)\b/i.test(titleLc)) return "boat";
  if (/\b(tractor|john\s*deere|kubota|massey|allis)\b/i.test(titleLc)) return "tractor";
  if (/\b(trailer|camper|airstream|rv)\b/i.test(titleLc)) return "trailer";
  if (/\b(atv|utv|side.by.side|quad|polaris|can.am)\b/i.test(titleLc)) return "atv";
  if (/\b(bus|school\s*bus)\b/i.test(titleLc)) return "bus";
  if (/\b(forklift|crane|excavator)\b/i.test(titleLc)) return "other";

  // Van check
  if (/\bminivan\b/i.test(titleLc)) return "van";
  if (/\b(cargo\s*van|van)\b/i.test(titleLc)) return "van";
  for (const vm of VAN_MODELS) {
    if (modelLc.includes(vm)) return "van";
  }

  // SUV check (before truck because some overlap)
  if (/\bsport\s*utility\b/i.test(titleLc)) return "suv";
  for (const sm of SUV_MODELS) {
    if (modelLc.includes(sm) || modelLc === sm) return "suv";
  }

  // Truck check
  if (/\b(pickup|short\s*bed|long\s*bed|flatbed|stepside|fleetside|regular\s*cab|crew\s*cab|extended\s*cab)\b/i.test(titleLc)) return "truck";
  for (const tm of TRUCK_MODELS) {
    if (modelLc.includes(tm) || modelLc === tm) return "truck";
  }
  // Numbered tonnage patterns like "1500 Regular Cab"
  if (/\b\d{4}\s*(regular|crew|extended|quad|super)\s*cab\b/i.test(titleLc)) return "truck";

  // Default to car for everything else
  return "car";
}

// ─── Body Style Extraction ───────────────────────────────────────────
function extractBodyStyle(title, model, vehicleType) {
  const titleLc = (title || "").toLowerCase();

  // FB-specific suffixes (after the mid-dot separator)
  const fbBody = titleLc.match(/·\s*(.*)/);
  const afterDot = fbBody ? fbBody[1] : "";

  // Explicit body styles
  if (/\bcoupe\s*2d\b/i.test(titleLc)) return "Coupe";
  if (/\bsedan\s*4d\b/i.test(titleLc)) return "Sedan";
  if (/\bconvertible\b/i.test(titleLc)) return "Convertible";
  if (/\broadster\b/i.test(titleLc)) return "Roadster";
  if (/\bhardtop\b/i.test(titleLc)) return "Hardtop";
  if (/\bfastback\b/i.test(titleLc)) return "Fastback";
  if (/\bhatchback\b/i.test(titleLc)) return "Hatchback";
  if (/\bwagon\b/i.test(titleLc)) return "Wagon";
  if (/\bminivan\b/i.test(titleLc)) return "Minivan";
  if (/\bsport\s*utility\s*4d\b/i.test(titleLc)) return "SUV";
  if (/\bsport\s*utility\b/i.test(titleLc)) return "SUV";

  // Truck bed styles
  if (/\bshort\s*bed\b/i.test(titleLc) && /\bstepside\b/i.test(titleLc)) return "Shortbed Stepside";
  if (/\bshort\s*bed\b/i.test(titleLc)) return "Shortbed";
  if (/\blong\s*bed\b/i.test(titleLc)) return "Longbed";
  if (/\bstepside\b/i.test(titleLc)) return "Stepside";
  if (/\bfleetside\b/i.test(titleLc)) return "Fleetside";

  // Cab types (for trucks)
  if (/\bcrew\s*cab\b/i.test(titleLc)) return "Crew Cab";
  if (/\bext(?:ended)?\s*cab\b/i.test(titleLc)) return "Extended Cab";
  if (/\bregular\s*cab\b/i.test(titleLc)) return "Regular Cab";

  // Pickup
  if (/\bpickup\b/i.test(titleLc)) return "Pickup";

  return null;
}

// ─── Drivetrain Extraction ───────────────────────────────────────────
function extractDrivetrain(title, model) {
  const titleLc = (title || "").toLowerCase();
  const modelLc = (model || "").toLowerCase();

  // Explicit in title
  if (/\b4x4\b/i.test(titleLc) || /\b4wd\b/i.test(titleLc) || /\bfour\s*wheel\b/i.test(titleLc)) return "4WD";
  if (/\bawd\b/i.test(titleLc) || /\ball\s*wheel\b/i.test(titleLc)) return "AWD";
  if (/\b2wd\b/i.test(titleLc) || /\brwd\b/i.test(titleLc)) return "RWD";
  if (/\bfwd\b/i.test(titleLc) || /\bfront\s*wheel\b/i.test(titleLc)) return "FWD";

  // Infer from model name
  // K-series Chevy/GMC = 4WD
  if (/\bk[- ]?\d/i.test(modelLc) || /\bk5\b/i.test(modelLc)) return "4WD";
  // C-series Chevy/GMC = RWD
  if (/\bc[- ]?\d/i.test(modelLc) && /\b(c[- ]?10|c[- ]?20|c[- ]?30|c\/k\s*\d)/i.test(modelLc)) return "RWD";

  // Ford W-series = 4WD, D-series = RWD
  if (/\bw\d{2,3}\b/i.test(modelLc)) return "4WD";

  // Common 4WD vehicles
  if (/\b(blazer|jimmy|bronco|scout|wagoneer|4runner|land cruiser|defender|range rover|fj\d+|h[123])\b/i.test(modelLc)) return "4WD";

  // Corvette, Camaro, Mustang, etc = RWD
  if (/\b(corvette|camaro|mustang|charger|challenger|firebird|trans am|gto|chevelle|nova|dart|barracuda|cuda)\b/i.test(modelLc)) return "RWD";

  return null;
}

// ─── Trim Extraction ─────────────────────────────────────────────────
function extractTrim(title, model) {
  const titleLc = (title || "").toLowerCase();

  // Chevy/GMC truck trims
  const trims = [
    [/\bsilverado\b/i, "Silverado"],
    [/\bscottsdale\b/i, "Scottsdale"],
    [/\bcheyenne\s*super\b/i, "Cheyenne Super"],
    [/\bcheyenne\b/i, "Cheyenne"],
    [/\bcustom\s*deluxe\b/i, "Custom Deluxe"],
    [/\bsierra\s*classic\b/i, "Sierra Classic"],
    [/\bsierra\s*grande\b/i, "Sierra Grande"],
    [/\bhigh\s*sierra\b/i, "High Sierra"],
    [/\bbig\s*10\b/i, "Big 10"],
    // Car trims
    [/\b(?:·\s*)?ss\b/i, "SS"],
    [/\b(?:·\s*)?rs\b/i, "RS"],
    [/\b(?:·\s*)?z28\b/i, "Z28"],
    [/\b(?:·\s*)?z\/28\b/i, "Z/28"],
    [/\b(?:·\s*)?gt\b/i, "GT"],
    [/\b(?:·\s*)?gto\b/i, "GTO"],
    [/\b(?:·\s*)?rt\b/i, "R/T"],
    [/\b(?:·\s*)?r\/t\b/i, "R/T"],
    [/\b(?:·\s*)?se\b/i, "SE"],
    [/\b(?:·\s*)?le\b/i, "LE"],
    [/\b(?:·\s*)?ls\b(?!\d)/i, "LS"],
    [/\b(?:·\s*)?lt\b(?!\d)/i, "LT"],
    [/\b(?:·\s*)?xlt\b/i, "XLT"],
    [/\b(?:·\s*)?lariat\b/i, "Lariat"],
    [/\b(?:·\s*)?limited\b/i, "Limited"],
    [/\b(?:·\s*)?laramie\b/i, "Laramie"],
    [/\b(?:·\s*)?sport\b/i, "Sport"],
    [/\b(?:·\s*)?base\b/i, "Base"],
    [/\b(?:·\s*)?custom\b/i, "Custom"],
    [/\b(?:·\s*)?deluxe\b/i, "Deluxe"],
    [/\b(?:·\s*)?brougham\b/i, "Brougham"],
    [/\b(?:·\s*)?royale\b/i, "Royale"],
    [/\b(?:·\s*)?calais\b/i, "Calais"],
    [/\bcounty\s*classic\b/i, "County Classic"],
    [/\b(?:·\s*)?carrera\b/i, "Carrera"],
    [/\b(?:·\s*)?turbo\b/i, "Turbo"],
    [/\b(?:·\s*)?targa\b/i, "Targa"],
    [/\btrans\s*am\b/i, "Trans Am"],
    [/\b(?:·\s*)?mach\s*1\b/i, "Mach 1"],
    [/\b(?:·\s*)?boss\s*\d{3}\b/i, null], // captured below
    [/\b(?:·\s*)?shelby\b/i, "Shelby"],
    [/\b(?:·\s*)?cobra\b/i, "Cobra"],
  ];

  for (const [pattern, trimName] of trims) {
    const m = titleLc.match(pattern);
    if (m) {
      if (trimName === null) return m[0].trim(); // return matched text
      // Don't match "SS" if it's part of model name like "Monte Carlo SS" (already in model)
      if ((model || "").toLowerCase().includes(trimName.toLowerCase())) continue;
      return trimName;
    }
  }

  return null;
}

// ─── Engine Inference ────────────────────────────────────────────────
function extractEngine(title, model, year, make) {
  const titleLc = (title || "").toLowerCase();

  // Explicit engine mentions in title
  const engineMatch = titleLc.match(/\b(\d{3})\s*(ci|cubic\s*inch|engine|motor|big\s*block|small\s*block|v8|v6)\b/i);
  if (engineMatch) return `${engineMatch[1]}ci V8`;

  // Displacement mentions
  if (/\b454\b/.test(titleLc)) return "454ci V8";
  if (/\b427\b/.test(titleLc)) return "427ci V8";
  if (/\b396\b/.test(titleLc)) return "396ci V8";
  if (/\b383\b/.test(titleLc)) return "383ci V8";
  if (/\b350\b/.test(titleLc) && !/\bf-?350\b/i.test(titleLc)) return "350ci V8";
  if (/\b327\b/.test(titleLc)) return "327ci V8";
  if (/\b302\b/.test(titleLc) && !/\bz\/302\b/i.test(titleLc)) return "302ci V8";
  if (/\b289\b/.test(titleLc)) return "289ci V8";

  // Named engines
  if (/\bhemi\b/i.test(titleLc)) return "Hemi V8";
  if (/\bflathead\b/i.test(titleLc)) return "Flathead V8";
  if (/\bcummins\b/i.test(titleLc)) return "Cummins Diesel";
  if (/\bduramax\b/i.test(titleLc)) return "Duramax Diesel";
  if (/\bpowerstroke\b/i.test(titleLc)) return "Power Stroke Diesel";
  if (/\b(big\s*block|bb)\b/i.test(titleLc)) return "Big Block V8";
  if (/\b(small\s*block|sbc)\b/i.test(titleLc)) return "Small Block V8";

  // L-code engines
  if (/\bl82\b/i.test(titleLc)) return "L82 350ci V8";
  if (/\bl48\b/i.test(titleLc)) return "L48 350ci V8";
  if (/\bls6\b/i.test(titleLc)) return "LS6 454ci V8";

  // Displacement in liters
  const literMatch = titleLc.match(/\b(\d\.\d)\s*l\b/i);
  if (literMatch) return `${literMatch[1]}L`;

  // V8/V6/I6 mention
  if (/\bv8\b/i.test(titleLc)) return "V8";
  if (/\bv6\b/i.test(titleLc)) return "V6";
  if (/\b(straight|inline)\s*6\b/i.test(titleLc) || /\bi6\b/i.test(titleLc)) return "Inline 6";

  return null;
}

// ─── Transmission Extraction ─────────────────────────────────────────
function extractTransmission(title) {
  const titleLc = (title || "").toLowerCase();

  // Specific transmissions
  if (/\b4l60e?\b/i.test(titleLc)) return "4L60 Automatic";
  if (/\b4l80e?\b/i.test(titleLc)) return "4L80 Automatic";
  if (/\b700r4\b/i.test(titleLc)) return "700R4 Automatic";
  if (/\bth350\b/i.test(titleLc) || /\bturbo\s*350\b/i.test(titleLc)) return "TH350 Automatic";
  if (/\bth400\b/i.test(titleLc) || /\bturbo\s*400\b/i.test(titleLc)) return "TH400 Automatic";
  if (/\bpowerglide\b/i.test(titleLc)) return "Powerglide Automatic";
  if (/\bmuncie\b/i.test(titleLc)) return "Muncie 4-Speed Manual";

  // Speed-based
  if (/\b5\s*-?\s*speed\s*(manual|stick)?\b/i.test(titleLc)) return "5-Speed Manual";
  if (/\b4\s*-?\s*speed\s*(manual|stick)?\b/i.test(titleLc)) return "4-Speed Manual";
  if (/\b3\s*-?\s*speed\b/i.test(titleLc) || /\b3 on the tree\b/i.test(titleLc)) return "3-Speed Manual";
  if (/\b6\s*-?\s*speed\s*(manual|stick)?\b/i.test(titleLc)) return "6-Speed Manual";

  // Generic
  if (/\bstick\s*shift\b/i.test(titleLc) || /\bmanual\b/i.test(titleLc) || /\bstandard\b/i.test(titleLc)) return "Manual";
  if (/\bautomatic\b/i.test(titleLc) || /\bauto\b/i.test(titleLc)) return "Automatic";

  return null;
}

// ─── Condition / Special Features ────────────────────────────────────
function extractCondition(title) {
  const titleLc = (title || "").toLowerCase();

  if (/\bbarn\s*find\b/i.test(titleLc)) return "barn find";
  if (/\bproject\b/i.test(titleLc)) return "project";
  if (/\brestored\b/i.test(titleLc)) return "restored";
  if (/\boriginal\b/i.test(titleLc)) return "original";
  if (/\bruns\s*(?:and|&)\s*drives\b/i.test(titleLc)) return "runs and drives";

  return null;
}

function extractSpecialFeatures(title) {
  const features = [];
  const titleLc = (title || "").toLowerCase();

  if (/\bt-?tops?\b/i.test(titleLc)) features.push("T-tops");
  if (/\b4x4\b/i.test(titleLc)) features.push("4x4");
  if (/\bconvertible\b/i.test(titleLc)) features.push("Convertible");
  if (/\bbig\s*block\b/i.test(titleLc)) features.push("Big Block");
  if (/\bsmall\s*block\b/i.test(titleLc)) features.push("Small Block");
  if (/\bls\s*swap/i.test(titleLc)) features.push("LS Swap");
  if (/\bmatching\s*numbers?\b/i.test(titleLc)) features.push("Matching Numbers");
  if (/\blow\s*miles?\b/i.test(titleLc) || /\blow\s*mileage\b/i.test(titleLc)) features.push("Low Mileage");

  return features.length > 0 ? features.join(", ") : null;
}

// =====================================================================
// MAIN
// =====================================================================
async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  FB Saved — Rule-Based Enrichment ${DRY_RUN ? "(DRY RUN)" : ""}`);
  console.log(`${"=".repeat(60)}\n`);

  const client = await pool.connect();
  try {
    // Get all FB saved vehicles
    const { rows: vehicles } = await client.query(`
      SELECT v.id, v.year, v.make, v.model, v.listing_title,
             v.asking_price, v.description,
             v.transmission, v.drivetrain, v.body_style,
             v.engine_type, v.color, v.vin,
             v.origin_metadata
      FROM vehicles v
      WHERE v.source = 'facebook-saved' AND v.deleted_at IS NULL
      ORDER BY v.year
    `);

    console.log(`  Total vehicles: ${vehicles.length}\n`);

    // Before stats
    const before = {
      body_style: vehicles.filter((v) => v.body_style).length,
      drivetrain: vehicles.filter((v) => v.drivetrain).length,
      transmission: vehicles.filter((v) => v.transmission).length,
      engine_type: vehicles.filter((v) => v.engine_type).length,
    };
    console.log(`  Before: body:${before.body_style} drive:${before.drivetrain} trans:${before.transmission} engine:${before.engine_type}`);

    let updatedCount = 0;
    let fieldsAdded = 0;
    let evidenceWritten = 0;

    for (const v of vehicles) {
      const title = v.listing_title || `${v.year} ${v.make} ${v.model}`;
      const updates = [];
      const values = [];
      let paramIdx = 1;
      const evidenceRows = [];

      // ─── Vehicle Type ──────────────────────────────────────
      const vtype = classifyVehicleType(v.make, v.model, title);

      // ─── Body Style ────────────────────────────────────────
      if (!v.body_style) {
        const bs = extractBodyStyle(title, v.model, vtype);
        if (bs) {
          updates.push(`body_style = $${paramIdx++}`);
          values.push(bs);
          evidenceRows.push({ field: "body_style", value: bs, context: `Rule-based extraction from FB title: "${title}"` });
        }
      }

      // ─── Drivetrain ────────────────────────────────────────
      if (!v.drivetrain) {
        const dt = extractDrivetrain(title, v.model);
        if (dt) {
          updates.push(`drivetrain = $${paramIdx++}`);
          values.push(dt);
          evidenceRows.push({ field: "drivetrain", value: dt, context: `Rule-based inference from model/title: "${title}"` });
        }
      }

      // ─── Transmission ──────────────────────────────────────
      if (!v.transmission) {
        const tr = extractTransmission(title);
        if (tr) {
          updates.push(`transmission = $${paramIdx++}`);
          values.push(tr);
          evidenceRows.push({ field: "transmission", value: tr, context: `Rule-based extraction from FB title: "${title}"` });
        }
      }

      // ─── Engine ────────────────────────────────────────────
      if (!v.engine_type) {
        const eng = extractEngine(title, v.model, v.year, v.make);
        if (eng) {
          updates.push(`engine_type = $${paramIdx++}`);
          values.push(eng);
          evidenceRows.push({ field: "engine_type", value: eng, context: `Rule-based extraction from FB title: "${title}"` });
        }
      }

      // ─── Write updates ─────────────────────────────────────
      if (updates.length > 0 && !DRY_RUN) {
        values.push(v.id);
        await client.query(
          `UPDATE vehicles SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
          values
        );
        fieldsAdded += updates.length;
        updatedCount++;

        // Write field_evidence
        for (const ev of evidenceRows) {
          await client.query(
            `INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
             VALUES ($1, $2, $3, 'rule_based_title_parse', 75, $4, 'accepted')
             ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING`,
            [v.id, ev.field, ev.value, ev.context]
          );
          evidenceWritten++;
        }
      } else if (updates.length > 0) {
        fieldsAdded += updates.length;
        updatedCount++;
      }

      // ─── Update origin_metadata with extra info ────────────
      const om = v.origin_metadata || {};
      let metaChanged = false;

      const trim = extractTrim(title, v.model);
      if (trim && !om.trim) {
        om.trim = trim;
        metaChanged = true;
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
             VALUES ($1, 'trim', $2, 'rule_based_title_parse', 75, $3, 'accepted')
             ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING`,
            [v.id, trim, `Rule-based extraction from FB title: "${title}"`]
          );
          evidenceWritten++;
        }
      }

      const condition = extractCondition(title);
      if (condition && !om.condition_notes) {
        om.condition_notes = condition;
        metaChanged = true;
      }

      const features = extractSpecialFeatures(title);
      if (features && !om.special_features) {
        om.special_features = features;
        metaChanged = true;
      }

      if (vtype && !om.vehicle_type) {
        om.vehicle_type = vtype;
        om.is_automobile = ["car", "truck", "suv", "van"].includes(vtype);
        metaChanged = true;
      }

      if (metaChanged && !DRY_RUN) {
        om.rule_enriched_at = new Date().toISOString();
        await client.query(
          `UPDATE vehicles SET origin_metadata = $1 WHERE id = $2`,
          [JSON.stringify(om), v.id]
        );
      }
    }

    // After stats
    if (!DRY_RUN) {
      const { rows: afterVehicles } = await client.query(`
        SELECT
          count(body_style) as body, count(drivetrain) as drive,
          count(transmission) as trans, count(engine_type) as engine
        FROM vehicles WHERE source = 'facebook-saved' AND deleted_at IS NULL
      `);
      const a = afterVehicles[0];
      console.log(`  After:  body:${a.body} drive:${a.drive} trans:${a.trans} engine:${a.engine}`);
    }

    console.log(`\n  Vehicles updated: ${updatedCount}`);
    console.log(`  Fields added: ${fieldsAdded}`);
    console.log(`  Evidence rows: ${evidenceWritten}`);

    // Vehicle type breakdown
    const typeBreakdown = {};
    for (const v of vehicles) {
      const vtype = classifyVehicleType(v.make, v.model, v.listing_title);
      typeBreakdown[vtype] = (typeBreakdown[vtype] || 0) + 1;
    }
    console.log(`\n  Vehicle types: ${JSON.stringify(typeBreakdown)}`);

    // Lock check
    const { rows: locks } = await client.query(
      `SELECT count(*) as cnt FROM pg_stat_activity WHERE wait_event_type='Lock'`
    );
    console.log(`  Lock check: ${locks[0].cnt} waiting`);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  COMPLETE`);
    console.log(`${"=".repeat(60)}\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
