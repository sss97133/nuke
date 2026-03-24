#!/usr/bin/env node
/**
 * enrich-fb-batch.mjs
 *
 * Comprehensive batch enrichment for ~483 Facebook Saved vehicles.
 * Three-phase pipeline:
 *   Phase 1: Propagate marketplace_listing descriptions + images to vehicles
 *   Phase 2: Regex-parse all descriptions for VIN, engine, trans, drivetrain, etc.
 *   Phase 3: Ollama AI extraction from titles for trim, body_style, engine, trans, drivetrain
 *
 * All enrichments written as field_evidence with provenance tracking.
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-fb-batch.mjs                   # full run
 *   dotenvx run -- node scripts/enrich-fb-batch.mjs --phase 1         # just propagation
 *   dotenvx run -- node scripts/enrich-fb-batch.mjs --phase 2         # just desc parsing
 *   dotenvx run -- node scripts/enrich-fb-batch.mjs --phase 3         # just AI extraction
 *   dotenvx run -- node scripts/enrich-fb-batch.mjs --dry-run         # preview only
 *   dotenvx run -- node scripts/enrich-fb-batch.mjs --limit 50        # limit batch
 *   dotenvx run -- node scripts/enrich-fb-batch.mjs --model qwen2.5:7b # faster model
 */

import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

// ─── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const phaseArg = args.find((_, i, a) => a[i - 1] === "--phase");
const PHASE = phaseArg ? parseInt(phaseArg) : 0; // 0 = all phases
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === "--limit") || "5000");
const OLLAMA_MODEL = args.find((_, i, a) => a[i - 1] === "--model") || "qwen3:30b-a3b";
const OLLAMA_URL = process.env.OLLAMA_HOST || "http://localhost:11434";
const AI_BATCH_SIZE = 10;

const pool = new Pool({
  host: "aws-0-us-west-1.pooler.supabase.com",
  port: 6543,
  user: `postgres.${process.env.SUPABASE_PROJECT_ID || "qkgaybvrernstplzjaam"}`,
  password: process.env.SUPABASE_DB_PASSWORD || "RbzKq32A0uhqvJMQ",
  database: "postgres",
  max: 3,
  statement_timeout: 60000,
});

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// ─── Stats tracker ───────────────────────────────────────────────────
const stats = {
  phase1: { descriptions_propagated: 0, images_propagated: 0, vehicle_images_created: 0 },
  phase2: { vehicles_parsed: 0, fields_extracted: 0, field_evidence_written: 0 },
  phase3: { vehicles_processed: 0, evidence_written: 0, automobiles: 0, non_automobiles: 0 },
};

