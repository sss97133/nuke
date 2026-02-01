/**
 * SCHEMA DISCOVERY: Document Field Enumeration
 *
 * Samples documents and discovers ALL fields present before extraction.
 * This prevents the "define schema → extract → miss fields → re-extract" problem.
 *
 * POST /functions/v1/discover-document-fields
 * {
 *   "vehicle_id": "uuid",           // optional - scope to one vehicle
 *   "document_type": "receipt",     // required - what kind of docs
 *   "sample_size": 20,              // optional - how many to sample (default 20)
 *   "output_format": "markdown"     // optional - "markdown" or "json" (default markdown)
 * }
 *
 * Returns a comprehensive field catalog with frequencies.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DiscoveryInput {
  vehicle_id?: string;
  document_type: string;
  sample_size?: number;
  output_format?: "markdown" | "json";
}

interface DiscoveredField {
  field_name: string;
  description: string;
  data_type: string;
  sample_values: string[];
}

const FIELD_DISCOVERY_PROMPT = `You are a document analyst performing SCHEMA DISCOVERY.

## YOUR TASK
Examine this document image and list EVERY distinct piece of information visible.
Do NOT extract values - just enumerate what TYPES of information exist.

## OUTPUT FORMAT
List each field you observe. For each field provide:
- field_name: A snake_case name for this field
- description: What this field contains
- data_type: string, number, date, boolean, array, currency, etc.
- sample_value: One example value you see (to confirm the field type)

## IMPORTANT
- Be EXHAUSTIVE - list everything, even minor fields
- Include header info, footer info, fine print
- Note repeated structures (line items, lists)
- Include any reference numbers, codes, timestamps

Respond with ONLY valid JSON array:
[
  {
    "field_name": "vendor_name",
    "description": "Name of the business/shop",
    "data_type": "string",
    "sample_value": "AutoZone"
  },
  {
    "field_name": "transaction_date",
    "description": "Date of the transaction",
    "data_type": "date",
    "sample_value": "2021-04-15"
  },
  ...
]

List ALL fields, no matter how minor. This is discovery - we want completeness.`;

async function discoverFieldsFromDocument(
  anthropic: Anthropic,
  imageUrl: string
): Promise<DiscoveredField[] | { error: string }> {
  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return { error: `fetch_failed: HTTP ${imageResponse.status}` };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const mediaType = contentType.includes("png") ? "image/png" :
                      contentType.includes("webp") ? "image/webp" :
                      contentType.includes("gif") ? "image/gif" : "image/jpeg";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
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
            text: FIELD_DISCOVERY_PROMPT
          }
        ]
      }]
    });

    const content = response.content[0];
    if (content.type === "text") {
      // Try to extract JSON array - handle markdown code blocks
      let text = content.text;

      // Remove markdown code blocks if present
      text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error("JSON parse error:", e, "Raw text:", jsonMatch[0].substring(0, 500));
          return { error: `json_parse_error: ${e}` };
        }
      }

      console.error("No JSON array found in response:", text.substring(0, 500));
    }

    return { error: "parse_failed: no JSON array in response" };
  } catch (e: any) {
    return { error: e.message };
  }
}

function aggregateFields(allFields: DiscoveredField[][], docCount: number): Map<string, {
  field_name: string;
  description: string;
  data_type: string;
  sample_values: string[];
  frequency: number;
  frequency_pct: number;
}> {
  const fieldMap = new Map<string, {
    field_name: string;
    descriptions: Set<string>;
    data_types: Set<string>;
    sample_values: Set<string>;
    count: number;
  }>();

  for (const docFields of allFields) {
    const seenInDoc = new Set<string>();

    for (const field of docFields) {
      const key = field.field_name.toLowerCase();

      if (!seenInDoc.has(key)) {
        seenInDoc.add(key);

        if (!fieldMap.has(key)) {
          fieldMap.set(key, {
            field_name: field.field_name,
            descriptions: new Set(),
            data_types: new Set(),
            sample_values: new Set(),
            count: 0
          });
        }

        const entry = fieldMap.get(key)!;
        entry.count++;
        entry.descriptions.add(field.description);
        entry.data_types.add(field.data_type);
        if (field.sample_values) {
          field.sample_values.forEach(v => entry.sample_values.add(v));
        }
      }
    }
  }

  // Convert to final format
  const result = new Map<string, {
    field_name: string;
    description: string;
    data_type: string;
    sample_values: string[];
    frequency: number;
    frequency_pct: number;
  }>();

  for (const [key, entry] of fieldMap) {
    result.set(key, {
      field_name: entry.field_name,
      description: Array.from(entry.descriptions)[0], // Take first description
      data_type: Array.from(entry.data_types).join(" | "), // Combine if multiple
      sample_values: Array.from(entry.sample_values).slice(0, 5),
      frequency: entry.count,
      frequency_pct: Math.round((entry.count / docCount) * 100)
    });
  }

  return result;
}

function generateMarkdown(
  fields: Map<string, any>,
  docType: string,
  sampleSize: number,
  successCount: number
): string {
  const sorted = Array.from(fields.values()).sort((a, b) => b.frequency_pct - a.frequency_pct);

  let md = `# Schema Discovery: ${docType}\n\n`;
  md += `**Sampled:** ${successCount} of ${sampleSize} documents\n`;
  md += `**Discovered:** ${sorted.length} distinct fields\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;

  md += `---\n\n`;

  md += `## Field Catalog\n\n`;
  md += `| Field | Type | Frequency | Description |\n`;
  md += `|-------|------|-----------|-------------|\n`;

  for (const field of sorted) {
    md += `| \`${field.field_name}\` | ${field.data_type} | ${field.frequency_pct}% | ${field.description} |\n`;
  }

  md += `\n---\n\n`;

  md += `## Recommended Schema\n\n`;
  md += `Based on frequency analysis:\n\n`;

  md += `### Required Columns (90%+ frequency)\n`;
  md += `\`\`\`sql\n`;
  for (const field of sorted.filter(f => f.frequency_pct >= 90)) {
    const sqlType = field.data_type.includes("date") ? "DATE" :
                    field.data_type.includes("number") || field.data_type.includes("currency") ? "NUMERIC" :
                    field.data_type.includes("boolean") ? "BOOLEAN" :
                    field.data_type.includes("array") ? "TEXT[]" : "TEXT";
    md += `${field.field_name} ${sqlType},\n`;
  }
  md += `\`\`\`\n\n`;

  md += `### Optional Columns (50-89% frequency)\n`;
  md += `\`\`\`sql\n`;
  for (const field of sorted.filter(f => f.frequency_pct >= 50 && f.frequency_pct < 90)) {
    const sqlType = field.data_type.includes("date") ? "DATE" :
                    field.data_type.includes("number") || field.data_type.includes("currency") ? "NUMERIC" :
                    field.data_type.includes("boolean") ? "BOOLEAN" :
                    field.data_type.includes("array") ? "TEXT[]" : "TEXT";
    md += `${field.field_name} ${sqlType},\n`;
  }
  md += `\`\`\`\n\n`;

  md += `### Metadata Fields (10-49% frequency)\n`;
  md += `Consider storing in JSONB \`metadata\` column:\n`;
  md += `\`\`\`\n`;
  for (const field of sorted.filter(f => f.frequency_pct >= 10 && f.frequency_pct < 50)) {
    md += `- ${field.field_name}: ${field.description}\n`;
  }
  md += `\`\`\`\n\n`;

  md += `### Rare Fields (<10% frequency)\n`;
  for (const field of sorted.filter(f => f.frequency_pct < 10)) {
    md += `- \`${field.field_name}\` (${field.frequency_pct}%): ${field.description}\n`;
  }

  md += `\n---\n\n`;
  md += `## Sample Values\n\n`;

  for (const field of sorted.slice(0, 15)) {
    if (field.sample_values.length > 0) {
      md += `**${field.field_name}:** ${field.sample_values.slice(0, 3).map(v => `\`${v}\``).join(", ")}\n`;
    }
  }

  return md;
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
    const input: DiscoveryInput = await req.json();

    if (!input.document_type) {
      return new Response(JSON.stringify({ error: "document_type required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const sampleSize = input.sample_size || 20;
    const outputFormat = input.output_format || "markdown";

    // Fetch sample documents
    let query = supabase
      .from("vehicle_documents")
      .select("id, file_url, vehicle_id")
      .eq("document_type", input.document_type)
      .not("file_url", "is", null)
      .limit(sampleSize);

    if (input.vehicle_id) {
      query = query.eq("vehicle_id", input.vehicle_id);
    }

    const { data: documents, error: docsError } = await query;

    if (docsError) {
      throw new Error(`Failed to fetch documents: ${docsError.message}`);
    }

    if (!documents?.length) {
      return new Response(JSON.stringify({
        error: "No documents found",
        document_type: input.document_type
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Discovering fields from ${documents.length} ${input.document_type} documents...`);

    // Process each document
    const allDiscoveredFields: DiscoveredField[][] = [];
    const errors: string[] = [];

    for (const doc of documents) {
      console.log(`Processing document ${doc.id}...`);

      const result = await discoverFieldsFromDocument(anthropic, doc.file_url);

      if ('error' in result) {
        errors.push(`${doc.id}: ${result.error}`);
      } else {
        // Add sample_value to sample_values array for aggregation
        const normalized = result.map(f => ({
          ...f,
          sample_values: f.sample_value ? [f.sample_value] : []
        }));
        allDiscoveredFields.push(normalized);
      }
    }

    if (allDiscoveredFields.length === 0) {
      return new Response(JSON.stringify({
        error: "No documents could be processed",
        errors
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Aggregate fields across all documents
    const aggregated = aggregateFields(allDiscoveredFields, allDiscoveredFields.length);

    if (outputFormat === "markdown") {
      const markdown = generateMarkdown(
        aggregated,
        input.document_type,
        documents.length,
        allDiscoveredFields.length
      );

      return new Response(JSON.stringify({
        success: true,
        document_type: input.document_type,
        documents_sampled: documents.length,
        documents_processed: allDiscoveredFields.length,
        fields_discovered: aggregated.size,
        errors: errors.length > 0 ? errors : undefined,
        markdown
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // JSON format
    return new Response(JSON.stringify({
      success: true,
      document_type: input.document_type,
      documents_sampled: documents.length,
      documents_processed: allDiscoveredFields.length,
      fields_discovered: aggregated.size,
      errors: errors.length > 0 ? errors : undefined,
      fields: Array.from(aggregated.values()).sort((a, b) => b.frequency_pct - a.frequency_pct)
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
