/**
 * Analyze Engine Bay — AI vision extraction for engine bay photos
 *
 * Takes vehicle_images classified as "engine_bay" and extracts:
 * - Engine family (SBC, BBC, SBF, Hemi, LS, etc.)
 * - Carburetor/fuel system (Rochester Q-jet, Holley, TBI, MPFI, etc.)
 * - Ignition system (HEI, points, MSD, Duraspark, COP)
 * - Air cleaner type
 * - Valve covers (stock vs aftermarket)
 * - Headers vs cast manifolds
 * - Visible modifications
 * - Approximate displacement if identifiable
 *
 * Modes:
 *   process                 — Analyze unprocessed engine_bay images (default)
 *   reprocess               — Re-analyze all engine_bay images
 *   single                  — Analyze one image by ID
 *   reanalyze_low_confidence — Re-analyze low-confidence results with vehicle context
 *
 * Deploy: supabase functions deploy analyze-engine-bay --no-verify-jwt
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ENGINE_BAY_PROMPT = `You are an expert automotive mechanic and engine builder. Analyze this engine bay photograph in detail.

Respond ONLY with JSON matching this exact schema:
{
  "engine_family": "SBC|BBC|SBF|FE|Windsor|Flathead|LS|LT|Coyote|Hemi|LA|Magnum|Pontiac|Buick|Olds|BMW_inline6|Porsche_flat6|other|unknown",
  "engine_family_confidence": 0.0-1.0,
  "estimated_displacement": "e.g. 350ci/5.7L or null if unknown",
  "fuel_system": {
    "type": "carburetor|tbi|mpfi|direct_injection|mechanical_injection|unknown",
    "brand": "Rochester|Holley|Edelbrock|Carter|Weber|Motorcraft|Autolite|Quadrajet|stock_tbi|stock_mpfi|unknown",
    "model": "e.g. Q-jet, 4150, 4160, Performer, AVS, Thermoquad, or null",
    "barrels": 1|2|4|6|8|null,
    "confidence": 0.0-1.0
  },
  "ignition_system": {
    "type": "points|HEI|Duraspark|MSD|electronic|coil_on_plug|distributor_less|unknown",
    "distributor_cap_visible": true|false,
    "aftermarket_ignition": true|false,
    "brand": "GM_HEI|MSD|Pertronix|Mallory|ACCEL|stock|unknown",
    "confidence": 0.0-1.0
  },
  "air_cleaner": {
    "type": "stock_round|stock_snorkel|open_element|cold_air_intake|ram_air|none_visible|unknown",
    "aftermarket": true|false
  },
  "valve_covers": {
    "type": "stock_stamped|stock_cast|aftermarket_chrome|aftermarket_finned|aftermarket_billet|tall|short|unknown",
    "brand": "e.g. Edelbrock, Moroso, stock, etc. or unknown"
  },
  "exhaust_manifolds": {
    "type": "cast_iron_log|cast_iron_ram_horn|tubular_headers|long_tube_headers|shorty_headers|turbo_manifold|unknown",
    "material": "cast_iron|stainless|mild_steel|ceramic_coated|unknown"
  },
  "visible_modifications": [
    "list of visible aftermarket or modified components, e.g. 'polished intake manifold', 'chrome alternator', 'braided hoses', 'underdrive pulleys'"
  ],
  "condition": "show_quality|well_maintained|average|neglected|project|unknown",
  "estimated_era": "pre-1960|1960s|1970s|1980s|1990s|2000s|2010s|2020s|mixed",
  "notes": "Any additional observations about the engine bay, potential concerns, interesting details"
}

Be specific about what you can see. If you cannot identify something with confidence, say "unknown" rather than guessing. Pay attention to:
- Distributor cap shape and size (large cap = HEI, small cap = points/Duraspark)
- Carburetor body shape (Q-jet has distinctive narrow primary/wide secondary)
- Valve cover bolt pattern (center bolt = later model, perimeter = earlier)
- Block casting marks if visible
- Wiring (electronic ignition has specific connector patterns)
- Intake manifold type (stock cast iron vs aluminum aftermarket)`;

function buildEnhancedPrompt(vehicleContext?: { year?: number; make?: string; model?: string }): string {
  if (!vehicleContext?.year && !vehicleContext?.make && !vehicleContext?.model) {
    return ENGINE_BAY_PROMPT;
  }
  const parts = [vehicleContext.year, vehicleContext.make, vehicleContext.model].filter(Boolean).join(" ");
  return ENGINE_BAY_PROMPT + `\n\nIMPORTANT CONTEXT: This engine bay photo is from a ${parts}. Given this vehicle context, re-examine your analysis carefully. Use the known factory options for this vehicle to inform your identification. If the engine appears to be a swap (non-factory for this vehicle), note that explicitly.`;
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ data: string; media_type: string } | null> {
  try {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    const data = btoa(binary);
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const media_type = contentType.includes("png") ? "image/png" :
                       contentType.includes("webp") ? "image/webp" : "image/jpeg";
    return { data, media_type };
  } catch {
    return null;
  }
}

async function analyzeWithOpenAI(imageContent: { data: string; media_type: string }, prompt?: string): Promise<{ ok: boolean; text: string; error?: string }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPEN_AI_API_KEY") || "";
  if (!apiKey) return { ok: false, text: "", error: "No OPENAI_API_KEY" };

  const dataUrl = `data:${imageContent.media_type};base64,${imageContent.data}`;
  const res = await callOpenAiChatCompletions({
    apiKey,
    body: {
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt || ENGINE_BAY_PROMPT },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      }],
      max_tokens: 1000,
      response_format: { type: "json_object" },
    },
    timeoutMs: 45000,
  });

  if (res.ok && res.content_text) {
    return { ok: true, text: res.content_text };
  }
  return { ok: false, text: "", error: `OpenAI ${res.status}: ${JSON.stringify(res.raw?.error || res.raw).substring(0, 300)}` };
}

async function analyzeWithXAI(imageContent: { data: string; media_type: string }, prompt?: string): Promise<{ ok: boolean; text: string; error?: string }> {
  const xaiKey = Deno.env.get("XAI_API_KEY") || "";
  if (!xaiKey) return { ok: false, text: "", error: "No XAI_API_KEY" };

  const dataUrl = `data:${imageContent.media_type};base64,${imageContent.data}`;
  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-2-vision-latest",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt || ENGINE_BAY_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const raw = await resp.json();
    if (resp.ok && raw?.choices?.[0]?.message?.content) {
      return { ok: true, text: raw.choices[0].message.content };
    }
    return { ok: false, text: "", error: `xAI ${resp.status}: ${JSON.stringify(raw?.error || raw).substring(0, 300)}` };
  } catch (err) {
    return { ok: false, text: "", error: `xAI: ${String(err).substring(0, 200)}` };
  }
}

function parseAnalysis(text: string): Record<string, unknown> | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "process";
    const limit = Math.min(Number(body.limit) || 10, 50);
    const imageId = body.image_id || null;

    const results = {
      mode,
      total: 0,
      analyzed: 0,
      errors: 0,
      details: [] as any[],
    };

    // Get images to process
    let images: any[] | null = null;
    let error: any = null;

    if (mode === "single" && imageId) {
      const res = await supabase
        .from("vehicle_images")
        .select("id, image_url, storage_path, filename, vehicle_id, ai_extractions, components")
        .eq("id", imageId);
      images = res.data;
      error = res.error;
    } else if (mode === "reanalyze_low_confidence") {
      // Use raw SQL via Supabase's postgrest — the JS client chokes on JSONB filters
      // for large tables. Use a direct SQL approach via the rpc trick: just query with
      // a simple select + JS filter on a small result set.
      // We know from initial analysis there are ~22 engine bay images total, so fetch all.
      const res = await supabase
        .from("vehicle_images")
        .select("id, image_url, storage_path, filename, vehicle_id, ai_extractions, components")
        .eq("category", "engine_bay")
        .order("ai_last_scanned", { ascending: true, nullsFirst: true })
        .limit(50);
      images = res.data;
      error = res.error;
      if (images) {
        images = images.filter(img => {
          if (!img.components || Object.keys(img.components).length === 0) return false;
          const conf = img.components?.engine_family_confidence;
          const family = img.components?.engine_family;
          return (conf != null && conf < 0.7) || family === "unknown" || family === "other";
        }).slice(0, limit);
      }
    } else {
      // process / reprocess mode
      const res = await supabase
        .from("vehicle_images")
        .select("id, image_url, storage_path, filename, vehicle_id, ai_extractions, components")
        .eq("category", "engine_bay")
        .order("created_at", { ascending: false })
        .limit(mode === "process" ? limit * 5 : limit);
      images = res.data;
      error = res.error;
      // For "process" mode, filter to only unprocessed in JS
      if (mode === "process" && images) {
        images = images.filter(img => !img.components || Object.keys(img.components).length === 0).slice(0, limit);
      }
    }
    if (error) throw new Error(`Query error: ${error.message}`);
    if (!images?.length) {
      return new Response(JSON.stringify({ ...results, message: "No engine bay images to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    results.total = images.length;

    // Pre-fetch vehicle context for reanalyze mode (batch lookup)
    const vehicleContextMap: Record<string, { year?: number; make?: string; model?: string }> = {};
    if (mode === "reanalyze_low_confidence") {
      const vehicleIds = [...new Set(images.map(i => i.vehicle_id).filter(Boolean))];
      if (vehicleIds.length > 0) {
        const { data: vehicles } = await supabase
          .from("vehicles")
          .select("id, year, make, model")
          .in("id", vehicleIds);
        for (const v of vehicles || []) {
          vehicleContextMap[v.id] = { year: v.year, make: v.make, model: v.model };
        }
      }
    }

    for (const img of images) {
      try {
        const imageUrl = img.image_url || img.storage_path;
        if (!imageUrl) { results.errors++; continue; }

        console.log(`[engine-bay] Analyzing ${img.id} (${img.filename || "unnamed"}) [${mode}]`);

        const imageContent = await fetchImageAsBase64(imageUrl);
        if (!imageContent) {
          console.error(`[engine-bay] Failed to fetch ${imageUrl}`);
          results.errors++;
          continue;
        }

        // Build prompt — enhanced with vehicle context for reanalyze mode
        const vehicleCtx = img.vehicle_id ? vehicleContextMap[img.vehicle_id] : undefined;
        const prompt = mode === "reanalyze_low_confidence" ? buildEnhancedPrompt(vehicleCtx) : undefined;

        // Try OpenAI first (more reliable for detailed analysis), then xAI
        let aiResult = await analyzeWithOpenAI(imageContent, prompt);
        let provider = "openai";

        if (!aiResult.ok) {
          console.warn(`[engine-bay] OpenAI failed: ${aiResult.error}`);
          aiResult = await analyzeWithXAI(imageContent, prompt);
          provider = "xai";
        }

        if (!aiResult.ok) {
          console.error(`[engine-bay] All providers failed for ${img.id}: ${aiResult.error}`);
          results.errors++;
          continue;
        }

        const analysis = parseAnalysis(aiResult.text);
        if (!analysis) {
          console.error(`[engine-bay] Failed to parse response for ${img.id}: ${aiResult.text.substring(0, 200)}`);
          results.errors++;
          continue;
        }

        console.log(`[engine-bay] ${provider} analyzed ${img.id}: family=${analysis.engine_family}, fuel=${(analysis as any).fuel_system?.type}, ignition=${(analysis as any).ignition_system?.type}`);

        // For reanalyze mode: compare old vs new confidence — only update if improved
        const oldConf = img.components?.engine_family_confidence || 0;
        const newConf = (analysis.engine_family_confidence as number) || 0;
        const prevVersion = img.components?.analysis_version || 1;

        if (mode === "reanalyze_low_confidence" && newConf < oldConf) {
          console.log(`[engine-bay] Reanalyze for ${img.id}: new confidence ${newConf} < old ${oldConf}, keeping old. Appending to history only.`);
          // Still append to ai_extractions for audit trail, but don't update components
          await supabase
            .from("vehicle_images")
            .update({
              ai_extractions: [...(img.ai_extractions || []), {
                type: "engine_bay_analysis",
                provider,
                timestamp: new Date().toISOString(),
                result: analysis,
                reanalyze: true,
                kept: false,
                old_confidence: oldConf,
                new_confidence: newConf,
                vehicle_context: vehicleCtx || null,
              }],
            })
            .eq("id", img.id);
          results.details.push({
            image_id: img.id,
            filename: img.filename,
            provider,
            action: "kept_old",
            old_confidence: oldConf,
            new_confidence: newConf,
          });
          results.analyzed++;
          continue;
        }

        // Store analysis in vehicle_images
        const components = {
          engine_family: analysis.engine_family,
          engine_family_confidence: analysis.engine_family_confidence,
          estimated_displacement: analysis.estimated_displacement,
          fuel_system: analysis.fuel_system,
          ignition_system: analysis.ignition_system,
          air_cleaner: analysis.air_cleaner,
          valve_covers: analysis.valve_covers,
          exhaust_manifolds: analysis.exhaust_manifolds,
          visible_modifications: analysis.visible_modifications,
          condition: analysis.condition,
          estimated_era: analysis.estimated_era,
          notes: analysis.notes,
          analyzed_by: provider,
          analyzed_at: new Date().toISOString(),
          analysis_version: mode === "reanalyze_low_confidence" ? prevVersion + 1 : 1,
          ...(vehicleCtx ? { vehicle_context_used: true } : {}),
        };

        // Update the image record
        const { error: updateErr } = await supabase
          .from("vehicle_images")
          .update({
            components,
            ai_extractions: [...(img.ai_extractions || []), {
              type: "engine_bay_analysis",
              provider,
              timestamp: new Date().toISOString(),
              result: analysis,
              ...(mode === "reanalyze_low_confidence" ? {
                reanalyze: true,
                kept: true,
                old_confidence: oldConf,
                new_confidence: newConf,
                vehicle_context: vehicleCtx || null,
                version: components.analysis_version,
              } : {}),
            }],
            ai_last_scanned: new Date().toISOString(),
          })
          .eq("id", img.id);

        if (updateErr) {
          console.error(`[engine-bay] Update failed for ${img.id}: ${updateErr.message}`);
          results.errors++;
          continue;
        }

        // If the image has a vehicle_id, also update the vehicle's origin_metadata
        // with the engine bay analysis for HP estimation cross-reference
        if (img.vehicle_id) {
          const { data: vehicle } = await supabase
            .from("vehicles")
            .select("id, origin_metadata")
            .eq("id", img.vehicle_id)
            .single();

          if (vehicle) {
            const meta = vehicle.origin_metadata || {};
            meta.engine_bay_analysis = {
              engine_family: analysis.engine_family,
              engine_family_confidence: analysis.engine_family_confidence,
              estimated_displacement: analysis.estimated_displacement,
              fuel_system_type: (analysis as any).fuel_system?.type,
              fuel_system_brand: (analysis as any).fuel_system?.brand,
              ignition_type: (analysis as any).ignition_system?.type,
              ignition_brand: (analysis as any).ignition_system?.brand,
              headers: (analysis as any).exhaust_manifolds?.type,
              condition: analysis.condition,
              modifications: analysis.visible_modifications,
              image_id: img.id,
              analyzed_at: new Date().toISOString(),
              analysis_version: components.analysis_version,
            };
            await supabase
              .from("vehicles")
              .update({ origin_metadata: meta })
              .eq("id", img.vehicle_id);
          }
        }

        results.analyzed++;
        results.details.push({
          image_id: img.id,
          filename: img.filename,
          provider,
          engine_family: analysis.engine_family,
          fuel_system: (analysis as any).fuel_system?.type + " " + ((analysis as any).fuel_system?.brand || ""),
          ignition: (analysis as any).ignition_system?.type + " " + ((analysis as any).ignition_system?.brand || ""),
          condition: analysis.condition,
          mods: (analysis as any).visible_modifications?.length || 0,
          ...(mode === "reanalyze_low_confidence" ? {
            action: "updated",
            old_confidence: oldConf,
            new_confidence: newConf,
            version: components.analysis_version,
          } : {}),
        });
      } catch (err) {
        console.error(`[engine-bay] Error processing ${img.id}:`, err);
        results.errors++;
      }
    }

    const duration = Date.now() - startTime;
    return new Response(JSON.stringify({ success: true, ...results, duration_ms: duration }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: String(err),
      duration_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