// =====================================================================
// PHASE 1: Propagate marketplace_listings data to vehicle records
// =====================================================================
async function phase1(client) {
  console.log("\n━━━ PHASE 1: Propagate marketplace_listing data ━━━\n");

  const { rows: listings } = await client.query(`
    SELECT ml.vehicle_id, ml.description, ml.all_images, ml.mileage,
           ml.transmission, ml.exterior_color, ml.price,
           v.description AS v_desc, v.mileage AS v_mileage,
           v.transmission AS v_trans, v.color AS v_color,
           v.primary_image_url AS v_img
    FROM marketplace_listings ml
    JOIN vehicles v ON v.id = ml.vehicle_id
    WHERE v.source = 'facebook-saved' AND v.deleted_at IS NULL
      AND ml.description IS NOT NULL
  `);

  console.log(`  Found ${listings.length} marketplace_listings with descriptions`);

  for (const l of listings) {
    const updates = [];
    const values = [];
    let paramIdx = 1;

    // Propagate description if vehicle doesn't have one
    if (l.description && !l.v_desc) {
      updates.push(`description = $${paramIdx++}`);
      values.push(l.description);
      stats.phase1.descriptions_propagated++;
    }

    // Propagate mileage
    if (l.mileage && !l.v_mileage) {
      updates.push(`mileage = $${paramIdx++}`);
      values.push(l.mileage);
    }

    // Propagate transmission
    if (l.transmission && !l.v_trans) {
      updates.push(`transmission = $${paramIdx++}`);
      values.push(l.transmission);
    }

    // Propagate color
    if (l.exterior_color && !l.v_color) {
      updates.push(`color = $${paramIdx++}`);
      values.push(l.exterior_color);
    }

    if (updates.length > 0 && !DRY_RUN) {
      values.push(l.vehicle_id);
      await client.query(
        `UPDATE vehicles SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
        values
      );
    }

    // Propagate images
    if (l.all_images && Array.isArray(l.all_images) && l.all_images.length > 0 && !l.v_img) {
      const imageUrls = l.all_images.filter((u) => typeof u === "string" && u.startsWith("http"));
      if (imageUrls.length > 0 && !DRY_RUN) {
        // Check if vehicle already has images
        const { rows: existingImgs } = await client.query(
          `SELECT count(*) as cnt FROM vehicle_images WHERE vehicle_id = $1`,
          [l.vehicle_id]
        );

        if (parseInt(existingImgs[0].cnt) === 0) {
          for (let i = 0; i < Math.min(imageUrls.length, 12); i++) {
            await client.query(
              `INSERT INTO vehicle_images (vehicle_id, image_url, is_primary, source)
               VALUES ($1, $2, $3, 'facebook-saved')
               ON CONFLICT DO NOTHING`,
              [l.vehicle_id, imageUrls[i], i === 0]
            );
            stats.phase1.vehicle_images_created++;
          }

          // Set primary image
          await client.query(
            `UPDATE vehicles SET primary_image_url = $1 WHERE id = $2 AND primary_image_url IS NULL`,
            [imageUrls[0], l.vehicle_id]
          );
          stats.phase1.images_propagated++;
        }
      }
    }
  }

  console.log(`  Descriptions propagated: ${stats.phase1.descriptions_propagated}`);
  console.log(`  Images propagated: ${stats.phase1.images_propagated} vehicles (${stats.phase1.vehicle_images_created} images)`);
}

// =====================================================================
// PHASE 2: Regex-parse descriptions for structured data
// =====================================================================

/** Parse structured vehicle details from seller descriptions */
function parseDescription(desc) {
  const result = {
    vin: null,
    engine: null,
    trim: null,
    body_style: null,
    title_status: null,
    drivetrain: null,
    mileage: null,
    transmission: null,
    exterior_color: null,
    condition: null,
  };

  // VIN -- 17 alphanumeric, no I/O/Q
  const vinMatch = desc.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) result.vin = vinMatch[1];

  // Engine patterns
  const enginePatterns = [
    /\b(\d{3})\s*(ci|cubic\s*inch|cu\.?\s*in)/i,
    /\b(small|big)\s*block\s*(\d{3})?/i,
    /\b(\d\.\d)\s*[lL]\b/,
    /\b(v-?[468]|inline[- ]?[46]|flat[- ]?[46]|i[46])\b/i,
    /\b(\d{3,4})\s*(v8|v6|v4)\b/i,
    /\b(\d{3})\s*(motor|engine)\b/i,
    /\b(ls\d|lt\d|sbc|bbc|hemi|flathead|windsor|cleveland|coyote|vortec|ecoboost|cummins|duramax|powerstroke)\b/i,
  ];
  for (const p of enginePatterns) {
    const m = desc.match(p);
    if (m) {
      result.engine = m[0].trim();
      break;
    }
  }

  // Trim / package
  const trimPatterns = [
    /\b(scottsdale|cheyenne|silverado|custom\s*deluxe|sierra\s*classic|sierra\s*grande|high\s*sierra|big\s*10)\b/i,
    /\b(sport|gt|ss|rs|z28|z\/28|rt|r\/t|srt|sr5|limited|xlt|lariat|king\s*ranch|laramie|sle|slt)\b/i,
    /\b(deluxe|special|custom|brougham|calais|royale)\b/i,
  ];
  for (const p of trimPatterns) {
    const m = desc.match(p);
    if (m) {
      result.trim = m[1].trim();
      break;
    }
  }

  // Body style
  const bodyPatterns = [
    /\b(short\s*(?:bed|box)|long\s*(?:bed|box)|stepside|fleetside|step\s*side|fleet\s*side)\b/i,
    /\b(crew\s*cab|ext(?:ended)?\s*cab|regular\s*cab|single\s*cab|quad\s*cab|super\s*cab)\b/i,
    /\b(convertible|hardtop|fastback|hatchback|wagon|coupe|sedan|roadster|pickup|SUV|van)\b/i,
  ];
  for (const p of bodyPatterns) {
    const m = desc.match(p);
    if (m) {
      result.body_style = m[1].trim();
      break;
    }
  }

  // Title status
  if (/\bclean\s*title\b/i.test(desc)) result.title_status = "clean";
  else if (/\bsalvage\s*title\b/i.test(desc)) result.title_status = "salvage";
  else if (/\brebuilt\s*title\b/i.test(desc)) result.title_status = "rebuilt";
  else if (/\bno\s*title\b/i.test(desc)) result.title_status = "none";

  // Drivetrain
  if (/\b4x4\b|4wd\b|four\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "4WD";
  else if (/\b2wd\b|2x4\b|two\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "2WD";
  else if (/\bawd\b|all\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "AWD";
  else if (/\brwd\b|rear\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "RWD";
  else if (/\bfwd\b|front\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "FWD";

  // Mileage
  const kmMatch = desc.match(/([\d,.]+)\s*[Kk]\s*(?:miles?)?/);
  if (kmMatch) result.mileage = Math.round(parseFloat(kmMatch[1].replace(/,/g, "")) * 1000);
  else {
    const plainMatch = desc.match(/([\d,]+)\s*miles?\b/i);
    if (plainMatch) result.mileage = parseInt(plainMatch[1].replace(/,/g, ""), 10);
  }

  // Transmission
  const transPatterns = [
    /\b(4l60e?|4l80e?|700r4|th350|th400|turbo\s*350|turbo\s*400|muncie|t5|t56|nv3500|nv4500|powerglide|c4|c6|aod)\b/i,
    /\b(\d)[- ]?speed\s*(manual|auto(?:matic)?|on the (?:tree|floor))?\b/i,
    /\b(automatic|manual|standard)\b/i,
    /\b(3 on the tree|3 on the floor|4 on the floor)\b/i,
  ];
  for (const p of transPatterns) {
    const m = desc.match(p);
    if (m) {
      result.transmission = m[0].trim();
      break;
    }
  }

  // Color
  const colorMatch = desc.match(
    /\b(black|white|red|blue|green|yellow|orange|silver|gray|grey|brown|tan|beige|gold|maroon|burgundy|cream|bronze|copper|teal|purple|charcoal)\b/i
  );
  if (colorMatch) result.exterior_color = colorMatch[1].toLowerCase();

  // Condition
  const conditionPatterns = [
    /\b(barn\s*find|project\s*(?:car|truck|vehicle)?|runs\s*(?:and|&)\s*drives|needs\s*(?:work|restoration|tlc))\b/i,
    /\b(restored|frame[- ]?off|rotisserie|concours|show\s*(?:car|quality))\b/i,
    /\b(driver|daily\s*driver|survivor|original|all\s*original)\b/i,
    /\b(rust\s*free|no\s*rust|solid\s*(?:body|frame))\b/i,
  ];
  for (const p of conditionPatterns) {
    const m = desc.match(p);
    if (m) {
      result.condition = m[0].trim().toLowerCase();
      break;
    }
  }

  return result;
}

async function phase2(client) {
  console.log("\n━━━ PHASE 2: Parse descriptions for structured data ━━━\n");

  // Get vehicles that have descriptions (either from vehicle or marketplace_listing)
  const { rows: vehicles } = await client.query(`
    SELECT v.id, v.year, v.make, v.model, v.description,
           v.mileage, v.transmission, v.drivetrain, v.body_style,
           v.engine_type, v.color, v.vin,
           ml.description AS ml_desc
    FROM vehicles v
    LEFT JOIN marketplace_listings ml ON ml.vehicle_id = v.id
    WHERE v.source = 'facebook-saved' AND v.deleted_at IS NULL
      AND (v.description IS NOT NULL OR ml.description IS NOT NULL)
    LIMIT $1
  `, [LIMIT]);

  console.log(`  Found ${vehicles.length} vehicles with descriptions to parse`);

  for (const v of vehicles) {
    const desc = v.description || v.ml_desc;
    if (!desc || desc.length < 10) continue;

    const parsed = parseDescription(desc);
    const vehicleUpdates = [];
    const vehicleValues = [];
    const evidenceRows = [];
    let paramIdx = 1;

    // Only update fields that are currently null on the vehicle
    if (parsed.vin && !v.vin) {
      vehicleUpdates.push(`vin = $${paramIdx++}`);
      vehicleValues.push(parsed.vin);
      evidenceRows.push({ field: "vin", value: parsed.vin, context: "Regex-extracted from FB seller description" });
    }
    if (parsed.engine && !v.engine_type) {
      vehicleUpdates.push(`engine_type = $${paramIdx++}`);
      vehicleValues.push(parsed.engine);
      evidenceRows.push({ field: "engine_type", value: parsed.engine, context: "Regex-extracted from FB seller description" });
    }
    if (parsed.transmission && !v.transmission) {
      vehicleUpdates.push(`transmission = $${paramIdx++}`);
      vehicleValues.push(parsed.transmission);
      evidenceRows.push({ field: "transmission", value: parsed.transmission, context: "Regex-extracted from FB seller description" });
    }
    if (parsed.drivetrain && !v.drivetrain) {
      vehicleUpdates.push(`drivetrain = $${paramIdx++}`);
      vehicleValues.push(parsed.drivetrain);
      evidenceRows.push({ field: "drivetrain", value: parsed.drivetrain, context: "Regex-extracted from FB seller description" });
    }
    if (parsed.body_style && !v.body_style) {
      vehicleUpdates.push(`body_style = $${paramIdx++}`);
      vehicleValues.push(parsed.body_style);
      evidenceRows.push({ field: "body_style", value: parsed.body_style, context: "Regex-extracted from FB seller description" });
    }
    if (parsed.exterior_color && !v.color) {
      vehicleUpdates.push(`color = $${paramIdx++}`);
      vehicleValues.push(parsed.exterior_color);
      evidenceRows.push({ field: "color", value: parsed.exterior_color, context: "Regex-extracted from FB seller description" });
    }
    if (parsed.mileage && !v.mileage) {
      vehicleUpdates.push(`mileage = $${paramIdx++}`);
      vehicleValues.push(parsed.mileage);
      evidenceRows.push({ field: "mileage", value: String(parsed.mileage), context: "Regex-extracted from FB seller description" });
    }

    if (vehicleUpdates.length > 0) {
      stats.phase2.fields_extracted += vehicleUpdates.length;

      if (!DRY_RUN) {
        vehicleValues.push(v.id);
        await client.query(
          `UPDATE vehicles SET ${vehicleUpdates.join(", ")} WHERE id = $${paramIdx}`,
          vehicleValues
        );

        // Write field_evidence
        for (const ev of evidenceRows) {
          await client.query(
            `INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
             VALUES ($1, $2, $3, 'description_regex_parse', 65, $4, 'accepted')
             ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING`,
            [v.id, ev.field, ev.value, ev.context]
          );
          stats.phase2.field_evidence_written++;
        }
      }
      stats.phase2.vehicles_parsed++;
    }

    // Write title_status and condition to origin_metadata if found
    if ((parsed.title_status || parsed.condition || parsed.trim) && !DRY_RUN) {
      const { rows: meta } = await client.query(
        `SELECT origin_metadata FROM vehicles WHERE id = $1`,
        [v.id]
      );
      const om = meta[0]?.origin_metadata || {};
      if (parsed.title_status) om.title_status = parsed.title_status;
      if (parsed.condition) om.condition_notes = parsed.condition;
      if (parsed.trim) om.trim_from_desc = parsed.trim;
      om.desc_parsed_at = new Date().toISOString();

      await client.query(
        `UPDATE vehicles SET origin_metadata = $1 WHERE id = $2`,
        [JSON.stringify(om), v.id]
      );
    }
  }

  console.log(`  Vehicles with new data: ${stats.phase2.vehicles_parsed}`);
  console.log(`  Fields extracted: ${stats.phase2.fields_extracted}`);
  console.log(`  Field evidence rows: ${stats.phase2.field_evidence_written}`);
}

// =====================================================================
// PHASE 3: Ollama AI enrichment from titles
// =====================================================================

const SYSTEM_PROMPT = `You are a vehicle data extraction expert for a collector vehicle database. Given Facebook Marketplace listing titles, extract maximum structured data.

For each vehicle, return a JSON object with ALL of these fields (use null for unknown):
- year (integer)
- make (string, standardized: "Chevrolet" not "Chevy", "Oldsmobile" not "Olds", "Mercury" not "Merc")
- model (string, specific: "K10" not "truck", "Camaro" not "car")
- trim (string or null: "Silverado", "Scottsdale", "SS", "GT", "SE", "Custom Deluxe", "Sport", etc.)
- body_style (string or null: "Shortbed Stepside", "Longbed Fleetside", "Coupe", "Convertible", "Sedan", "Wagon", "SUV", "Pickup", "Roadster", "Hardtop", "Fastback")
- engine (string or null: "350ci V8", "302 V8", "1.8L I4", "5.9L Cummins Diesel", "Flathead V8")
- transmission (string or null: "4-speed manual", "TH350 automatic", "3-on-the-tree", "automatic")
- drivetrain (string or null: "4WD", "RWD", "FWD", "AWD")
- vehicle_type (string: one of "car", "truck", "suv", "van", "motorcycle", "boat", "tractor", "atv", "trailer", "bus", "other")
- is_automobile (boolean: true ONLY for cars, trucks, SUVs, vans)
- condition_notes (string or null: "project", "restored", "barn find", "runs and drives", etc.)
- special_features (string or null: "matching numbers", "T-tops", "454 big block", "4x4", etc.)
- confidence (integer 0-100)

RULES:
- C10/C20/C30 = Chevrolet 2WD trucks (RWD). K10/K20/K30 = Chevrolet 4WD trucks.
- C15/C25/C35 = GMC 2WD trucks. K15/K25/K35 = GMC 4WD trucks.
- "350", "302", "454", "383", "427" = engine cubic inch displacements
- "3 on the tree" = 3-speed manual column shift
- "Squarebody" / "Square Body" = 1973-1987 Chevrolet/GMC C/K trucks
- "Shortbed" = short bed truck, "Stepside" = step-side bed
- If title says "· Coupe 2D" or "· Sedan 4D" that's the body style from FB
- Farm equipment, motorcycles, boats = set is_automobile: false
- For trucks: infer drivetrain from model (K=4WD, C=2WD). Infer body_style if "stepside", "fleetside", "shortbed", "longbed" present.
- If year is 2-digit like "'73" or "73", expand to full year (1973)

Return a JSON array. No markdown fences, no explanation, just the raw JSON array.`;

async function ollamaExtract(vehicles) {
  const input = vehicles
    .map((v, i) => {
      let entry = `${i + 1}. TITLE: "${v.listing_title || `${v.year} ${v.make} ${v.model}`}"`;
      if (v.asking_price) entry += ` | PRICE: $${v.asking_price}`;
      if (v.description) {
        const desc = v.description.substring(0, 250);
        entry += `\n   DESC: ${desc}`;
      }
      return entry;
    })
    .join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      options: { temperature: 0.1, num_predict: 8192 },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Extract from these ${vehicles.length} vehicle listings:\n\n${input}` },
      ],
    }),
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  let content = result.message?.content || "";

  // Strip <think>...</think> blocks (qwen3 thinking tokens)
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Parse JSON
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in response");

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    // Try fixing common issues
    try {
      return JSON.parse(
        jsonMatch[0].replace(/,\s*]/g, "]").replace(/,\s*}/g, "}")
      );
    } catch (e2) {
      throw new Error(`JSON parse failed: ${content.substring(0, 200)}`);
    }
  }
}

