#!/usr/bin/env node
/**
 * MULTI-MODEL DESCRIPTION DISCOVERY
 *
 * Runs description extraction through multiple LLM providers.
 * Results tagged with model_used for multi-model provenance comparison.
 * Same vehicle extracted by different models → confidence scoring.
 *
 * Providers:
 *   ollama     — Local, free (qwen2.5:7b, llama3.1:8b)
 *   openai     — gpt-4o-mini ($0.15/$0.60 per M tokens)
 *   gemini     — gemini-2.0-flash-lite (free tier: 1000 RPD)
 *   groq       — llama-3.1-8b-instant (free tier: 14,400 RPD)
 *
 * Usage:
 *   dotenvx run -- node scripts/local-description-discovery.mjs [options]
 *
 * Options:
 *   --provider <name>    Provider: ollama|openai|gemini|groq (default: ollama)
 *   --model <name>       Model name (default: auto per provider)
 *   --batch <n>          Batch size (default: 20)
 *   --parallel <n>       Concurrent calls (default: 2, higher for API providers)
 *   --min-price <n>      Minimum sale price filter (default: 0)
 *   --max <n>            Max total vehicles to process (default: 1000)
 *   --continue           Keep running batches until max reached
 *   --dry-run            Query vehicles but don't extract
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : args[i + 1] || def; };
const hasFlag = (name) => args.includes(`--${name}`);

const PROVIDER = getArg("provider", "ollama");
const DEFAULT_MODELS = {
  ollama: "qwen2.5:7b",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash-lite",
  groq: "llama-3.1-8b-instant",
  modal: "qwen2.5-7b",
};
const MODEL = getArg("model", DEFAULT_MODELS[PROVIDER] || "qwen2.5:7b");
const BATCH_SIZE = parseInt(getArg("batch", "20"), 10);
const DEFAULT_PARALLEL = { ollama: 2, openai: 10, gemini: 5, groq: 10, modal: 8 };
const PARALLEL = parseInt(getArg("parallel", String(DEFAULT_PARALLEL[PROVIDER] || 2)), 10);
const MIN_PRICE = parseInt(getArg("min-price", "0"), 10);
const MAX_TOTAL = parseInt(getArg("max", "1000"), 10);
const CONTINUE = hasFlag("continue");
const DRY_RUN = hasFlag("dry-run");

const PROMPT_VERSION = "discovery-v1";

// ─── Shared prompt ──────────────────────────────────────────────────────

const DISCOVERY_PROMPT = `You are analyzing a vehicle auction listing. Extract ALL factual information you can find.

VEHICLE: {year} {make} {model}
SALE PRICE: {sale_price}

LISTING DESCRIPTION:
---
{description}
---

Extract EVERYTHING factual from this description. Be thorough. Include:
- Any dates, years, timeframes mentioned
- Any numbers (mileage, production numbers, prices, measurements)
- Any people mentioned (owners, shops, dealers)
- Any locations mentioned (cities, states, countries)
- Any work done (service, repairs, restoration, modifications)
- Any parts mentioned (replaced, original, aftermarket)
- Any documentation mentioned (records, manuals, certificates)
- Any condition notes (issues, wear, damage, preservation)
- Any awards or certifications
- Any claims about originality or authenticity
- Any rarity claims
- Any provenance information

Return a JSON object. Create whatever keys make sense for the data you find.
Group related information logically. Use snake_case for keys.

IMPORTANT: Return ONLY valid JSON. No explanation, no markdown fences, just the JSON object.`;

function buildPrompt(description, vehicle) {
  return DISCOVERY_PROMPT
    .replace("{year}", String(vehicle.year || "Unknown"))
    .replace("{make}", vehicle.make || "Unknown")
    .replace("{model}", vehicle.model || "Unknown")
    .replace("{sale_price}", vehicle.sale_price ? `$${Number(vehicle.sale_price).toLocaleString()}` : "Unknown")
    .replace("{description}", description.substring(0, 6000));
}

// ─── Provider implementations ───────────────────────────────────────────

async function callOllama(prompt) {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.1, num_predict: 2048 } }),
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const r = await resp.json();
  return { content: r.response || "", tokensPerSec: r.eval_count ? (r.eval_count / ((r.eval_duration || 1) / 1e9)).toFixed(0) : "?" };
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI ${resp.status}: ${text.slice(0, 200)}`);
  }
  const r = await resp.json();
  const usage = r.usage || {};
  const tokensPerSec = usage.completion_tokens ? "api" : "?";
  return { content: r.choices?.[0]?.message?.content || "", tokensPerSec };
}

async function callGemini(prompt) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_AI_API_KEY not set");
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json" },
      }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
  }
  const r = await resp.json();
  const content = r.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { content, tokensPerSec: "api" };
}

async function callGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Groq ${resp.status}: ${text.slice(0, 200)}`);
  }
  const r = await resp.json();
  const usage = r.usage || {};
  const dur = r.usage?.completion_time || 0;
  const tokensPerSec = dur > 0 ? ((usage.completion_tokens || 0) / dur).toFixed(0) : "?";
  return { content: r.choices?.[0]?.message?.content || "", tokensPerSec };
}

const MODAL_URL = process.env.MODAL_LLM_URL || "https://sss97133--nuke-vllm-serve.modal.run";

async function callModal(prompt) {
  const resp = await fetch(`${MODAL_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5-7b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Modal ${resp.status}: ${text.slice(0, 200)}`);
  }
  const r = await resp.json();
  const meta = r._meta || {};
  const tokensPerSec = meta.tokens_per_sec || "?";
  return { content: r.choices?.[0]?.message?.content || "", tokensPerSec };
}

const PROVIDERS = { ollama: callOllama, openai: callOpenAI, gemini: callGemini, groq: callGroq, modal: callModal };

// ─── Extract + parse ────────────────────────────────────────────────────

async function extract(description, vehicle) {
  const prompt = buildPrompt(description, vehicle);
  const startMs = Date.now();
  const callFn = PROVIDERS[PROVIDER];
  if (!callFn) throw new Error(`Unknown provider: ${PROVIDER}`);

  const { content, tokensPerSec } = await callFn(prompt);
  const elapsedMs = Date.now() - startMs;

  // Parse JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { parsed: { raw_response: content.slice(0, 500), parse_failed: true }, elapsedMs, tokensPerSec };
  }

  try {
    return { parsed: JSON.parse(jsonMatch[0]), elapsedMs, tokensPerSec };
  } catch {
    // Fix common local model JSON issues
    const fixed = jsonMatch[0].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    try {
      return { parsed: JSON.parse(fixed), elapsedMs, tokensPerSec };
    } catch {
      return { parsed: { raw_response: content.slice(0, 500), parse_failed: true }, elapsedMs, tokensPerSec };
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function countFields(obj, depth = 0) {
  if (depth > 5 || obj == null) return 0;
  if (typeof obj !== "object") return 1;
  if (Array.isArray(obj)) return obj.reduce((s, i) => s + countFields(i, depth + 1), 0);
  return Object.values(obj).reduce((s, v) => s + countFields(v, depth + 1), 0);
}

async function getCandidates(batchSize) {
  const { data: rows, error } = await supabase.rpc("execute_sql", {
    query: `SELECT v.id, v.year, v.make, v.model, v.description,
              COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price
            FROM vehicles v
            WHERE v.description IS NOT NULL
              AND length(v.description) >= 100
              AND v.deleted_at IS NULL
              AND COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price, 0) >= ${MIN_PRICE}
              AND NOT EXISTS (
                SELECT 1 FROM description_discoveries dd
                WHERE dd.vehicle_id = v.id AND dd.model_used = '${MODEL}'
              )
            LIMIT ${batchSize}`,
  });
  if (error) throw new Error(`Query: ${JSON.stringify(error)}`);
  return Array.isArray(rows) ? rows : [];
}

async function processOne(vehicle) {
  if (!vehicle.description || vehicle.description.length < 100) {
    return { success: false, error: "Description too short" };
  }

  const { parsed, elapsedMs, tokensPerSec } = await extract(vehicle.description, vehicle);
  const keysFound = Object.keys(parsed).length;
  const totalFields = countFields(parsed);

  const { error: insertError } = await supabase
    .from("description_discoveries")
    .upsert({
      vehicle_id: vehicle.id,
      discovered_at: new Date().toISOString(),
      model_used: MODEL,
      prompt_version: PROMPT_VERSION,
      raw_extraction: parsed,
      keys_found: keysFound,
      total_fields: totalFields,
      description_length: vehicle.description.length,
      sale_price: vehicle.sale_price,
    }, { onConflict: "vehicle_id,model_used" });

  if (insertError) throw new Error(`Insert: ${insertError.message}`);

  return {
    success: !parsed.parse_failed,
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    keysFound, totalFields, elapsedMs, tokensPerSec,
    parseFailed: !!parsed.parse_failed,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  // Provider-specific init checks
  if (PROVIDER === "ollama") {
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!resp.ok) throw new Error(`status ${resp.status}`);
    } catch (e) {
      console.error(`Cannot connect to Ollama at ${OLLAMA_URL}: ${e.message}`);
      process.exit(1);
    }
  }

  const costEstimate = {
    ollama: "FREE (local)",
    openai: `~$${((MAX_TOTAL * 6000 * 0.15 / 1e6) + (MAX_TOTAL * 1000 * 0.6 / 1e6)).toFixed(2)} (gpt-4o-mini)`,
    gemini: "FREE (1000 RPD limit)",
    groq: "FREE (14,400 RPD limit)",
    modal: `~$${(MAX_TOTAL * 4 / 3600 * 0.59).toFixed(2)} (T4 GPU, ~$0.59/hr)`,
  };

  console.log(`\n  Multi-Model Description Discovery`);
  console.log(`   Provider: ${PROVIDER} | Model: ${MODEL}`);
  console.log(`   Batch: ${BATCH_SIZE} | Parallel: ${PARALLEL} | Max: ${MAX_TOTAL}`);
  console.log(`   Est. cost: ${costEstimate[PROVIDER] || "unknown"}`);
  console.log();

  let totalProcessed = 0, totalSuccess = 0, totalErrors = 0, totalParseFailures = 0;
  const startTime = Date.now();

  do {
    const candidates = await getCandidates(BATCH_SIZE);
    if (candidates.length === 0) { console.log("\nNo more candidates. Done."); break; }

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would process ${candidates.length} vehicles`);
      for (const v of candidates.slice(0, 5)) console.log(`  ${v.year} ${v.make} ${v.model} — ${v.description?.length} chars`);
      break;
    }

    for (let i = 0; i < candidates.length; i += PARALLEL) {
      const chunk = candidates.slice(i, i + PARALLEL);
      const results = await Promise.allSettled(chunk.map(processOne));

      for (const r of results) {
        totalProcessed++;
        if (r.status === "fulfilled" && r.value.success) {
          totalSuccess++;
          const v = r.value;
          console.log(`  + ${v.vehicle} — ${v.keysFound} keys, ${v.totalFields} fields, ${v.elapsedMs}ms (${v.tokensPerSec} tok/s)`);
        } else if (r.status === "fulfilled" && r.value.parseFailed) {
          totalParseFailures++;
        } else {
          totalErrors++;
          const err = r.status === "rejected" ? r.reason?.message : r.value?.error;
          console.log(`  x ${err?.slice(0, 120)}`);
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (totalProcessed / elapsed).toFixed(1);
      process.stdout.write(`\r  [${totalProcessed}/${MAX_TOTAL}] ${totalSuccess} ok, ${totalErrors} err | ${rate}/s   `);
    }
    console.log();

    if (totalProcessed >= MAX_TOTAL) { console.log(`\nReached max (${MAX_TOTAL}).`); break; }
  } while (CONTINUE);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Results:`);
  console.log(`   ${totalSuccess}/${totalProcessed} success (${((totalSuccess / Math.max(totalProcessed, 1)) * 100).toFixed(1)}%)`);
  console.log(`   ${totalParseFailures} parse failures, ${totalErrors} errors`);
  console.log(`   ${elapsed}s elapsed (${(totalProcessed / (elapsed / 60)).toFixed(1)}/min)`);
  console.log(`   Provider: ${PROVIDER} | Model: ${MODEL}`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
