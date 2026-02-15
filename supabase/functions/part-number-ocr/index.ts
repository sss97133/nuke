/**
 * PART NUMBER OCR
 *
 * GPT-4o vision extracts part numbers from close-up photos:
 * - OEM part numbers (e.g., "GM 3970010")
 * - Casting numbers, date codes
 * - Aftermarket part numbers (e.g., "Holley 0-4779")
 * - Barcode/QR data
 *
 * Post-processing: upsert part_catalog, create vehicle_part_matches, create observation.
 * Pattern follows analyze-engine-bay/index.ts.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "",
);

interface PartExtractionResult {
  parts: ExtractedPart[];
  casting_numbers: CastingNumber[];
  barcodes: string[];
  raw_text: string[];
  confidence: number;
}

interface ExtractedPart {
  part_number: string;
  manufacturer: string | null;
  description: string | null;
  part_type: "oem" | "aftermarket" | "casting" | "unknown";
  confidence: number;
  location_in_image: string | null;
}

interface CastingNumber {
  number: string;
  date_code: string | null;
  location: string | null;
  interpretation: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_id, image_url, vehicle_id } = await req.json();

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "image_url required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[part-number-ocr] Processing image ${image_id}`);

    // Fetch image as base64 for GPT-4o
    const imageResponse = await fetch(image_url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
    );
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

    // Get vehicle context if available
    let vehicleContext = "";
    if (vehicle_id) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("year, make, model, trim, engine")
        .eq("id", vehicle_id)
        .maybeSingle();

      if (vehicle) {
        vehicleContext = `\nVehicle context: ${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""} ${vehicle.trim || ""}. Engine: ${vehicle.engine || "unknown"}.`;
      }
    }

    // GPT-4o vision extraction
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await callOpenAiChatCompletions({
      apiKey: openaiKey,
      timeoutMs: 30000,
      body: {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert automotive parts identifier. Extract ALL part numbers, casting numbers, date codes, and text visible in this close-up photo.${vehicleContext}

Respond in JSON:
{
  "parts": [
    {
      "part_number": "string - exact number as printed",
      "manufacturer": "string or null - OEM (GM, Ford, Mopar) or aftermarket (Holley, Edelbrock, MSD)",
      "description": "string - what this part is",
      "part_type": "oem|aftermarket|casting|unknown",
      "confidence": 0.0-1.0,
      "location_in_image": "where in the image this was found"
    }
  ],
  "casting_numbers": [
    {
      "number": "the casting number",
      "date_code": "date code if present (e.g., K157 = Nov 15 1967)",
      "location": "where on the part",
      "interpretation": "what this casting number indicates"
    }
  ],
  "barcodes": ["any barcode/QR code data"],
  "raw_text": ["all other visible text/numbers"],
  "confidence": 0.0-1.0
}`,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" },
              },
              {
                type: "text",
                text: "Extract all part numbers, casting numbers, date codes, and text from this automotive part close-up photo.",
              },
            ],
          },
        ],
        max_tokens: 1500,
        temperature: 0.1,
        response_format: { type: "json_object" },
      },
    });

    if (!result.ok || !result.content) {
      throw new Error(`GPT-4o extraction failed: ${result.error || "no content"}`);
    }

    const extraction: PartExtractionResult = JSON.parse(result.content);
    console.log(`[part-number-ocr] Found ${extraction.parts.length} parts, ${extraction.casting_numbers.length} casting numbers`);

    // Post-processing: upsert parts into part_catalog and create vehicle_part_matches
    let partsUpserted = 0;
    let matchesCreated = 0;

    for (const part of extraction.parts) {
      if (!part.part_number) continue;

      // Upsert into part_catalog
      const { data: catalogEntry, error: catalogError } = await supabase
        .from("part_catalog")
        .upsert(
          {
            part_number: part.part_number.trim(),
            manufacturer: part.manufacturer,
            description: part.description,
            part_type: part.part_type,
            source: "photo_ocr",
            metadata: {
              extracted_from_image: image_id,
              extraction_confidence: part.confidence,
              location_in_image: part.location_in_image,
            },
          },
          { onConflict: "part_number", ignoreDuplicates: false },
        )
        .select("id")
        .maybeSingle();

      if (catalogError) {
        console.warn(`[part-number-ocr] Catalog upsert failed for ${part.part_number}:`, catalogError.message);
        continue;
      }

      partsUpserted++;

      // Create vehicle_part_matches if we have a vehicle
      if (vehicle_id && catalogEntry?.id) {
        const { error: matchError } = await supabase
          .from("vehicle_part_matches")
          .upsert(
            {
              vehicle_id,
              part_id: catalogEntry.id,
              match_type: "photo_ocr",
              confidence: Math.round(part.confidence * 100),
              source_image_id: image_id,
              metadata: {
                part_type: part.part_type,
                manufacturer: part.manufacturer,
              },
            },
            { onConflict: "vehicle_id,part_id", ignoreDuplicates: false },
          );

        if (!matchError) matchesCreated++;
      }
    }

    // Store casting numbers as additional field evidence
    if (vehicle_id && extraction.casting_numbers.length > 0) {
      for (const casting of extraction.casting_numbers) {
        await supabase
          .from("vehicle_field_evidence")
          .upsert(
            {
              vehicle_id,
              field_name: `casting_number_${casting.number.replace(/\s/g, "_")}`,
              value_text: casting.number,
              value_json: {
                date_code: casting.date_code,
                location: casting.location,
                interpretation: casting.interpretation,
              },
              source_type: "ai_visual",
              source_id: image_id,
              confidence_score: Math.round(extraction.confidence * 100),
              extraction_model: "gpt-4o",
              metadata: { pipeline: "part-number-ocr" },
            },
            { onConflict: "vehicle_id,field_name,source_type,source_id", ignoreDuplicates: false },
          );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        image_id,
        parts_found: extraction.parts.length,
        parts: extraction.parts,
        casting_numbers: extraction.casting_numbers,
        barcodes: extraction.barcodes,
        parts_upserted: partsUpserted,
        matches_created: matchesCreated,
        confidence: extraction.confidence,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[part-number-ocr] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