async function writeAIEvidence(client, vehicleId, extraction) {
  const fields = [];
  const sourceType = "ai_title_extraction";
  const conf = extraction.confidence || 70;

  const add = (fieldName, value, context) => {
    if (value === null || value === undefined || value === "") return;
    fields.push({ fieldName, value: String(value), context, confidence: conf });
  };

  add("vehicle_type", extraction.vehicle_type, "AI classification from FB title");
  add("is_automobile", String(extraction.is_automobile), "AI classification from FB title");
  if (extraction.trim) add("trim", extraction.trim, "AI extracted from FB title");
  if (extraction.body_style) add("body_style", extraction.body_style, "AI extracted from FB title");
  if (extraction.engine) add("engine_type", extraction.engine, "AI extracted from FB title/desc");
  if (extraction.transmission) add("transmission", extraction.transmission, "AI extracted from FB title/desc");
  if (extraction.drivetrain) add("drivetrain", extraction.drivetrain, "AI extracted from FB title/desc");
  if (extraction.condition_notes) add("condition", extraction.condition_notes, "AI inferred from FB title/desc");
  if (extraction.special_features) add("special_features", extraction.special_features, "AI extracted from FB title/desc");
  if (extraction.make) add("make_standardized", extraction.make, "AI standardized make name");

  for (const f of fields) {
    await client.query(
      `INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status, raw_extraction_data)
       VALUES ($1, $2, $3, $4, $5, $6, 'accepted', $7)
       ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING`,
      [
        vehicleId,
        f.fieldName,
        f.value,
        sourceType,
        f.confidence,
        f.context,
        JSON.stringify({ model: OLLAMA_MODEL, extraction_method: "ollama_local_batch" }),
      ]
    );
  }

  return fields.length;
}

