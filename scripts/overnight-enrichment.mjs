#!/usr/bin/env node
/**
 * Overnight Enrichment — Fill missing fields using local LLMs ($0)
 *
 * Targets vehicles with descriptions but missing equipment/highlights/flaws.
 * Uses qwen3:30b-a3b locally (100+ tok/s) for batch processing.
 *
 * Usage:
 *   dotenvx run -- node scripts/overnight-enrichment.mjs
 *   dotenvx run -- node scripts/overnight-enrichment.mjs --max 500
 *   dotenvx run -- node scripts/overnight-enrichment.mjs --provider ollama --model nuke-agent
 *   dotenvx run -- node scripts/overnight-enrichment.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// CLI args
function getArg(name, defaultVal) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  if (typeof defaultVal === "boolean") return true;
  return process.argv[idx + 1] || defaultVal;
}

const MAX = parseInt(getArg("max", "1000"));
const MODEL = getArg("model", "qwen3:30b-a3b");
const OLLAMA_URL = getArg("ollama-url", "http://127.0.0.1:11434");
const DRY_RUN = getArg("dry-run", false);
const BATCH_SIZE = parseInt(getArg("batch", "50"));

const SYSTEM_PROMPT = `You are a vehicle data enrichment specialist. Given a vehicle's description and existing data, extract ONLY the following fields if they can be determined from the text:

- equipment: Factory and aftermarket equipment mentioned (comma-separated list)
- highlights: What makes this vehicle special or notable (comma-separated list)
- known_flaws: Any defects, issues, or concerns mentioned (comma-separated list)
- modifications: Aftermarket changes from factory spec (comma-separated list)
- condition_notes: Brief condition assessment based on the description

Return ONLY valid JSON. Do not include fields you cannot determine from the provided text. Example:
{"equipment":"A/C, power steering, power brakes, AM/FM radio","highlights":"matching numbers, original paint, documented service history","known_flaws":"small tear in driver seat, surface rust on tailgate","modifications":"aftermarket exhaust, upgraded stereo"}`;

async function callOllama(prompt) {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      stream: false,
      options: { num_predict: 1024, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.message?.content || "";
}

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) try { return JSON.parse(match[0]); } catch {}
  return null;
}

async function enrichVehicle(vehicle) {
  const { id, year, make, model, trim, description, sale_price, mileage, color, transmission, engine_type } = vehicle;

  const prompt = `Enrich this vehicle from its description:

Year: ${year || "?"}
Make: ${make || "?"}
Model: ${model || "?"} ${trim || ""}
Price: $${sale_price ? sale_price.toLocaleString() : "?"}
Mileage: ${mileage ? mileage.toLocaleString() : "unknown"}
Color: ${color || "?"}
Transmission: ${transmission || "?"}
Engine: ${engine_type || "?"}

Description:
${(description || "").slice(0, 3000)}

Extract equipment, highlights, known_flaws, and modifications as JSON.`;

  const raw = await callOllama(prompt);
  const parsed = parseJSON(raw);
  if (!parsed) return { id, error: "Failed to parse response", raw: raw.slice(0, 200) };

  // Only write fields that are non-empty and the vehicle currently lacks
  const updates = {};
  const fieldsToCheck = ["equipment", "highlights", "known_flaws", "modifications"];
  for (const field of fieldsToCheck) {
    let value = parsed[field];
    if (!value) continue;

    // Handle array responses — join into comma-separated string
    if (Array.isArray(value)) value = value.join(", ");
    if (typeof value !== "string") value = String(value);
    value = value.trim();

    if (value.length > 5 && (!vehicle[field] || String(vehicle[field]).trim().length < 5)) {
      updates[field] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    console.log(`    → Skipped ${id.slice(0,8)}: vehicle already has these fields or model returned empty. Parsed: ${JSON.stringify(parsed).slice(0,200)}`);
    return { id, skipped: true, reason: "no new fields to fill" };
  }

  return { id, updates, parsed };
}

async function main() {
  console.log(`\n=== Overnight Enrichment ===`);
  console.log(`Model: ${MODEL}`);
  console.log(`Max vehicles: ${MAX}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Ollama: ${OLLAMA_URL}`);
  console.log();

  // Check Ollama is reachable
  try {
    const health = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error("not ok");
    const tags = await health.json();
    const modelFound = tags.models?.some(m => m.name.startsWith(MODEL.split(":")[0]));
    if (!modelFound) {
      console.error(`Model ${MODEL} not found in Ollama. Available: ${tags.models?.map(m => m.name).join(", ")}`);
      process.exit(1);
    }
    console.log(`Ollama OK — ${MODEL} loaded`);
  } catch (e) {
    console.error(`Cannot reach Ollama at ${OLLAMA_URL}: ${e.message}`);
    process.exit(1);
  }

  // Fetch vehicles that need enrichment
  let offset = 0;
  let enriched = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  while (enriched + skipped + errors < MAX) {
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select("id, year, make, model, trim, description, sale_price, mileage, color, transmission, engine_type, equipment, highlights, known_flaws, modifications")
      .not("description", "is", null)
      .is("equipment", null)
      .gt("sale_price", 1000)
      .in("status", ["active", "sold"])
      .order("sale_price", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("Query error:", error.message);
      break;
    }
    if (!vehicles || vehicles.length === 0) {
      console.log("No more vehicles to process.");
      break;
    }

    for (const vehicle of vehicles) {
      if (enriched + skipped + errors >= MAX) break;

      try {
        const result = await enrichVehicle(vehicle);

        if (result.skipped) {
          skipped++;
          continue;
        }

        if (result.error) {
          errors++;
          if (errors < 5) console.error(`  Error on ${result.id}: ${result.error}`);
          continue;
        }

        if (!DRY_RUN && result.updates && Object.keys(result.updates).length > 0) {
          // Write to vehicle
          const { error: updateError } = await supabase
            .from("vehicles")
            .update({
              ...result.updates,
              last_enrichment_attempt: new Date().toISOString(),
            })
            .eq("id", result.id);

          if (updateError) {
            console.error(`  Write error on ${result.id}: ${updateError.message}`);
            errors++;
            continue;
          }

          // Log to llm_cost_tracking
          await supabase.from("llm_cost_tracking").insert({
            provider: "ollama",
            model: MODEL,
            task: "overnight_enrichment",
            input_tokens: 0,
            output_tokens: 0,
            cost_cents: 0,
            caller: "overnight-enrichment.mjs",
          }).then(() => {}).catch(() => {});
        }

        enriched++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (enriched / (elapsed / 60)).toFixed(1);

        if (enriched % 10 === 0) {
          const fields = result.updates ? Object.keys(result.updates).join(", ") : "";
          console.log(`  [${enriched}/${MAX}] ${elapsed}s | ${rate}/min | ${vehicle.year} ${vehicle.make} ${vehicle.model} → ${fields}`);
        }
      } catch (e) {
        errors++;
        if (errors < 10) console.error(`  Exception on ${vehicle.id}: ${e.message}`);
      }
    }

    offset += BATCH_SIZE;
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const summary = `
=== Enrichment Complete ===
Enriched: ${enriched}
Skipped:  ${skipped}
Errors:   ${errors}
Time:     ${totalTime} min
Rate:     ${(enriched / (totalTime || 1)).toFixed(1)}/min
Model:    ${MODEL}
Cost:     $0.00
`;
  console.log(summary);

  // Send Telegram notification
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `*Overnight Enrichment Complete*\n\nEnriched: ${enriched}\nSkipped: ${skipped}\nErrors: ${errors}\nTime: ${totalTime} min\nModel: ${MODEL}\nCost: $0.00`,
          parse_mode: "Markdown",
        }),
      });
    } catch {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
