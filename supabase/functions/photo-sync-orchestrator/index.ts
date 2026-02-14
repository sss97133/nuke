/**
 * Photo Sync Orchestrator
 *
 * Coordinates the AI classification + vehicle matching pipeline for
 * photos uploaded by the auto-sync daemon. Chains existing functions:
 * - ingest-photo-library (classify)
 * - auto-sort-photos (match to vehicles)
 * - decode-vin-and-update (VIN decode)
 *
 * Called by: photo-auto-sync-daemon.py after uploading a batch
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!
});

interface PhotoMeta {
  image_id: string;
  image_url: string;
  uuid?: string;
  original_filename?: string;
  date_taken?: string;
  latitude?: number;
  longitude?: number;
  albums?: string[];
}

interface ClassificationResult {
  image_id: string;
  is_automotive: boolean;
  category: string;
  confidence: number;
  vehicle_hints: {
    make?: string;
    model?: string;
    year_range?: string;
    color?: string;
    body_style?: string;
  };
  vin_detected?: string;
  text_detected?: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, image_ids, photos_metadata, debug } = await req.json();

    if (!user_id || !image_ids?.length) {
      return new Response(
        JSON.stringify({ error: "user_id and image_ids required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Debug mode: just classify and return raw results
    if (debug) {
      const debugResults = [];
      for (const photo of (photos_metadata || [])) {
        try {
          const img = await fetchImageAsBase64(photo.image_url);
          if (!img) {
            debugResults.push({ image_id: photo.image_id, step: "fetch_failed", image_url: photo.image_url });
            continue;
          }
          debugResults.push({ image_id: photo.image_id, step: "fetch_ok", base64_len: img.data.length, media_type: img.media_type });

          let aiResult = await classifyWithAnthropic(img);
          let provider = "anthropic";
          if (!aiResult.ok) {
            debugResults.push({ image_id: photo.image_id, step: "anthropic_failed", error: aiResult.error });
            aiResult = await classifyWithOpenAI(img);
            provider = "openai";
          }
          if (!aiResult.ok) {
            debugResults.push({ image_id: photo.image_id, step: "openai_failed", error: aiResult.error });
            aiResult = await classifyWithXAI(img);
            provider = "xai";
          }
          if (aiResult.ok) {
            debugResults.push({ image_id: photo.image_id, step: `${provider}_ok`, response: aiResult.text.substring(0, 300) });
          } else {
            debugResults.push({ image_id: photo.image_id, step: "all_failed", error: aiResult.error });
          }
        } catch (err) {
          debugResults.push({ image_id: photo.image_id, step: "error", error: String(err).substring(0, 500) });
        }
      }
      return new Response(JSON.stringify({ debug: true, results: debugResults }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      total: image_ids.length,
      matched: 0,
      created: 0,
      pending_clarification: 0,
      ignored: 0,
      errors: 0,
      details: [] as any[],
    };

    // Get user's known vehicles for matching
    const { data: userVehicles } = await supabase
      .from("vehicles")
      .select("id, year, make, model, color, title, vin, user_id")
      .eq("user_id", user_id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(50);

    const knownVehicles = userVehicles || [];

    // Process in batches of 5 for AI classification
    const batchSize = 5;
    for (let i = 0; i < photos_metadata.length; i += batchSize) {
      const batch = photos_metadata.slice(i, i + batchSize);

      // Classify batch with Claude Vision
      const classifications = await classifyBatch(batch);

      for (const classification of classifications) {
        try {
          if (!classification.is_automotive) {
            // Non-automotive - mark as ignored
            await supabase
              .from("vehicle_images")
              .update({
                organization_status: "ignored",
                ai_processing_status: "completed",
              })
              .eq("id", classification.image_id);

            await supabase
              .from("photo_sync_items")
              .update({ sync_status: "ignored", is_automotive: false })
              .eq("vehicle_image_id", classification.image_id);

            results.ignored++;
            continue;
          }

          // Handle documentation/receipts specially - these are deal jackets, invoices, etc.
          if (classification.category === "documentation" || classification.category === "receipt") {
            await supabase
              .from("vehicle_images")
              .update({
                organization_status: "organized",
                ai_processing_status: "completed",
                category: classification.category,
                ai_detected_vehicle: classification.vehicle_hints?.make
                  ? `${classification.vehicle_hints.year_range || ''} ${classification.vehicle_hints.make || ''} ${classification.vehicle_hints.model || ''}`.trim()
                  : null,
              })
              .eq("id", classification.image_id);

            // Try to match to a vehicle if we got hints or VIN
            let matchedVehicleId: string | null = null;
            if (classification.vin_detected) {
              const vinResult = await handleVinDetection(classification.vin_detected, classification.image_id, user_id, knownVehicles);
              if (vinResult.matched || vinResult.created) matchedVehicleId = vinResult.vehicle_id || null;
              if (vinResult.vehicle) knownVehicles.push(vinResult.vehicle);
            }
            if (!matchedVehicleId && classification.vehicle_hints?.make) {
              const m = matchToVehicle(classification, knownVehicles);
              if (m && m.confidence >= 0.6) matchedVehicleId = m.vehicle_id;
            }

            // Store text extraction for downstream processing (forensic-deal-jacket, etc.)
            if (classification.text_detected?.length) {
              await supabase
                .from("vehicle_images")
                .update({
                  components: {
                    classification: classification.category,
                    text_detected: classification.text_detected,
                    vin_detected: classification.vin_detected || null,
                    vehicle_hints: classification.vehicle_hints,
                    needs_forensic_extraction: classification.category === "documentation",
                  },
                  ...(matchedVehicleId ? { vehicle_id: matchedVehicleId } : {}),
                })
                .eq("id", classification.image_id);
            }

            await supabase
              .from("photo_sync_items")
              .update({
                sync_status: matchedVehicleId ? "matched" : "pending_clarification",
                classification_category: classification.category,
                classification_confidence: classification.confidence,
                vehicle_hints: classification.vehicle_hints,
                ...(matchedVehicleId ? { matched_vehicle_id: matchedVehicleId, match_confidence: 0.7, match_method: "document_extraction" } : {}),
              })
              .eq("vehicle_image_id", classification.image_id);

            // Fire-and-forget: trigger deal-jacket-pipeline for immediate extraction
            if (classification.category === "documentation") {
              try {
                const pipelineUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/deal-jacket-pipeline`;
                fetch(pipelineUrl, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    mode: "process",
                    image_id: classification.image_id,
                    vehicle_id: matchedVehicleId,
                  }),
                }).catch(e => console.error("Deal jacket pipeline trigger failed:", e));
              } catch (_) { /* non-blocking */ }
            }

            results.matched++;
            results.details.push({
              image_id: classification.image_id,
              action: matchedVehicleId ? "documentation_matched" : "documentation_stored",
              category: classification.category,
              vehicle_id: matchedVehicleId,
              text_detected: classification.text_detected?.length || 0,
              pipeline_triggered: classification.category === "documentation",
            });
            continue;
          }

          // Check for VIN detection
          if (classification.vin_detected) {
            const vinResult = await handleVinDetection(
              classification.vin_detected,
              classification.image_id,
              user_id,
              knownVehicles
            );
            if (vinResult.matched) {
              results.matched++;
              results.details.push({
                image_id: classification.image_id,
                action: "vin_matched",
                vehicle_id: vinResult.vehicle_id,
              });
              continue;
            }
            if (vinResult.created) {
              results.created++;
              results.details.push({
                image_id: classification.image_id,
                action: "vin_created",
                vehicle_id: vinResult.vehicle_id,
              });
              // Add new vehicle to known list for subsequent matching
              if (vinResult.vehicle) knownVehicles.push(vinResult.vehicle);
              continue;
            }
          }

          // Try matching against known vehicles
          const match = matchToVehicle(classification, knownVehicles);

          if (match && match.confidence >= 0.8) {
            // High confidence - auto-assign
            await supabase
              .from("vehicle_images")
              .update({
                vehicle_id: match.vehicle_id,
                organization_status: "organized",
                ai_processing_status: "completed",
                ai_detected_vehicle: `${match.year || ''} ${match.make || ''} ${match.model || ''}`.trim(),
                category: classification.category,
              })
              .eq("id", classification.image_id);

            await supabase
              .from("photo_sync_items")
              .update({
                sync_status: "matched",
                matched_vehicle_id: match.vehicle_id,
                match_confidence: match.confidence,
                match_method: "ai_vision",
                matched_at: new Date().toISOString(),
              })
              .eq("vehicle_image_id", classification.image_id);

            results.matched++;
            results.details.push({
              image_id: classification.image_id,
              action: "auto_matched",
              vehicle_id: match.vehicle_id,
              confidence: match.confidence,
            });
          } else if (classification.vehicle_hints?.make && classification.confidence >= 0.85) {
            // New vehicle detected with high confidence - auto-create
            const newVehicle = await createVehicle(classification, user_id);
            if (newVehicle) {
              await supabase
                .from("vehicle_images")
                .update({
                  vehicle_id: newVehicle.id,
                  organization_status: "organized",
                  ai_processing_status: "completed",
                  category: classification.category,
                })
                .eq("id", classification.image_id);

              results.created++;
              knownVehicles.push(newVehicle);
              results.details.push({
                image_id: classification.image_id,
                action: "vehicle_created",
                vehicle_id: newVehicle.id,
              });
            } else {
              // Vehicle creation failed — still mark image as completed
              console.warn(`[process] createVehicle returned null for ${classification.image_id}, marking as pending_clarification`);
              await supabase
                .from("vehicle_images")
                .update({
                  ai_processing_status: "completed",
                  ai_detected_vehicle: `${classification.vehicle_hints.year_range || ''} ${classification.vehicle_hints.make || ''} ${classification.vehicle_hints.model || ''}`.trim(),
                  category: classification.category,
                })
                .eq("id", classification.image_id);
              results.pending_clarification++;
            }
          } else {
            // Uncertain - create clarification request
            await supabase
              .from("photo_sync_items")
              .update({
                sync_status: "pending_clarification",
                classification_category: classification.category,
                classification_confidence: classification.confidence,
                vehicle_hints: classification.vehicle_hints,
              })
              .eq("vehicle_image_id", classification.image_id);

            // Mark vehicle_images as completed so it doesn't stay stuck as 'pending'
            await supabase
              .from("vehicle_images")
              .update({
                ai_processing_status: "completed",
                ai_detected_vehicle: classification.vehicle_hints?.make
                  ? `${classification.vehicle_hints.year_range || ''} ${classification.vehicle_hints.make || ''} ${classification.vehicle_hints.model || ''}`.trim()
                  : null,
                category: classification.category,
              })
              .eq("id", classification.image_id);

            results.pending_clarification++;
          }
        } catch (err) {
          console.error(`Error processing ${classification.image_id}:`, err);
          results.errors++;
        }
      }
    }

    // If there are pending clarifications, batch them into a single request
    if (results.pending_clarification > 0) {
      await createBatchClarification(user_id, photos_metadata);
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Orchestrator error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================================
// AI CLASSIFICATION
// ============================================================================

const CLASSIFY_PROMPT = `Analyze this photo for an automotive inventory management system. Respond ONLY with JSON:
{
  "is_automotive": true/false,
  "category": "vehicle_exterior|vehicle_interior|engine_bay|undercarriage|detail_shot|parts|receipt|documentation|shop_environment|progress_shot|not_automotive",
  "confidence": 0.0-1.0,
  "vehicle_hints": {
    "make": "string or null",
    "model": "string or null",
    "year_range": "e.g. 1983 or 1980-1985 or null",
    "color": "string or null",
    "body_style": "truck/sedan/coupe/suv/van/convertible or null"
  },
  "vin_detected": "17-char VIN if a VIN plate/sticker is visible, else null",
  "text_detected": ["any visible text like part numbers, receipts, badges, stock numbers, dollar amounts"]
}

IMPORTANT classification rules:
- Deal jackets, invoices, receipts, repair orders, title documents, window stickers, build sheets = "documentation" and is_automotive=TRUE
- Photos of vehicle interiors (dashboards, seats, steering wheels, gauges) = "vehicle_interior" and is_automotive=TRUE
- VIN plates, data plates, door stickers = "documentation" and is_automotive=TRUE
- Parts on shelves, paint supplies, shop tools = "parts" or "shop_environment" and is_automotive=TRUE
- ONLY set is_automotive=false for photos with ZERO connection to vehicles (food, selfies, landscapes, pets)`;

async function classifyWithAnthropic(
  imageContent: { data: string; media_type: string },
): Promise<{ ok: boolean; text: string; error?: string }> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imageContent.media_type as any, data: imageContent.data } },
          { type: "text", text: CLASSIFY_PROMPT },
        ],
      }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return { ok: true, text };
  } catch (err) {
    const errStr = String(err);
    const isBillingError = errStr.includes("credit balance") || errStr.includes("authentication") || errStr.includes("invalid_api_key");
    return { ok: false, text: "", error: errStr.substring(0, 300) };
  }
}

