/**
 * DOCUMENT INTELLIGENCE PIPELINE
 *
 * Analyzes vehicle documents (receipts, invoices, service records) using vision AI.
 * Extracts structured data and populates service_records table.
 *
 * POST /functions/v1/analyze-vehicle-documents
 * {
 *   "vehicle_id": "uuid",
 *   "document_ids": ["uuid", ...],  // optional - specific docs, otherwise all unprocessed
 *   "batch_size": 10                // optional - limit per run (default 10)
 * }
 *
 * Returns extracted service records and processing stats.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DocumentInput {
  vehicle_id: string;
  document_ids?: string[];
  batch_size?: number;
}

interface ExtractedServiceRecord {
  service_date: string | null;
  mileage: number | null;
  shop_name: string | null;
  shop_location: string | null;
  work_performed: string;
  cost: number | null;
  parts_replaced: string[];
  service_type: string;
  confidence_score: number;
}

// Well-structured prompt explaining the PROBLEM and expected output
const RECEIPT_ANALYSIS_PROMPT = `You are a document intelligence system specialized in analyzing automotive service receipts and invoices.

## YOUR TASK
Analyze this receipt/invoice image and extract structured service record data. This data will be used to build a comprehensive maintenance history for the vehicle.

## CONTEXT
- This is a receipt from automotive work (repair, maintenance, parts, restoration)
- The vehicle owner needs accurate records for: resale value documentation, maintenance tracking, and cost analysis
- Extract ALL relevant information visible in the document

## EXTRACTION REQUIREMENTS

Extract the following fields. Use null for fields you cannot determine with confidence:

1. **service_date**: When was the work done? Format: YYYY-MM-DD
2. **mileage**: Vehicle mileage at time of service (integer, no commas)
3. **shop_name**: Name of the business/shop/vendor
4. **shop_location**: City, State or full address if visible
5. **work_performed**: Detailed description of ALL work done. Be thorough - list each service item.
6. **cost**: Total amount paid (number only, no $ or commas). Include tax if shown as part of total.
7. **parts_replaced**: Array of specific parts mentioned (e.g., ["oil filter", "brake pads", "spark plugs"])
8. **service_type**: Categorize as ONE of:
   - "maintenance" (oil changes, fluid services, filters, tune-ups)
   - "repair" (fixing broken/worn components)
   - "restoration" (rebuild, refinish, restore to original)
   - "modification" (upgrades, aftermarket parts, custom work)
   - "inspection" (safety inspection, pre-purchase inspection)
   - "parts_purchase" (parts only, no labor)
   - "other"
9. **confidence_score**: How confident are you in this extraction? (0.0 to 1.0)
   - 1.0 = crystal clear receipt, all fields readable
   - 0.7 = most fields clear, some inference needed
   - 0.5 = partial information, some guessing
   - Below 0.5 = poor quality, significant uncertainty

## OUTPUT FORMAT
Respond with ONLY valid JSON, no markdown or explanation:
{
  "service_date": "YYYY-MM-DD" or null,
  "mileage": number or null,
  "shop_name": "string" or null,
  "shop_location": "string" or null,
  "work_performed": "detailed description of all work",
  "cost": number or null,
  "parts_replaced": ["part1", "part2"] or [],
  "service_type": "maintenance|repair|restoration|modification|inspection|parts_purchase|other",
  "confidence_score": 0.0-1.0,
  "extraction_notes": "any relevant notes about what you found or couldn't read"
}

## IMPORTANT
- If the image is NOT a receipt/invoice (wrong document type), return: {"error": "not_a_receipt", "detected_type": "what it actually is"}
- If the image is unreadable/too blurry, return: {"error": "unreadable", "reason": "description"}
- Be precise with costs - don't guess if numbers aren't clear
- For parts_replaced, list actual parts not services (e.g., "oil filter" not "oil change")`;

async function analyzeDocument(
  anthropic: Anthropic,
  imageUrl: string
): Promise<ExtractedServiceRecord | { error: string; [key: string]: any }> {
  try {
    // Fetch the image and convert to base64
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return { error: "fetch_failed", reason: `HTTP ${imageResponse.status}` };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    // Determine media type
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const mediaType = contentType.includes("png") ? "image/png" :
                      contentType.includes("webp") ? "image/webp" :
                      contentType.includes("gif") ? "image/gif" : "image/jpeg";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: "text",
            text: RECEIPT_ANALYSIS_PROMPT
          }
        ]
      }]
    });

    const content = response.content[0];
    if (content.type === "text") {
      // Extract JSON from response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    return { error: "parse_failed", reason: "Could not extract JSON from response" };
  } catch (e: any) {
    return { error: "analysis_failed", reason: e.message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const anthropic = new Anthropic({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? ""
  });

  try {
    const input: DocumentInput = await req.json();

    if (!input.vehicle_id) {
      return new Response(JSON.stringify({ error: "vehicle_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const batchSize = input.batch_size || 10;

    // Fetch documents to process
    let query = supabase
      .from("vehicle_documents")
      .select("id, file_url, file_type, document_type, title, vendor_name")
      .eq("vehicle_id", input.vehicle_id)
      .eq("document_type", "receipt")
      .not("file_url", "is", null);

    // If specific document IDs provided, use those
    if (input.document_ids?.length) {
      query = query.in("id", input.document_ids);
    } else {
      // Only get unprocessed documents (vendor_name is null means not yet analyzed)
      query = query.is("vendor_name", null);
    }

    const { data: documents, error: docsError } = await query.limit(batchSize);

    if (docsError) {
      throw new Error(`Failed to fetch documents: ${docsError.message}`);
    }

    if (!documents?.length) {
      // Check total documents for context
      const { count } = await supabase
        .from("vehicle_documents")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", input.vehicle_id)
        .eq("document_type", "receipt");

      return new Response(JSON.stringify({
        success: true,
        message: count ? "All documents have been processed" : "No receipt documents found",
        processed: 0,
        service_records_created: 0,
        total_receipts: count || 0
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Process each document
    const results: any[] = [];
    let serviceRecordsCreated = 0;
    let errors = 0;

    for (const doc of documents) {
      console.log(`Processing document ${doc.id}: ${doc.file_url}`);

      const extraction = await analyzeDocument(anthropic, doc.file_url);

      if ('error' in extraction) {
        // Mark as processed with error by setting vendor_name to error indicator
        await supabase
          .from("vehicle_documents")
          .update({ vendor_name: `[ERROR: ${extraction.error}]` })
          .eq("id", doc.id);

        results.push({
          document_id: doc.id,
          status: "error",
          error: extraction.error,
          details: extraction
        });
        errors++;
        continue;
      }

      // Valid extraction - create service record
      const { data: serviceRecord, error: insertError } = await supabase
        .from("service_records")
        .insert({
          vehicle_id: input.vehicle_id,
          service_date: extraction.service_date,
          mileage: extraction.mileage,
          shop_name: extraction.shop_name,
          shop_location: extraction.shop_location,
          work_performed: extraction.work_performed,
          cost: extraction.cost,
          parts_replaced: extraction.parts_replaced,
          service_type: extraction.service_type,
          documentation_available: true,
          source: `document:${doc.id}`,
          confidence_score: extraction.confidence_score
        })
        .select()
        .single();

      if (insertError) {
        results.push({
          document_id: doc.id,
          status: "insert_error",
          error: insertError.message
        });
        errors++;
        continue;
      }

      // Mark document as processed by updating extracted fields
      await supabase
        .from("vehicle_documents")
        .update({
          amount: extraction.cost,
          vendor_name: extraction.shop_name || "[EXTRACTED]",
          description: extraction.work_performed?.substring(0, 500)
        })
        .eq("id", doc.id);

      results.push({
        document_id: doc.id,
        status: "success",
        service_record_id: serviceRecord.id,
        extraction: {
          service_date: extraction.service_date,
          shop_name: extraction.shop_name,
          cost: extraction.cost,
          service_type: extraction.service_type,
          confidence: extraction.confidence_score
        }
      });
      serviceRecordsCreated++;
    }

    // Get remaining unprocessed count
    const { count: remainingCount } = await supabase
      .from("vehicle_documents")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", input.vehicle_id)
      .eq("document_type", "receipt")
      .is("vendor_name", null);

    return new Response(JSON.stringify({
      success: true,
      vehicle_id: input.vehicle_id,
      processed: documents.length,
      service_records_created: serviceRecordsCreated,
      errors,
      remaining_documents: remainingCount || 0,
      results
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
