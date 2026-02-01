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
  shop_phone: string | null;
  shop_email: string | null;
  work_performed: string;
  cost: number | null;
  parts_replaced: string[];
  service_type: string;
  confidence_score: number;
  // New detailed fields
  invoice_number: string | null;
  labor_hours: number | null;
  labor_rate: number | null;
  labor_cost: number | null;
  parts_cost: number | null;
  tax_amount: number | null;
  subtotal: number | null;
  payment_method: string | null;
  technician_name: string | null;
  warranty_info: string | null;
}

// Well-structured prompt explaining the PROBLEM and expected output
const RECEIPT_ANALYSIS_PROMPT = `You are a document intelligence system specialized in analyzing automotive service receipts and invoices.

## YOUR TASK
Analyze this receipt/invoice image and extract MAXIMUM structured data. This builds a comprehensive maintenance history for vehicle valuation and documentation.

## CONTEXT
- This is a receipt from automotive work (repair, maintenance, parts, restoration)
- The vehicle owner needs accurate records for: resale value, maintenance tracking, cost analysis, warranty claims
- Extract EVERY piece of information visible - be exhaustive

## EXTRACTION REQUIREMENTS

Extract ALL of the following. Use null for fields not visible or unclear:

### Basic Info
1. **service_date**: When was the work done? Format: YYYY-MM-DD
2. **mileage**: Vehicle mileage/odometer at time of service (integer)
3. **invoice_number**: Receipt/invoice/work order number

### Shop/Vendor Info
4. **shop_name**: Business name
5. **shop_location**: Full address or City, State
6. **shop_phone**: Phone number if visible
7. **shop_email**: Email if visible
8. **technician_name**: Name of mechanic/technician if listed

### Work Details
9. **work_performed**: Detailed description of ALL work. List each line item.
10. **parts_replaced**: Array of specific parts (e.g., ["oil filter", "brake pads"])
11. **service_type**: One of: maintenance, repair, restoration, modification, inspection, parts_purchase, other

### Cost Breakdown
12. **parts_cost**: Parts/materials subtotal (number, no $)
13. **labor_hours**: Total labor hours billed
14. **labor_rate**: Hourly labor rate if shown
15. **labor_cost**: Labor subtotal (number, no $)
16. **subtotal**: Before tax total
17. **tax_amount**: Tax amount (number, no $)
18. **cost**: Final total amount paid (number, no $)
19. **payment_method**: cash, credit, check, etc. if shown

### Warranty & Notes
20. **warranty_info**: Any warranty terms, guarantee period, or coverage notes
21. **confidence_score**: Your confidence 0.0-1.0

## OUTPUT FORMAT
Respond with ONLY valid JSON, no markdown:
{
  "service_date": "YYYY-MM-DD" or null,
  "mileage": number or null,
  "invoice_number": "string" or null,
  "shop_name": "string" or null,
  "shop_location": "string" or null,
  "shop_phone": "string" or null,
  "shop_email": "string" or null,
  "technician_name": "string" or null,
  "work_performed": "detailed description",
  "parts_replaced": ["part1", "part2"] or [],
  "service_type": "maintenance|repair|restoration|modification|inspection|parts_purchase|other",
  "parts_cost": number or null,
  "labor_hours": number or null,
  "labor_rate": number or null,
  "labor_cost": number or null,
  "subtotal": number or null,
  "tax_amount": number or null,
  "cost": number or null,
  "payment_method": "string" or null,
  "warranty_info": "string" or null,
  "confidence_score": 0.0-1.0,
  "extraction_notes": "any relevant notes"
}

## IMPORTANT
- If NOT a receipt/invoice: {"error": "not_a_receipt", "detected_type": "what it is"}
- If unreadable: {"error": "unreadable", "reason": "description"}
- Be precise with numbers - don't guess
- Capture EVERYTHING visible - this is for permanent vehicle records`;

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

      // Create timeline event with full extracted data
      const eventType = extraction.service_type === 'maintenance' ? 'maintenance' :
                        extraction.service_type === 'repair' ? 'repair' :
                        extraction.service_type === 'modification' ? 'modification' : 'service';

      // Create timeline event - ignore trigger errors
      try {
        await supabase
        .from("timeline_events")
        .insert({
          vehicle_id: input.vehicle_id,
          event_type: eventType,
          source: 'receipt_extraction',
          source_type: 'receipt',
          title: `${extraction.shop_name || 'Service'} - ${extraction.service_type || 'service'}`,
          description: extraction.work_performed,
          event_date: extraction.service_date || new Date().toISOString().split('T')[0],
          service_provider_name: extraction.shop_name,
          service_provider_type: 'independent_shop',
          location_name: extraction.shop_location,
          cost_amount: extraction.cost,
          mileage_at_event: extraction.mileage,
          parts_mentioned: extraction.parts_replaced,
          invoice_number: extraction.invoice_number,
          labor_hours: extraction.labor_hours,
          warranty_info: extraction.warranty_info ? { terms: extraction.warranty_info } : null,
          receipt_data: {
            invoice_number: extraction.invoice_number,
            labor_hours: extraction.labor_hours,
            labor_rate: extraction.labor_rate,
            labor_cost: extraction.labor_cost,
            parts_cost: extraction.parts_cost,
            subtotal: extraction.subtotal,
            tax_amount: extraction.tax_amount,
            payment_method: extraction.payment_method,
            technician_name: extraction.technician_name,
            shop_phone: extraction.shop_phone,
            shop_email: extraction.shop_email,
            warranty_info: extraction.warranty_info
          },
          confidence_score: Math.round((extraction.confidence_score || 0.7) * 100),
          data_source: 'ai_extraction',
          event_category: 'maintenance'
        });
      } catch (timelineError) {
        console.log('Timeline event creation failed (trigger issue):', timelineError);
        // Continue anyway - service record was created
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
          invoice_number: extraction.invoice_number,
          labor_hours: extraction.labor_hours,
          tax_amount: extraction.tax_amount,
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