async function classifyWithOpenAI(
  imageContent: { data: string; media_type: string },
): Promise<{ ok: boolean; text: string; error?: string }> {
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPEN_AI_API_KEY") || "";
  if (!openAiKey) {
    return { ok: false, text: "", error: "No OPENAI_API_KEY configured" };
  }
  const dataUrl = `data:${imageContent.media_type};base64,${imageContent.data}`;
  const res = await callOpenAiChatCompletions({
    apiKey: openAiKey,
    body: {
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: CLASSIFY_PROMPT },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      }],
      max_tokens: 500,
      response_format: { type: "json_object" },
    },
    timeoutMs: 30000,
  });
  if (res.ok && res.content_text) {
    return { ok: true, text: res.content_text };
  }
  return { ok: false, text: "", error: `OpenAI ${res.status}: ${JSON.stringify(res.raw?.error || res.raw).substring(0, 300)}` };
}

async function classifyWithXAI(
  imageContent: { data: string; media_type: string },
): Promise<{ ok: boolean; text: string; error?: string }> {
  const xaiKey = Deno.env.get("XAI_API_KEY") || "";
  if (!xaiKey) {
    return { ok: false, text: "", error: "No XAI_API_KEY configured" };
  }
  // xAI API is OpenAI-compatible, but uses a different base URL
  const dataUrl = `data:${imageContent.media_type};base64,${imageContent.data}`;
  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${xaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-2-vision-latest",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: CLASSIFY_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await resp.json();
    if (resp.ok && raw?.choices?.[0]?.message?.content) {
      return { ok: true, text: raw.choices[0].message.content };
    }
    return { ok: false, text: "", error: `xAI ${resp.status}: ${JSON.stringify(raw?.error || raw).substring(0, 300)}` };
  } catch (err) {
    return { ok: false, text: "", error: `xAI error: ${String(err).substring(0, 300)}` };
  }
}

