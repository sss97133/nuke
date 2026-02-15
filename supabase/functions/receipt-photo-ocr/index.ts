/**
 * RECEIPT PHOTO OCR
 *
 * Two-pass extraction from receipt/invoice photos:
 * 1. Azure Form Recognizer (structured receipt fields) — via existing receipt-extract pattern
 * 2. GPT-4o vision enhancement — automotive-specific: part numbers, labor, shop ID
 *
 * Post-processing:
 * - Create vehicle_work_contributions for labor items
 * - Upsert parts into part_catalog + vehicle_part_matches
 * - Create observation with source_slug: 'receipt_ocr'
 * - Create vehicle_field_evidence entries
 * - Match shop to organizations via name/address
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface ReceiptExtraction {
  shop: {
    name: string | null;
    address: string | null;
    phone: string | null;
    website: string | null;
  };
  receipt_date: string | null;
  receipt_number: string | null;
  vehicle_reference: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  payment_method: string | null;
  labor_rate: number | null;
  confidence: number;
}

interface LineItem {
  description: string;
  category: "part" | "labor" | "material" | "fee" | "other";
  part_number: string | null;
  brand: string | null;
  quantity: number;
  unit_price: number | null;
  total_price: number;
  labor_hours: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_id, image_url, vehicle_id, user_id } = await req.json();

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "image_url required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[receipt-photo-ocr] Processing image ${image_id}`);

    // Pass 1: Try existing receipt-extract for structured data
    let pass1Result: any = null;
    try {
      const pass1Response = await fetch(
        `${SUPABASE_URL}/functions/v1/receipt-extract`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ image_url, format: "image" }),
        },
      );

      if (pass1Response.ok) {
        pass1Result = await pass1Response.json();
        console.log("[receipt-photo-ocr] Pass 1 (receipt-extract) succeeded");
      }
    } catch (error: any) {
      console.warn("[receipt-photo-ocr] Pass 1 failed:", error.message);
    }

    // Pass 2: GPT-4o vision for automotive-specific extraction
    const extraction = await extractWithVision(image_url, pass1Result);
    console.log(
      `[receipt-photo-ocr] Extracted ${extraction.line_items.length} line items from ${extraction.shop.name || "unknown shop"}`,
    );

    // Post-processing
    let partsFound = 0;
    let laborItemsCreated = 0;
    let workContributionId: string | null = null;

    // Match shop to organization
    let matchedOrgId: string | null = null;
    if (extraction.shop.name) {
      const { data: orgMatch } = await supabase
        .from("businesses")
        .select("id")
        .ilike("business_name", `%${extraction.shop.name}%`)
        .limit(1)
        .maybeSingle();

      if (orgMatch) {
        matchedOrgId = orgMatch.id;
        console.log(`[receipt-photo-ocr] Matched shop to org: ${matchedOrgId}`);
      }
    }

    // Create vehicle_work_contributions for labor
    if (vehicle_id && matchedOrgId) {
      const laborItems = extraction.line_items.filter((i) => i.category === "labor");
      const totalLaborHours = laborItems.reduce((sum, i) => sum + (i.labor_hours || 0), 0);
      const totalLaborCost = laborItems.reduce((sum, i) => sum + i.total_price, 0);
      const totalPartsCost = extraction.line_items
        .filter((i) => i.category === "part")
        .reduce((sum, i) => sum + i.total_price, 0);

      if (laborItems.length > 0 || totalPartsCost > 0) {
        const { data: contribution, error: contribError } = await supabase
          .from("vehicle_work_contributions")
          .insert({
            vehicle_id,
            contributing_organization_id: matchedOrgId,
            work_type: "maintenance",
            work_description: laborItems.map((i) => i.description).join("; ") || "Service from receipt",
            work_date: extraction.receipt_date || new Date().toISOString().split("T")[0],
            labor_hours: totalLaborHours || null,
            labor_rate: extraction.labor_rate,
            parts_cost: totalPartsCost || null,
            total_cost: extraction.total,
            source_image_id: image_id,
            source_type: "receipt_ocr",
            status: "completed",
            performed_by_user_id: user_id,
            notes: `Receipt #${extraction.receipt_number || "unknown"} from ${extraction.shop.name || "unknown shop"}`,
          })
          .select("id")
          .maybeSingle();

        if (contribution) {
          workContributionId = contribution.id;
          laborItemsCreated = laborItems.length;
        }
        if (contribError) {
          console.warn("[receipt-photo-ocr] Work contribution insert failed:", contribError.message);
        }
      }
    }

    // Upsert parts into part_catalog + vehicle_part_matches
    const partItems = extraction.line_items.filter(
      (i) => i.category === "part" && (i.part_number || i.description),
    );

    for (const item of partItems) {
      const partNumber = item.part_number || `receipt-${(item.description || "unknown").replace(/\s+/g, "-").toLowerCase().slice(0, 50)}`;

      const { data: catalogEntry } = await supabase
        .from("part_catalog")
        .upsert(
          {
            part_number: partNumber,
            manufacturer: item.brand,
            description: item.description,
            part_type: item.brand ? "aftermarket" : "unknown",
            source: "receipt_ocr",
            metadata: {
              extracted_from_image: image_id,
              receipt_price: item.total_price,
              receipt_shop: extraction.shop.name,
            },
          },
          { onConflict: "part_number", ignoreDuplicates: false },
        )
        .select("id")
        .maybeSingle();

      if (catalogEntry?.id && vehicle_id) {
        await supabase
          .from("vehicle_part_matches")
          .upsert(
            {
              vehicle_id,
              part_id: catalogEntry.id,
              match_type: "receipt_ocr",
              confidence: Math.round(extraction.confidence * 100),
              source_image_id: image_id,
              metadata: {
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                receipt_date: extraction.receipt_date,
              },
            },
            { onConflict: "vehicle_id,part_id", ignoreDuplicates: false },
          );
      }

      partsFound++;
    }

    // Create field evidence for receipt data
    if (vehicle_id) {
      const evidenceEntries = [];

      if (extraction.shop.name) {
        evidenceEntries.push({
          vehicle_id,
          field_name: "service_shop",
          value_text: extraction.shop.name,
          value_json: extraction.shop,
          source_type: "ai_visual" as const,
          source_id: image_id,
          confidence_score: Math.round(extraction.confidence * 100),
          extraction_model: "receipt-photo-ocr",
          metadata: { pipeline: "receipt-photo-ocr", receipt_number: extraction.receipt_number },
        });
      }

      if (extraction.total) {
        evidenceEntries.push({
          vehicle_id,
          field_name: "service_cost",
          value_number: extraction.total,
          source_type: "ai_visual" as const,
          source_id: image_id,
          confidence_score: Math.round(extraction.confidence * 100),
          extraction_model: "receipt-photo-ocr",
          metadata: { receipt_date: extraction.receipt_date, shop: extraction.shop.name },
        });
      }

      if (evidenceEntries.length > 0) {
        await supabase
          .from("vehicle_field_evidence")
          .upsert(evidenceEntries, {
            onConflict: "vehicle_id,field_name,source_type,source_id",
            ignoreDuplicates: false,
          });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        image_id,
        shop: extraction.shop,
        line_items_count: extraction.line_items.length,
        parts_found: partsFound,
        labor_items_created: laborItemsCreated,
        work_contribution_id: workContributionId,
        matched_org_id: matchedOrgId,
        total: extraction.total,
        receipt_date: extraction.receipt_date,
        confidence: extraction.confidence,
        extracted_fields: {
          shop_name: extraction.shop.name,
          receipt_date: extraction.receipt_date,
          total: extraction.total,
          parts_count: partsFound,
          labor_count: laborItemsCreated,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[receipt-photo-ocr] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// GPT-4o VISION EXTRACTION (automotive-specific)
// ============================================================

async function extractWithVision(
  imageUrl: string,
  pass1Data: any | null,
): Promise<ReceiptExtraction> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  // Fetch image
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = btoa(
    new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
  );
  const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

  const pass1Context = pass1Data
    ? `\nPrior OCR pass extracted: ${JSON.stringify(pass1Data).slice(0, 500)}`
    : "";

  const result = await callOpenAiChatCompletions({
    apiKey: openaiKey,
    timeoutMs: 45000,
    body: {
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert at reading automotive receipts, invoices, and work orders. Extract ALL information from this receipt photo, especially:
- Shop name, address, phone
- Receipt date and number
- Each line item with: description, category (part/labor/material/fee/other), part number, brand, quantity, unit price, total price, labor hours
- Subtotal, tax, total
- Labor rate ($/hr)
- Any vehicle reference (year/make/model, VIN, plate)${pass1Context}

Respond in JSON:
{
  "shop": {"name": null, "address": null, "phone": null, "website": null},
  "receipt_date": "YYYY-MM-DD or null",
  "receipt_number": "string or null",
  "vehicle_reference": "string or null",
  "line_items": [
    {
      "description": "string",
      "category": "part|labor|material|fee|other",
      "part_number": "string or null",
      "brand": "string or null",
      "quantity": 1,
      "unit_price": null,
      "total_price": 0,
      "labor_hours": null
    }
  ],
  "subtotal": null,
  "tax": null,
  "total": null,
  "payment_method": null,
  "labor_rate": null,
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
              text: "Extract all receipt/invoice data from this automotive service receipt.",
            },
          ],
        },
      ],
      max_tokens: 3000,
      temperature: 0.1,
      response_format: { type: "json_object" },
    },
  });

  if (!result.ok || !result.content) {
    throw new Error(`GPT-4o receipt extraction failed: ${result.error || "no content"}`);
  }

  const parsed = JSON.parse(result.content);

  return {
    shop: parsed.shop || { name: null, address: null, phone: null, website: null },
    receipt_date: parsed.receipt_date || null,
    receipt_number: parsed.receipt_number || null,
    vehicle_reference: parsed.vehicle_reference || null,
    line_items: (parsed.line_items || []).map((item: any) => ({
      description: item.description || "",
      category: item.category || "other",
      part_number: item.part_number || null,
      brand: item.brand || null,
      quantity: item.quantity || 1,
      unit_price: item.unit_price ?? null,
      total_price: item.total_price || 0,
      labor_hours: item.labor_hours ?? null,
    })),
    subtotal: parsed.subtotal ?? null,
    tax: parsed.tax ?? null,
    total: parsed.total ?? null,
    payment_method: parsed.payment_method || null,
    labor_rate: parsed.labor_rate ?? null,
    confidence: parsed.confidence || 0.7,
  };
}
