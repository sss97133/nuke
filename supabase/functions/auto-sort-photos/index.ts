/**
 * Auto-Sort Photos - AI-powered image classification for technician workflow
 *
 * Analyzes images and automatically assigns them to the correct vehicle based on:
 * - Visual features (color, body style, badges, condition)
 * - Text recognition (receipts, VINs, badges)
 * - Context clues (tools, parts, shop environment)
 * - Temporal patterns (what was being worked on recently)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!
});

interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  notes: string | null;
}

interface UnsortedImage {
  id: string;
  image_url: string;
  caption: string | null;
  vehicle_id: string;
  created_at: string;
}

interface ClassificationResult {
  image_id: string;
  suggested_vehicle_id: string | null;
  confidence: number;
  reasoning: string;
  detected_features: {
    color?: string;
    body_style?: string;
    make_badge?: string;
    model_badge?: string;
    condition?: string;
    text_detected?: string[];
    is_receipt?: boolean;
    is_part?: boolean;
    is_close_up?: boolean;
  };
}

// Get known vehicles for the shop/technician
async function getKnownVehicles(technicianId?: string): Promise<Vehicle[]> {
  // Get vehicles from telegram source or assigned to technician
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, year, make, model, vin, notes")
    .or("source.eq.telegram,source.eq.telegram_technician")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Failed to get vehicles:", error);
    return [];
  }

  return data || [];
}

// Get images that need classification
async function getUnsortedImages(limit = 20): Promise<UnsortedImage[]> {
  const { data, error } = await supabase
    .from("vehicle_images")
    .select("id, image_url, caption, vehicle_id, created_at")
    .eq("source", "telegram")
    .is("category", null)  // No category = not reviewed
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to get unsorted images:", error);
    return [];
  }

  return data || [];
}

// Classify a single image using Claude Vision
async function classifyImage(
  image: UnsortedImage,
  vehicles: Vehicle[]
): Promise<ClassificationResult> {
  const vehicleDescriptions = vehicles.map(v =>
    `- ID: ${v.id}
     ${v.year || ''} ${v.make || ''} ${v.model || ''}
     VIN: ${v.vin || 'unknown'}
     Notes: ${v.notes || 'none'}`
  ).join("\n");

  const prompt = `You are analyzing a photo from an auto shop. Your job is to determine which vehicle this photo belongs to.

Known vehicles in this shop:
${vehicleDescriptions}

Analyze this image and determine:
1. What vehicle does this photo most likely belong to?
2. What visual features helped you decide? (color, badges, body style, condition)
3. Is there any text visible? (receipts, VINs, part numbers, badges)
4. What type of photo is this? (exterior shot, interior, engine bay, close-up of part, receipt/documentation)

Respond in JSON format:
{
  "suggested_vehicle_id": "uuid or null if can't determine",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "detected_features": {
    "color": "detected color or null",
    "body_style": "truck/car/van/etc or null",
    "make_badge": "if visible",
    "model_badge": "if visible (e.g. 'Cheyenne 10', 'Silverado')",
    "condition": "excellent/good/fair/rough/rusty",
    "text_detected": ["any text visible"],
    "is_receipt": true/false,
    "is_part": true/false,
    "is_close_up": true/false
  }
}

Key hints:
- DeLorean: Silver/stainless steel, gull-wing doors, futuristic 80s look
- Cheyenne 10: Rusty, beat up, brown/rust colored, "Cheyenne" badge
- Blue 1983 Silverado: Blue paint, square body, shiny but dirty, getting AC work

If you see a receipt, read it to find clues about which vehicle it's for (part numbers, vehicle description, R-12/R-134a = AC work = the blue truck).`;

  try {
    // Fetch the image and convert to base64 safely
    const imageResponse = await fetch(image.image_url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);

    // Convert to base64 in chunks to avoid stack overflow
    let base64Image = '';
    const chunkSize = 0x8000; // 32KB chunks
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      base64Image += String.fromCharCode.apply(null, Array.from(chunk));
    }
    base64Image = btoa(base64Image);

    const mediaType = image.image_url.includes('.png') ? 'image/png' : 'image/jpeg';

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    });

    // Parse the response
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    // Extract JSON from response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const result = JSON.parse(jsonMatch[0]);

    return {
      image_id: image.id,
      suggested_vehicle_id: result.suggested_vehicle_id,
      confidence: result.confidence || 0,
      reasoning: result.reasoning || "",
      detected_features: result.detected_features || {}
    };

  } catch (error) {
    console.error(`Failed to classify image ${image.id}:`, error);
    return {
      image_id: image.id,
      suggested_vehicle_id: null,
      confidence: 0,
      reasoning: `Classification failed: ${error}`,
      detected_features: {}
    };
  }
}

// Process receipt image - extract details and link to work session
async function processReceipt(imageId: string, imageUrl: string, vehicleId: string) {
  try {
    // Fetch image
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);

    let base64Image = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      base64Image += String.fromCharCode.apply(null, Array.from(chunk));
    }
    base64Image = btoa(base64Image);
    const mediaType = imageUrl.includes('.png') ? 'image/png' : 'image/jpeg';

    // Extract receipt details
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
          { type: "text", text: `Extract details from this receipt. Return JSON:
{
  "vendor_name": "store name",
  "receipt_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "items": [
    { "name": "item description", "quantity": 1, "unit_price": number, "total": number }
  ],
  "tax_amount": number or null,
  "payment_method": "cash/card/etc or null",
  "notes": "any relevant notes about the purchase"
}` }
        ]
      }]
    });

    const content = response.content[0];
    if (content.type !== "text") return;

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const receiptData = JSON.parse(jsonMatch[0]);

    // Find active work session for this vehicle (or today's date)
    const today = new Date().toISOString().split('T')[0];
    const { data: activeSession } = await supabase
      .from("work_sessions")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("session_date", today)
      .eq("status", "in_progress")
      .limit(1)
      .maybeSingle();

    // Store receipt parts
    if (receiptData.items && receiptData.items.length > 0) {
      for (const item of receiptData.items) {
        await supabase.from("work_session_parts").insert({
          work_session_id: activeSession?.id || null,
          vehicle_id: vehicleId,
          part_name: item.name,
          quantity: item.quantity || 1,
          unit_cost: item.unit_price || item.total,
          total_cost: item.total || item.unit_price,
          vendor: receiptData.vendor_name,
          receipt_image_id: imageId,
          receipt_date: receiptData.receipt_date
        }).catch(e => console.error("Failed to insert part:", e));
      }
    }

    // Also store full receipt record
    await supabase.from("vehicle_receipts").upsert({
      vehicle_id: vehicleId,
      receipt_type: "parts",
      amount: receiptData.total_amount,
      currency: "USD",
      vendor_name: receiptData.vendor_name,
      description: receiptData.items?.map((i: any) => i.name).join(", ") || "Receipt",
      receipt_date: receiptData.receipt_date || today,
      image_url: imageUrl,
      metadata: receiptData,
      verified: false
    }, { onConflict: "id" }).catch(e => console.error("Failed to store receipt:", e));

    console.log(`Processed receipt: ${receiptData.vendor_name} - $${receiptData.total_amount}`);

  } catch (error) {
    console.error("Receipt processing failed:", error);
  }
}

// Apply classification results
async function applyClassification(result: ClassificationResult, autoApply: boolean) {
  // Store the classification result
  const { error: insertError } = await supabase
    .from("vehicle_image_classifications")
    .upsert({
      image_id: result.image_id,
      suggested_vehicle_id: result.suggested_vehicle_id,
      confidence: result.confidence,
      reasoning: result.reasoning,
      detected_features: result.detected_features,
      auto_applied: autoApply && result.confidence >= 0.8,
      classified_at: new Date().toISOString()
    }, { onConflict: "image_id" });

  if (insertError) {
    console.error("Failed to store classification:", insertError);
  }

  // Auto-apply if high confidence and requested
  if (autoApply && result.confidence >= 0.8 && result.suggested_vehicle_id) {
    // Get image URL for receipt processing
    const { data: imageData } = await supabase
      .from("vehicle_images")
      .select("image_url")
      .eq("id", result.image_id)
      .single();

    const { error: updateError } = await supabase
      .from("vehicle_images")
      .update({
        vehicle_id: result.suggested_vehicle_id,
        category: result.detected_features.is_receipt ? "documentation" :
                  result.detected_features.is_close_up ? "detail" :
                  result.detected_features.is_part ? "parts" : "general"
      })
      .eq("id", result.image_id);

    if (updateError) {
      console.error("Failed to apply classification:", updateError);
    } else {
      console.log(`Auto-applied: Image ${result.image_id} -> Vehicle ${result.suggested_vehicle_id}`);

      // If it's a receipt, extract the details
      if (result.detected_features.is_receipt && imageData?.image_url) {
        processReceipt(result.image_id, imageData.image_url, result.suggested_vehicle_id);
      }
    }
  }

  return result;
}

// Main handler
Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      action = "classify",
      image_ids,
      limit = 10,
      auto_apply = false,
      technician_id
    } = body;

    // Get known vehicles
    const vehicles = await getKnownVehicles(technician_id);

    if (vehicles.length === 0) {
      return new Response(
        JSON.stringify({ error: "No vehicles found for classification" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (action === "classify") {
      // Get images to classify
      let images: UnsortedImage[];

      if (image_ids && Array.isArray(image_ids)) {
        const { data } = await supabase
          .from("vehicle_images")
          .select("id, image_url, caption, vehicle_id, created_at")
          .in("id", image_ids);
        images = data || [];
      } else {
        images = await getUnsortedImages(limit);
      }

      if (images.length === 0) {
        return new Response(
          JSON.stringify({ message: "No images to classify", results: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Classify each image
      const results: ClassificationResult[] = [];
      for (const image of images) {
        console.log(`Classifying image: ${image.id}`);
        const result = await classifyImage(image, vehicles);
        await applyClassification(result, auto_apply);
        results.push(result);
      }

      // Summary
      const summary = {
        total: results.length,
        classified: results.filter(r => r.suggested_vehicle_id).length,
        high_confidence: results.filter(r => r.confidence >= 0.8).length,
        auto_applied: auto_apply ? results.filter(r => r.confidence >= 0.8 && r.suggested_vehicle_id).length : 0
      };

      return new Response(
        JSON.stringify({ summary, results, vehicles }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status") {
      // Return classification stats
      const { data: pending } = await supabase
        .from("vehicle_images")
        .select("id", { count: "exact" })
        .eq("source", "telegram")
        .is("category", null);

      const { data: classified } = await supabase
        .from("vehicle_image_classifications")
        .select("id", { count: "exact" });

      return new Response(
        JSON.stringify({
          pending_images: pending?.length || 0,
          classified_images: classified?.length || 0,
          known_vehicles: vehicles.length,
          vehicles: vehicles.map(v => ({ id: v.id, name: `${v.year} ${v.make} ${v.model}` }))
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