// Categories that are ALWAYS automotive, regardless of what the AI says for is_automotive
const ALWAYS_AUTOMOTIVE_CATEGORIES = new Set([
  "vehicle_exterior", "vehicle_interior", "engine_bay", "undercarriage",
  "detail_shot", "parts", "receipt", "documentation", "shop_environment", "progress_shot",
]);

function parseClassificationResponse(text: string, imageId: string): ClassificationResult | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const category = parsed.category ?? "not_automotive";

    // Safety net: override is_automotive if category is clearly automotive
    const isAutomotive = ALWAYS_AUTOMOTIVE_CATEGORIES.has(category)
      ? true
      : (parsed.is_automotive ?? false);

    if (!parsed.is_automotive && isAutomotive) {
      console.log(`[classify] Override is_automotive=false → true for category="${category}" on ${imageId}`);
    }

    return {
      image_id: imageId,
      is_automotive: isAutomotive,
      category,
      confidence: parsed.confidence ?? 0,
      vehicle_hints: parsed.vehicle_hints ?? {},
      vin_detected: parsed.vin_detected,
      text_detected: parsed.text_detected,
    };
  } catch {
    return null;
  }
}

async function classifyBatch(photos: PhotoMeta[]): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];

  for (const photo of photos) {
    try {
      console.log(`[classify] Fetching image: ${photo.image_url?.substring(0, 100)}`);
      const imageContent = await fetchImageAsBase64(photo.image_url);
      if (!imageContent) {
        console.error(`[classify] fetchImageAsBase64 returned null for ${photo.image_id}`);
        results.push({
          image_id: photo.image_id,
          is_automotive: false,
          category: "not_automotive",
          confidence: 0,
          vehicle_hints: {},
        });
        continue;
      }
      console.log(`[classify] Image fetched OK, ${imageContent.data.length} base64 chars, type: ${imageContent.media_type}`);

      // Try Anthropic -> OpenAI -> xAI (Grok) fallback chain
      let aiResult = await classifyWithAnthropic(imageContent);
      let provider = "anthropic";

      if (!aiResult.ok) {
        console.warn(`[classify] Anthropic failed for ${photo.image_id}: ${aiResult.error}`);
        aiResult = await classifyWithOpenAI(imageContent);
        provider = "openai";
      }

      if (!aiResult.ok) {
        console.warn(`[classify] OpenAI failed for ${photo.image_id}: ${aiResult.error}`);
        aiResult = await classifyWithXAI(imageContent);
        provider = "xai";
      }

      if (!aiResult.ok) {
        console.error(`[classify] All providers failed for ${photo.image_id}. Last error: ${aiResult.error}`);
        results.push({
          image_id: photo.image_id,
          is_automotive: false,
          category: "classification_error",
          confidence: 0,
          vehicle_hints: {},
        });
        continue;
      }

      console.log(`[classify] ${provider} response for ${photo.image_id}: ${aiResult.text.substring(0, 200)}`);
      const parsed = parseClassificationResponse(aiResult.text, photo.image_id);

      if (parsed) {
        console.log(`[classify] Parsed (${provider}): is_automotive=${parsed.is_automotive}, category=${parsed.category}, confidence=${parsed.confidence}`);
        results.push(parsed);
      } else {
        console.error(`[classify] No JSON in ${provider} response for ${photo.image_id}: ${aiResult.text.substring(0, 200)}`);
        results.push({
          image_id: photo.image_id,
          is_automotive: false,
          category: "not_automotive",
          confidence: 0,
          vehicle_hints: {},
        });
      }
    } catch (err) {
      console.error(`[classify] Classification error for ${photo.image_id}:`, String(err));
      results.push({
        image_id: photo.image_id,
        is_automotive: false,
        category: "classification_error",
        confidence: 0,
        vehicle_hints: {},
      });
    }
  }

  return results;
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif" } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`fetchImageAsBase64: HTTP ${resp.status} for ${url}`);
      return null;
    }
    const buffer = await resp.arrayBuffer();
    // Convert in chunks to avoid max call stack size with spread operator
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
                       contentType.includes("webp") ? "image/webp" :
                       "image/jpeg";
    return { data, media_type: media_type as any };
  } catch (err) {
    console.error(`fetchImageAsBase64 error for ${url}:`, err);
    return null;
  }
}