async function updateVehicleFromAI(client, vehicleId, extraction, existing) {
  const updates = [];
  const values = [];
  let paramIdx = 1;

  // Non-automobiles: just tag them
  if (!extraction.is_automobile) {
    await client.query(
      `UPDATE vehicles SET source_listing_category = $1 WHERE id = $2`,
      [extraction.vehicle_type || "other", vehicleId]
    );
    return;
  }

  // Only fill null fields
  if (extraction.transmission && !existing.transmission) {
    updates.push(`transmission = $${paramIdx++}`);
    values.push(extraction.transmission);
  }
  if (extraction.drivetrain && !existing.drivetrain) {
    updates.push(`drivetrain = $${paramIdx++}`);
    values.push(extraction.drivetrain);
  }
  if (extraction.body_style && !existing.body_style) {
    updates.push(`body_style = $${paramIdx++}`);
    values.push(extraction.body_style);
  }
  if (extraction.engine && !existing.engine_type) {
    updates.push(`engine_type = $${paramIdx++}`);
    values.push(extraction.engine);
  }

  if (updates.length > 0) {
    values.push(vehicleId);
    await client.query(
      `UPDATE vehicles SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
      values
    );
  }

  // Write trim, condition, features to origin_metadata
  const { rows: meta } = await client.query(
    `SELECT origin_metadata FROM vehicles WHERE id = $1`,
    [vehicleId]
  );
  const om = meta[0]?.origin_metadata || {};
  let metaChanged = false;

  if (extraction.trim && !om.trim) {
    om.trim = extraction.trim;
    metaChanged = true;
  }
  if (extraction.condition_notes && !om.condition_notes) {
    om.condition_notes = extraction.condition_notes;
    metaChanged = true;
  }
  if (extraction.special_features && !om.special_features) {
    om.special_features = extraction.special_features;
    metaChanged = true;
  }
  if (extraction.vehicle_type) {
    om.vehicle_type = extraction.vehicle_type;
    metaChanged = true;
  }

  if (metaChanged) {
    om.ai_enriched_at = new Date().toISOString();
    om.ai_model = OLLAMA_MODEL;
    await client.query(
      `UPDATE vehicles SET origin_metadata = $1 WHERE id = $2`,
      [JSON.stringify(om), vehicleId]
    );
  }
}

async function phase3(client) {
  console.log("\n━━━ PHASE 3: Ollama AI enrichment from titles ━━━\n");

  // Check Ollama
  try {
    const health = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!health.ok) throw new Error("Not responding");
    console.log(`  Ollama connected (model: ${OLLAMA_MODEL})`);
  } catch (e) {
    console.error(`  ERROR: Ollama not running at ${OLLAMA_URL}. Skipping phase 3.`);
    return;
  }

  // Get ALL facebook-saved vehicles that haven't been AI-enriched
  const { rows: vehicles } = await client.query(`
    SELECT v.id, v.year, v.make, v.model, v.listing_title, v.asking_price,
           v.description, v.transmission, v.drivetrain, v.body_style, v.engine_type
    FROM vehicles v
    WHERE v.source = 'facebook-saved' AND v.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM field_evidence fe
        WHERE fe.vehicle_id = v.id AND fe.source_type = 'ai_title_extraction'
      )
    ORDER BY v.year
    LIMIT $1
  `, [LIMIT]);

  console.log(`  Found ${vehicles.length} vehicles to AI-enrich\n`);

  if (vehicles.length === 0) {
    console.log("  Nothing to do!");
    return;
  }

  if (DRY_RUN) {
    console.log("  DRY RUN -- first 10 titles:");
    vehicles.slice(0, 10).forEach((v) =>
      console.log(`    ${v.listing_title || `${v.year} ${v.make} ${v.model}`}`)
    );
    return;
  }

  const startTime = Date.now();

  for (let i = 0; i < vehicles.length; i += AI_BATCH_SIZE) {
    const batch = vehicles.slice(i, i + AI_BATCH_SIZE);
    const batchNum = Math.floor(i / AI_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(vehicles.length / AI_BATCH_SIZE);

    process.stdout.write(
      `  Batch ${batchNum}/${totalBatches} (${batch.length} vehicles)... `
    );

    try {
      const extractions = await ollamaExtract(batch);
      if (!extractions || extractions.length === 0) {
        console.log("empty response, skipping");
        continue;
      }

      for (let j = 0; j < Math.min(extractions.length, batch.length); j++) {
        const vehicle = batch[j];
        const extraction = extractions[j];

        const evidenceCount = await writeAIEvidence(client, vehicle.id, extraction);
        await updateVehicleFromAI(client, vehicle.id, extraction, vehicle);

        stats.phase3.evidence_written += evidenceCount;
        stats.phase3.vehicles_processed++;

        if (extraction.is_automobile) stats.phase3.automobiles++;
        else stats.phase3.non_automobiles++;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (stats.phase3.vehicles_processed / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(
        `${extractions.length} extracted | ${stats.phase3.evidence_written} evidence | ${rate}/s | ${elapsed}s`
      );
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }

    // Brief pause between batches
    if (i + AI_BATCH_SIZE < vehicles.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Vehicles processed: ${stats.phase3.vehicles_processed}`);
  console.log(`    Automobiles: ${stats.phase3.automobiles}`);
  console.log(`    Non-auto: ${stats.phase3.non_automobiles}`);
  console.log(`  Evidence rows: ${stats.phase3.evidence_written}`);
  console.log(`  Time: ${elapsed}s (${(stats.phase3.vehicles_processed / (elapsed / 1)).toFixed(1)}/sec)`);
}

