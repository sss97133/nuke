#!/usr/bin/env node
/**
 * AI EXTRACTION FROM SNAPSHOTS — Local Haiku-powered universal extractor
 *
 * Reads markdown from listing_page_snapshots (populated by snapshot-to-markdown.mjs),
 * sends to Haiku for structured extraction, writes fields to vehicles table.
 * Works on ANY platform — no custom regex needed.
 *
 * Usage:
 *   dotenvx run -- node scripts/ai-extract-from-snapshots.mjs [options]
 *
 * Options:
 *   --platform <name>   Process only this platform (default: barrett-jackson)
 *   --batch <n>         Batch size (default: 20)
 *   --max <n>           Max vehicles to process (default: 1000)
 *   --parallel <n>      Concurrent API calls (default: 3)
 *   --dry-run           Extract but don't write to DB
 *   --cost-cap <n>      Max cost in dollars before stopping (default: 5)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.NUKE_CLAUDE_API;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Missing SUPABASE env vars"); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// CLI args
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : args[i + 1] || def; };
const hasFlag = (name) => args.includes(`--${name}`);

const PLATFORM = getArg("platform", "barrett-jackson");
const BATCH_SIZE = parseInt(getArg("batch", "20"), 10);
const MAX_TOTAL = parseInt(getArg("max", "1000"), 10);
const PARALLEL = parseInt(getArg("parallel", "3"), 10);
const DRY_RUN = hasFlag("dry-run");
const COST_CAP = parseFloat(getArg("cost-cap", "5"));

// ─── AI Extraction ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a vehicle data extraction expert. Extract structured data from the provided auction listing content.

Return ONLY a JSON object with these fields (use null for missing data):
{
  "year": number or null,
  "make": "string or null",
  "model": "string or null",
  "trim": "string or null",
  "vin": "string or null (17 chars, no I/O/Q)",
  "mileage": number or null,
  "engine_type": "string or null (e.g. '5.7L V8')",
  "horsepower": number or null,
  "torque": number or null,
  "transmission": "string or null (e.g. '4-Speed Manual')",
  "drivetrain": "string or null (RWD/FWD/AWD/4WD)",
  "body_style": "string or null (e.g. 'Coupe', 'Convertible')",
  "color": "string or null (exterior color)",
  "interior_color": "string or null",
  "sale_price": number or null (final hammer/sold price in USD, no commas),
  "description": "string or null (2-4 sentence summary)"
}

Rules:
- Extract ONLY from the content. Never guess.
- VINs must be exactly 17 characters.
- Prices = numbers only (the SOLD/HAMMER price, not bid/estimate).
- If "Reserve Not Met" or "Not Sold", sale_price = null.
- Description: summarize, don't copy.`;

async function callHaiku(content, url) {
  const truncated = content.length > 15000 ? content.slice(0, 15000) + "\n[truncated]" : content;
  const userMsg = `URL: ${url}\n\nListing content:\n${truncated}`;

  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      temperature: 0.0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Haiku API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  const costCents = (inputTokens * 1.0 + outputTokens * 5.0) / 1_000_000;
  const durationMs = Date.now() - start;

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { parsed: {}, costCents, durationMs, tokens: inputTokens + outputTokens };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // Clean nulls and empty strings
    const cleaned = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null || v === undefined || v === "null" || v === "" || v === "N/A") continue;
      cleaned[k] = v;
    }
    return { parsed: cleaned, costCents, durationMs, tokens: inputTokens + outputTokens };
  } catch {
    return { parsed: {}, costCents, durationMs, tokens: inputTokens + outputTokens };
  }
}

// ─── Process Vehicles ───────────────────────────────────────────────────

const FIELD_MAP = {
  year: "year", make: "make", model: "model", trim: "trim",
  vin: "vin", mileage: "mileage", horsepower: "horsepower", torque: "torque",
  engine_type: "engine_type", transmission: "transmission", drivetrain: "drivetrain",
  body_style: "body_style", color: "color", interior_color: "interior_color",
  sale_price: "sale_price", description: "description",
};

async function processVehicle(vehicle, snapshotUrl, markdown) {
  const { parsed, costCents, durationMs, tokens } = await callHaiku(markdown, snapshotUrl);

  if (Object.keys(parsed).length === 0) {
    return { status: "empty", fields: 0, costCents, durationMs };
  }

  // Build update payload — only fill NULL fields
  const update = {};
  const filledFields = [];

  for (const [parsedKey, dbField] of Object.entries(FIELD_MAP)) {
    const newVal = parsed[parsedKey];
    if (newVal === undefined || newVal === null) continue;

    const existing = vehicle[dbField];
    const existingEmpty = existing === null || existing === undefined || String(existing).trim() === "";

    if (existingEmpty) {
      update[dbField] = newVal;
      filledFields.push(dbField);
    }
  }

  if (filledFields.length === 0) {
    return { status: "skipped", fields: 0, costCents, durationMs };
  }

  if (!DRY_RUN) {
    // Write to vehicles
    update.extractor_version = "ai-haiku:1.0.0";
    update.updated_at = new Date().toISOString();

    const { error } = await supabase.from("vehicles").update(update).eq("id", vehicle.id);
    if (error) {
      // VIN conflict? Retry without VIN
      if (error.message?.includes("unique constraint") && update.vin) {
        delete update.vin;
        const vinIdx = filledFields.indexOf("vin");
        if (vinIdx >= 0) filledFields.splice(vinIdx, 1);
        if (filledFields.length > 0) {
          await supabase.from("vehicles").update(update).eq("id", vehicle.id);
        }
      } else {
        return { status: "error", error: error.message, fields: 0, costCents, durationMs };
      }
    }

    // Mark queue item as completed
    await supabase.from("snapshot_extraction_queue")
      .update({ status: "completed", completed_at: new Date().toISOString(), fields_filled: filledFields.length })
      .eq("vehicle_id", vehicle.id)
      .eq("platform", PLATFORM);
  }

  return { status: "extracted", fields: filledFields.length, filledFields, costCents, durationMs };
}

// ─── Main Loop ──────────────────────────────────────────────────────────

async function main() {
  console.log(`AI Extraction — ${new Date().toISOString()}`);
  console.log(`Platform: ${PLATFORM}, Batch: ${BATCH_SIZE}, Max: ${MAX_TOTAL}, Parallel: ${PARALLEL}, DryRun: ${DRY_RUN}`);

  let totalProcessed = 0;
  let totalExtracted = 0;
  let totalFields = 0;
  let totalCost = 0;
  let totalEmpty = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  while (totalProcessed < MAX_TOTAL) {
    // Step 1: Find snapshots with markdown that are pending in queue
    const { data: snapshots } = await supabase
      .from("listing_page_snapshots")
      .select("listing_url, markdown")
      .eq("platform", PLATFORM)
      .eq("success", true)
      .not("markdown", "is", null)
      .gt("content_length", 1000)
      .order("content_length", { ascending: false })
      .range(totalProcessed, totalProcessed + BATCH_SIZE - 1);

    if (!snapshots || snapshots.length === 0) { console.log("No more snapshots with markdown."); break; }

    // Step 2: Find matching pending queue items
    const urls = snapshots.map(s => s.listing_url);
    const { data: queueItems } = await supabase
      .from("snapshot_extraction_queue")
      .select("vehicle_id, snapshot_url")
      .eq("platform", PLATFORM)
      .eq("status", "pending")
      .in("snapshot_url", urls);

    if (!queueItems || queueItems.length === 0) {
      totalProcessed += snapshots.length; // Skip these, no queue match
      continue;
    }

    // Step 3: Claim queue items
    const vehicleIds = queueItems.map(q => q.vehicle_id);
    await supabase.from("snapshot_extraction_queue")
      .update({ status: "processing", claimed_at: new Date().toISOString() })
      .in("vehicle_id", vehicleIds)
      .eq("platform", PLATFORM)
      .eq("status", "pending");

    // Step 4: Fetch vehicle data
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, trim, vin, mileage, horsepower, torque, engine_type, transmission, drivetrain, body_style, color, interior_color, sale_price, description")
      .in("id", vehicleIds);

    const vehicleMap = new Map((vehicles || []).map(v => [v.id, v]));
    const snapMap = new Map(snapshots.map(s => [s.listing_url, s.markdown]));

    // Build tasks
    const tasks = [];
    for (const item of queueItems) {
      const vehicle = vehicleMap.get(item.vehicle_id);
      const markdown = snapMap.get(item.snapshot_url);
      if (!vehicle || !markdown || markdown.length < 200) {
        await supabase.from("snapshot_extraction_queue")
          .update({ status: "pending", claimed_at: null })
          .eq("vehicle_id", item.vehicle_id).eq("platform", PLATFORM);
        totalEmpty++;
        totalProcessed++;
        continue;
      }
      tasks.push({ vehicle, snapshotUrl: item.snapshot_url, markdown });
    }

    // Run parallel extractions
    const batchResults = [];
    for (let i = 0; i < tasks.length; i += PARALLEL) {
      const chunk = tasks.slice(i, i + PARALLEL);
      const results = await Promise.all(
        chunk.map(t => processVehicle(t.vehicle, t.snapshotUrl, t.markdown).catch(e => ({
          status: "error", error: e.message, fields: 0, costCents: 0, durationMs: 0
        })))
      );
      batchResults.push(...results);
    }

    // Tally
    for (const r of batchResults) {
      totalProcessed++;
      totalCost += r.costCents || 0;
      if (r.status === "extracted") { totalExtracted++; totalFields += r.fields; }
      else if (r.status === "skipped") totalSkipped++;
      else if (r.status === "empty") totalEmpty++;
      else if (r.status === "error") totalErrors++;
    }

    const avgFields = totalExtracted > 0 ? (totalFields / totalExtracted).toFixed(1) : 0;
    console.log(
      `  Batch: queued=${queueItems.length} extracted=${batchResults.filter(r=>r.status==="extracted").length} ` +
      `fields=${batchResults.reduce((s,r)=>s+r.fields,0)} | ` +
      `Total: ${totalProcessed}/${MAX_TOTAL} extracted=${totalExtracted} fields=${totalFields} ` +
      `avg=${avgFields} cost=$${totalCost.toFixed(4)} skip=${totalSkipped} empty=${totalEmpty} err=${totalErrors}`
    );

    // Cost cap
    if (totalCost > COST_CAP * 100) {
      console.log(`Cost cap reached ($${(totalCost/100).toFixed(2)} > $${COST_CAP}). Stopping.`);
      break;
    }

    // Brief pause between batches
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== FINAL ===`);
  console.log(`Processed: ${totalProcessed}, Extracted: ${totalExtracted}, Fields: ${totalFields}`);
  console.log(`Avg fields/vehicle: ${totalExtracted > 0 ? (totalFields / totalExtracted).toFixed(1) : 0}`);
  console.log(`Cost: $${(totalCost/100).toFixed(4)}`);
  console.log(`Skipped: ${totalSkipped}, Empty: ${totalEmpty}, Errors: ${totalErrors}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
