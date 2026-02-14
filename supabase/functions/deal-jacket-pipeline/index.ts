/**
 * Deal Jacket Pipeline — Auto-process documentation photos end-to-end
 *
 * Modes:
 *   scan     — Find unprocessed documentation images, attempt extraction, score, link vehicles
 *   status   — Report pipeline status
 *   process  — Process a specific image by ID
 *   manual   — Accept pre-extracted JSON from Claude Code / Ollama and run full pipeline
 *
 * Called by: cron (every 4 hours), manual trigger, or Claude Code session
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─── EXTRACTION PROMPT ──────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `You are a forensic accountant. Extract ALL data from this dealer deal jacket (vehicle dealership sales document).

Return ONLY a JSON object:
{
  "deal_header": {"stock_number":"","deal_number":"","sold_date":"YYYY-MM-DD","buyer_name":"","seller_entity":"","salesperson":""},
  "vehicle": {"year":null,"make":"","model":"","trim":"","vin":"","odometer":null,"color":""},
  "acquisition": {"purchase_cost":0,"listing_fee":0,"shipping":0,"total_pre_recon":0},
  "reconditioning": {
    "line_items": [{"line_number":1,"description":"","amount":0,"vendor_named":false,"vendor_name":"","is_round_number":false}],
    "total": 0
  },
  "sale": {"sale_price":0,"total_cost":0},
  "trade_in": {"year":null,"make":"","model":"","vin":"","allowance":0},
  "profit": {"reported_profit":0},
  "investments": [{"name":"","amount":0,"type":"cash|inventory|phantom"}]
}

Extract EVERY reconditioning line item. Be precise with amounts. If unclear, note in description.`;

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const {
      mode = "scan",
      image_id,
      vehicle_id,
      extraction,
      limit = 5,
    } = body;

    // ── Status mode ──
    if (mode === "status") {
      return jsonResponse(await getStatus());
    }

    // ── Manual mode: pre-extracted JSON → score → link ──
    if (mode === "manual" && extraction) {
      const result = await processExtraction(image_id, vehicle_id, extraction);
      return jsonResponse({ ...result, mode: "manual", duration_ms: Date.now() - startTime });
    }

    // ── Process single image ──
    if (mode === "process" && image_id) {
      const result = await processSingleImage(image_id, undefined, vehicle_id);
      return jsonResponse({ ...result, mode: "process", duration_ms: Date.now() - startTime });
    }

    // ── Scan mode: find and process unprocessed docs ──
    if (mode === "scan") {
      const result = await scanAndProcess(limit);
      return jsonResponse({ ...result, mode: "scan", duration_ms: Date.now() - startTime });
    }

    return jsonResponse({ error: "Unknown mode. Use: scan, status, process, manual" }, 400);
  } catch (err) {
    console.error("Pipeline error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

// ─── STATUS ─────────────────────────────────────────────────────────────────
async function getStatus() {
  const { data: docs } = await supabase
    .from("vehicle_images")
    .select("id, vehicle_id, category, components, ai_extractions")
    .in("category", ["documentation", "receipt"])
    .limit(200);

  const total = docs?.length || 0;
  const hasExtraction = (docs || []).filter(d =>
    d.ai_extractions?.some((e: any) => e.type === "forensic_deal_jacket")
  ).length;
  const linked = (docs || []).filter(d => d.vehicle_id).length;
  const flagged = (docs || []).filter(d => d.components?.needs_forensic_extraction).length;

  return {
    total_documentation_images: total,
    with_forensic_extraction: hasExtraction,
    needs_extraction: total - hasExtraction,
    flagged_for_extraction: flagged,
    linked_to_vehicle: linked,
    orphaned: total - linked,
  };
}

// ─── SCAN AND PROCESS ───────────────────────────────────────────────────────
async function scanAndProcess(limit: number) {
  // Find documentation images without forensic extraction
  const { data: docs } = await supabase
    .from("vehicle_images")
    .select("id, image_url, storage_path, vehicle_id, category, components, ai_extractions")
    .in("category", ["documentation", "receipt"])
    .order("created_at", { ascending: false })
    .limit(limit * 3);

  if (!docs?.length) {
    return { processed: 0, message: "No documentation images found" };
  }

  // Filter to unprocessed
  const unprocessed = docs.filter(d =>
    !d.ai_extractions?.some((e: any) => e.type === "forensic_deal_jacket")
  ).slice(0, limit);

  if (!unprocessed.length) {
    return { processed: 0, message: "All documentation images already processed" };
  }

  const results = {
    processed: 0,
    extracted: 0,
    failed: 0,
    vehicles_linked: 0,
    vehicles_created: 0,
    details: [] as any[],
  };

  for (const doc of unprocessed) {
    try {
      const result = await processSingleImage(doc.id, doc);
      results.processed++;
      if (result.extracted) results.extracted++;
      else results.failed++;
      if (result.vehicle_linked) results.vehicles_linked++;
      if (result.vehicle_created) results.vehicles_created++;
      results.details.push({ image_id: doc.id, ...result });
    } catch (err) {
      results.failed++;
      results.details.push({ image_id: doc.id, error: String(err) });
    }
  }

  return results;
}

// ─── PROCESS SINGLE IMAGE ───────────────────────────────────────────────────
async function processSingleImage(imageId: string, doc?: any, overrideVehicleId?: string | null) {
  if (!doc) {
    const { data } = await supabase
      .from("vehicle_images")
      .select("id, image_url, storage_path, vehicle_id, category, components, ai_extractions")
      .eq("id", imageId)
      .single();
    doc = data;
  }

  if (!doc) return { error: "Image not found", extracted: false };

  // Use override vehicle_id if provided (avoids race condition with orchestrator DB writes)
  if (overrideVehicleId && !doc.vehicle_id) {
    doc.vehicle_id = overrideVehicleId;
  }

  const imageUrl = doc.image_url || doc.storage_path;
  if (!imageUrl) return { error: "No image URL", extracted: false };

  // Try xAI extraction
  const xaiKey = Deno.env.get("XAI_API_KEY");
  if (!xaiKey) {
    // Flag for manual processing
    await supabase
      .from("vehicle_images")
      .update({
        components: { ...(doc.components || {}), needs_forensic_extraction: true, extraction_queued_at: new Date().toISOString() },
      })
      .eq("id", imageId);
    return { extracted: false, queued: true, reason: "No API key available — queued for manual extraction" };
  }

  try {
    // Download and encode image
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) throw new Error(`Failed to download: HTTP ${imgResp.status}`);
    const buffer = await imgResp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    const b64 = btoa(binary);
    const ct = imgResp.headers.get("content-type") || "image/jpeg";

    // Call xAI
    const xaiResp = await fetch("https://api.x.ai/v1/chat/completions", {
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
            { type: "text", text: EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${ct};base64,${b64}` } },
          ],
        }],
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(90000),
    });

    const xaiData = await xaiResp.json();
    const content = xaiData?.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in xAI response");

    const extraction = JSON.parse(jsonMatch[0]);
    return await processExtraction(imageId, doc.vehicle_id, extraction);
  } catch (err) {
    console.error(`xAI extraction failed for ${imageId}:`, err);
    // Queue for manual
    await supabase
      .from("vehicle_images")
      .update({
        components: {
          ...(doc.components || {}),
          needs_forensic_extraction: true,
          last_extraction_error: String(err).substring(0, 200),
          last_extraction_attempt: new Date().toISOString(),
        },
      })
      .eq("id", imageId);
    return { extracted: false, error: String(err).substring(0, 200) };
  }
}

// ─── PROCESS EXTRACTION → SCORE → LINK ──────────────────────────────────────
async function processExtraction(imageId: string, vehicleId: string | null, extraction: any) {
  // 1. Call forensic-deal-jacket in manual mode for trust scoring + storage
  const forensicUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/forensic-deal-jacket`;
  const forensicResp = await fetch(forensicUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_id: imageId,
      vehicle_id: vehicleId,
      mode: "manual",
      extraction,
      store_results: true,
    }),
  });

  const forensicResult = await forensicResp.json();

  // 2. Auto-link vehicle
  let vehicleLinked = false;
  let vehicleCreated = false;
  let linkedVehicleId = vehicleId;

  const vehicleData = extraction?.vehicle;
  if (vehicleData?.make && !vehicleId) {
    const linkResult = await autoLinkVehicle(imageId, vehicleData, extraction);
    linkedVehicleId = linkResult.vehicleId;
    vehicleLinked = linkResult.linked;
    vehicleCreated = linkResult.created;
  }

  // 3. Clear the needs_forensic_extraction flag
  await supabase
    .from("vehicle_images")
    .update({
      components: {
        needs_forensic_extraction: false,
        forensic_extracted_at: new Date().toISOString(),
        extraction_method: "pipeline",
      },
    })
    .eq("id", imageId);

  return {
    extracted: true,
    forensic_summary: forensicResult?.forensic_summary,
    vehicle_id: linkedVehicleId,
    vehicle_linked: vehicleLinked,
    vehicle_created: vehicleCreated,
  };
}

// ─── AUTO-LINK VEHICLE ──────────────────────────────────────────────────────
async function autoLinkVehicle(imageId: string, vehicleData: any, extraction: any) {
  const year = vehicleData.year;
  const make = (vehicleData.make || "").trim();
  const model = (vehicleData.model || "").trim();
  const vin = (vehicleData.vin || "").replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();

  // 1. VIN match
  if (vin && vin.length >= 11) {
    const { data: vinMatch } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", vin)
      .is("deleted_at", null)
      .limit(1);
    if (vinMatch?.length) {
      await supabase.from("vehicle_images").update({ vehicle_id: vinMatch[0].id }).eq("id", imageId);
      await enrichVehicle(vinMatch[0].id, extraction);
      return { vehicleId: vinMatch[0].id, linked: true, created: false };
    }
  }

  // 2. Year+make+model match
  if (year && make) {
    let query = supabase.from("vehicles").select("id, year, make, model").is("deleted_at", null);
    query = query.eq("year", year).ilike("make", make);
    if (model) query = query.ilike("model", model);
    const { data: matches } = await query.limit(5);

    if (matches?.length === 1) {
      await supabase.from("vehicle_images").update({ vehicle_id: matches[0].id }).eq("id", imageId);
      await enrichVehicle(matches[0].id, extraction);
      return { vehicleId: matches[0].id, linked: true, created: false };
    }
  }

  // 3. Create new vehicle
  if (make) {
    // Get user_id from image
    const { data: img } = await supabase
      .from("vehicle_images")
      .select("user_id")
      .eq("id", imageId)
      .single();

    const { data: newVehicle } = await supabase
      .from("vehicles")
      .insert({
        year: year || null,
        make,
        model: model || null,
        vin: vin.length >= 11 ? vin : null,
        color: vehicleData.color || null,
        source: "deal_jacket_pipeline",
        user_id: img?.user_id || null,
        sale_price: extraction?.sale?.sale_price || null,
      })
      .select("id")
      .single();

    if (newVehicle) {
      await supabase.from("vehicle_images").update({ vehicle_id: newVehicle.id }).eq("id", imageId);
      await enrichVehicle(newVehicle.id, extraction);
      return { vehicleId: newVehicle.id, linked: false, created: true };
    }
  }

  return { vehicleId: null, linked: false, created: false };
}

// ─── ENRICH VEHICLE ─────────────────────────────────────────────────────────
async function enrichVehicle(vehicleId: string, extraction: any) {
  if (!extraction) return;

  const updates: Record<string, any> = {};
  const vehicle = extraction.vehicle || {};
  const sale = extraction.sale || {};
  const header = extraction.deal_header || {};
  const acq = extraction.acquisition || {};
  const profit = extraction.profit || {};

  if (vehicle.vin && vehicle.vin.length >= 11) {
    updates.vin = vehicle.vin;
    updates.vin_source = "deal_jacket";
  }
  if (vehicle.odometer) updates.mileage = vehicle.odometer;
  if (vehicle.color) updates.color = vehicle.color;
  if (sale.sale_price) updates.sale_price = sale.sale_price;

  // Build origin_metadata.deal_jacket_data
  const { data: existing } = await supabase
    .from("vehicles")
    .select("origin_metadata")
    .eq("id", vehicleId)
    .single();

  const meta = existing?.origin_metadata || {};
  meta.deal_jacket_data = {
    sale_price: sale.sale_price,
    purchase_cost: acq.purchase_cost,
    reported_profit: profit.reported_profit,
    sold_date: header.sold_date,
    buyer_name: header.buyer_name,
    stock_number: header.stock_number,
    seller_entity: header.seller_entity,
    extracted_at: new Date().toISOString(),
  };
  updates.origin_metadata = meta;

  if (Object.keys(updates).length > 0) {
    await supabase.from("vehicles").update(updates).eq("id", vehicleId);
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