// =====================================================================
// MAIN
// =====================================================================
async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  FB Saved Vehicles — Batch Enrichment`);
  console.log(`  ${DRY_RUN ? "DRY RUN" : "LIVE"} | Phase: ${PHASE || "ALL"} | Limit: ${LIMIT}`);
  console.log(`  Model: ${OLLAMA_MODEL}`);
  console.log(`${"=".repeat(60)}`);

  const client = await pool.connect();
  try {
    // Quick count
    const { rows: countRows } = await client.query(`
      SELECT count(*) as total,
             count(description) as with_desc,
             count(transmission) as with_trans,
             count(drivetrain) as with_drive,
             count(body_style) as with_body,
             count(engine_type) as with_engine,
             count(primary_image_url) as with_img
      FROM vehicles WHERE source = 'facebook-saved' AND deleted_at IS NULL
    `);
    const c = countRows[0];
    console.log(`\n  Before: ${c.total} vehicles — desc:${c.with_desc} trans:${c.with_trans} drive:${c.with_drive} body:${c.with_body} engine:${c.with_engine} img:${c.with_img}`);

    if (PHASE === 0 || PHASE === 1) await phase1(client);
    if (PHASE === 0 || PHASE === 2) await phase2(client);
    if (PHASE === 0 || PHASE === 3) await phase3(client);

    // After count
    const { rows: afterRows } = await client.query(`
      SELECT count(*) as total,
             count(description) as with_desc,
             count(transmission) as with_trans,
             count(drivetrain) as with_drive,
             count(body_style) as with_body,
             count(engine_type) as with_engine,
             count(primary_image_url) as with_img
      FROM vehicles WHERE source = 'facebook-saved' AND deleted_at IS NULL
    `);
    const a = afterRows[0];
    console.log(`\n  After:  ${a.total} vehicles — desc:${a.with_desc} trans:${a.with_trans} drive:${a.with_drive} body:${a.with_body} engine:${a.with_engine} img:${a.with_img}`);

    // Check lock impact
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