// ============================================================================
// VEHICLE MATCHING
// ============================================================================

function matchToVehicle(
  classification: ClassificationResult,
  vehicles: any[]
): { vehicle_id: string; confidence: number; year?: number; make?: string; model?: string } | null {
  if (!classification.vehicle_hints || !vehicles.length) return null;

  const hints = classification.vehicle_hints;
  let bestMatch: any = null;
  let bestScore = 0;

  for (const v of vehicles) {
    let score = 0;
    const vMake = (v.make || "").toLowerCase();
    const vModel = (v.model || "").toLowerCase();
    const vColor = (v.color || "").toLowerCase();
    const hMake = (hints.make || "").toLowerCase();
    const hModel = (hints.model || "").toLowerCase();
    const hColor = (hints.color || "").toLowerCase();

    // Make match
    if (hMake && vMake && (hMake.includes(vMake) || vMake.includes(hMake))) {
      score += 30;
    }
    // Model match
    if (hModel && vModel && (hModel.includes(vModel) || vModel.includes(hModel))) {
      score += 30;
    }
    // Color match
    if (hColor && vColor && (hColor.includes(vColor) || vColor.includes(hColor))) {
      score += 20;
    }
    // Year match
    if (hints.year_range && v.year) {
      const yearStr = String(v.year);
      if (hints.year_range.includes(yearStr)) {
        score += 20;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = v;
    }
  }

  if (bestMatch && bestScore >= 50) {
    return {
      vehicle_id: bestMatch.id,
      confidence: bestScore / 100,
      year: bestMatch.year,
      make: bestMatch.make,
      model: bestMatch.model,
    };
  }
  return null;
}

// ============================================================================
// VIN HANDLING
// ============================================================================

async function handleVinDetection(
  vin: string,
  imageId: string,
  userId: string,
  knownVehicles: any[]
): Promise<{ matched: boolean; created: boolean; vehicle_id?: string; vehicle?: any }> {
  // Validate VIN format
  const cleanVin = vin.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
  if (cleanVin.length !== 17) {
    return { matched: false, created: false };
  }

  // Check if VIN exists in known vehicles
  const existing = knownVehicles.find(v => v.vin === cleanVin);
  if (existing) {
    await supabase
      .from("vehicle_images")
      .update({ vehicle_id: existing.id, organization_status: "organized", ai_processing_status: "completed" })
      .eq("id", imageId);
    return { matched: true, created: false, vehicle_id: existing.id };
  }

  // Check database
  const { data: dbMatch } = await supabase
    .from("vehicles")
    .select("id")
    .eq("vin", cleanVin)
    .is("deleted_at", null)
    .limit(1);

  if (dbMatch?.length) {
    await supabase
      .from("vehicle_images")
      .update({ vehicle_id: dbMatch[0].id, organization_status: "organized", ai_processing_status: "completed" })
      .eq("id", imageId);
    return { matched: true, created: false, vehicle_id: dbMatch[0].id };
  }

  // Decode VIN via NHTSA and create vehicle
  try {
    const nhtsaResp = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${cleanVin}?format=json`
    );
    const nhtsaData = await nhtsaResp.json();
    const decoded: Record<string, string> = {};
    for (const item of nhtsaData.Results || []) {
      if (item.Value && item.Value !== "Not Applicable") {
        decoded[item.Variable] = item.Value;
      }
    }

    const year = parseInt(decoded["Model Year"], 10) || null;
    const make = decoded["Make"] || null;
    const model = decoded["Model"] || null;

    const { data: newVehicle } = await supabase
      .from("vehicles")
      .insert({
        vin: cleanVin,
        year,
        make,
        model,
        user_id: userId,
        source: "photo_auto_sync",
        vin_source: "photo_ocr",
        vin_confidence: 0.9,
      })
      .select()
      .single();

    if (newVehicle) {
      await supabase
        .from("vehicle_images")
        .update({ vehicle_id: newVehicle.id, organization_status: "organized", ai_processing_status: "completed" })
        .eq("id", imageId);
      return { matched: false, created: true, vehicle_id: newVehicle.id, vehicle: newVehicle };
    }
  } catch (err) {
    console.error("VIN decode error:", err);
  }

  return { matched: false, created: false };
}

// ============================================================================
// VEHICLE CREATION
// ============================================================================

async function createVehicle(classification: ClassificationResult, userId: string): Promise<any | null> {
  const hints = classification.vehicle_hints;
  if (!hints.make) return null;

  let year: number | null = null;
  if (hints.year_range) {
    const match = hints.year_range.match(/(\d{4})/);
    if (match) year = parseInt(match[1], 10);
  }

  const { data: vehicle } = await supabase
    .from("vehicles")
    .insert({
      year,
      make: hints.make,
      model: hints.model || null,
      color: hints.color || null,
      body_style: hints.body_style || null,
      user_id: userId,
      source: "photo_auto_sync",
    })
    .select()
    .single();

  return vehicle;
}

// ============================================================================
// CLARIFICATION BATCHING
// ============================================================================

async function createBatchClarification(userId: string, allPhotos: PhotoMeta[]) {
  // Get pending items
  const { data: pendingItems } = await supabase
    .from("photo_sync_items")
    .select("id, vehicle_hints, storage_url, classification_category")
    .eq("user_id", userId)
    .eq("sync_status", "pending_clarification")
    .order("detected_at", { ascending: false })
    .limit(20);

  if (!pendingItems?.length) return;

  // Group by similar vehicle hints
  const sampleUrls = pendingItems
    .filter(p => p.storage_url)
    .slice(0, 3)
    .map(p => p.storage_url);

  const firstHints = pendingItems[0]?.vehicle_hints;

  // Get candidate vehicles for the clarification
  const { data: candidates } = await supabase
    .from("vehicles")
    .select("id, year, make, model, color, title")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(5);

  await supabase.from("clarification_requests").insert({
    user_id: userId,
    request_type: "batch_assignment",
    photo_sync_item_ids: pendingItems.map(p => p.id),
    sample_image_urls: sampleUrls,
    ai_analysis: firstHints,
    candidate_vehicles: (candidates || []).map(c => ({
      vehicle_id: c.id,
      vehicle_title: c.title || `${c.year} ${c.make} ${c.model}`,
    })),
    status: "pending",
  });
}
