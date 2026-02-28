/**
 * Haiku Extraction Worker
 *
 * The workhorse of the agent hierarchy. Uses claude-haiku-4-5 for:
 * - Extracting structured vehicle data from HTML/markdown
 * - Parsing listing titles into year/make/model
 * - Simple field extraction (price, mileage, VIN, colors, etc.)
 * - Image URL extraction from page content
 *
 * 10x cheaper than Sonnet for routine extraction. Escalates to
 * sonnet-supervisor when confidence is low or fields are missing.
 *
 * POST body:
 * {
 *   action: "extract_listing" | "parse_title" | "extract_fields" | "batch_extract",
 *   url?: string,
 *   html?: string,
 *   markdown?: string,
 *   title?: string,
 *   titles?: string[],       // for batch title parsing
 *   items?: Array<{url, html?, markdown?}>,  // for batch extraction
 *   import_queue_id?: string  // link back to import_queue
 * }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  callTier,
  parseJsonResponse,
  QUALITY_THRESHOLDS,
  type AgentCallResult,
} from "../_shared/agentTiers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Extraction Prompts ───────────────────────────────────────────────

const LISTING_EXTRACTION_SYSTEM = `You are a vehicle data extraction specialist. Extract structured data from vehicle listing pages with high precision.

RULES:
1. Extract ONLY what is explicitly stated — never infer or guess.
2. For prices, parse numbers from formatted strings (e.g., "$45,000" → 45000). Use the FINAL sale price if available, otherwise the asking/bid price.
3. For mileage, parse the number (e.g., "23,000 miles" → 23000). Use "TMU" for True Mileage Unknown.
4. For VINs, validate they are exactly 17 characters.
5. Normalize make names (e.g., "Chevy" → "Chevrolet", "Merc" → "Mercedes-Benz").
6. Extract ALL image URLs that show the vehicle. Skip logos, avatars, and ads.
7. Return null for any field you cannot confidently extract.
8. Include your confidence (0.0 to 1.0) for the overall extraction.

RESPOND WITH ONLY THIS JSON (no other text):
{
  "year": <number|null>,
  "make": <string|null>,
  "model": <string|null>,
  "trim": <string|null>,
  "vin": <string|null>,
  "mileage": <number|null>,
  "mileage_unit": <"miles"|"km"|null>,
  "exterior_color": <string|null>,
  "interior_color": <string|null>,
  "engine": <string|null>,
  "transmission": <"manual"|"automatic"|"semi-automatic"|"CVT"|null>,
  "drivetrain": <"RWD"|"FWD"|"AWD"|"4WD"|null>,
  "body_style": <string|null>,
  "title_text": <string|null>,
  "sale_price": <number|null>,
  "asking_price": <number|null>,
  "sale_status": <"sold"|"active"|"ended_no_sale"|"reserve_not_met"|null>,
  "auction_end_date": <string|null>,
  "seller_name": <string|null>,
  "seller_location": <string|null>,
  "description": <string|null - first 500 chars>,
  "image_urls": <string[]>,
  "source_platform": <string|null>,
  "confidence": <number 0.0-1.0>,
  "extraction_notes": <string|null - issues or ambiguities>
}`;

const TITLE_PARSE_SYSTEM = `You are a vehicle title parser. Extract year, make, model, and trim from vehicle listing titles.

RULES:
1. Year must be a 4-digit number between 1885 and 2027.
2. Normalize makes: "Chevy" → "Chevrolet", "Merc" → "Mercedes-Benz", "VW" → "Volkswagen".
3. Model should be the specific model name without trim info.
4. Trim is optional extra specification (e.g., "GT", "Sport", "Limited", "SS 396").
5. Ignore suffixes like "for sale on BaT Auctions", "- Cars & Bids", etc.
6. Return null for fields you cannot determine.

RESPOND WITH ONLY THIS JSON:
{
  "year": <number|null>,
  "make": <string|null>,
  "model": <string|null>,
  "trim": <string|null>,
  "confidence": <number 0.0-1.0>
}`;

const FIELD_EXTRACTION_SYSTEM = `You are a data extraction specialist. Extract specific fields from the provided text.
Return ONLY a JSON object with the requested fields. Use null for fields not found.
Be precise — extract only what is explicitly stated.`;

// ─── Core Functions ──────────────────────────────────────────────────

interface ExtractionResult {
  data: any;
  quality: {
    score: number;
    fieldsExtracted: number;
    totalFields: number;
    nullFields: string[];
    issues: string[];
  };
  tier: "haiku";
  cost: AgentCallResult;
  needsEscalation: boolean;
  escalationReason?: string;
}

/**
 * Extract vehicle data from a listing page's HTML or markdown.
 */
async function extractListing(
  content: string,
  url: string,
  contentType: "html" | "markdown",
): Promise<ExtractionResult> {
  // Truncate content to keep Haiku fast and cheap — 12k chars is plenty for structured extraction
  const truncated = content.slice(0, 12_000);
  const userMessage = `URL: ${url}\n\nPage content (${contentType}):\n${truncated}`;

  const result = await callTier("haiku", LISTING_EXTRACTION_SYSTEM, userMessage, {
    maxTokens: 2048,
  });

  let parsed: any;
  try {
    parsed = parseJsonResponse(result.content);
  } catch (e) {
    return {
      data: null,
      quality: {
        score: 0,
        fieldsExtracted: 0,
        totalFields: 15,
        nullFields: [],
        issues: [`JSON parse failed: ${(e as Error).message}`],
      },
      tier: "haiku",
      cost: result,
      needsEscalation: true,
      escalationReason: "haiku_json_parse_failure",
    };
  }

  // Assess extraction quality
  const quality = assessQuality(parsed);

  // Determine if escalation is needed
  let needsEscalation = false;
  let escalationReason: string | undefined;

  if (quality.score < QUALITY_THRESHOLDS.ESCALATION_THRESHOLD) {
    needsEscalation = true;
    escalationReason = `low_quality_score:${quality.score.toFixed(2)}`;
  } else if (!parsed.year && !parsed.make && !parsed.model) {
    needsEscalation = true;
    escalationReason = "no_ymm_extracted";
  } else if (parsed.confidence !== undefined && parsed.confidence < QUALITY_THRESHOLDS.MIN_YMM_CONFIDENCE) {
    needsEscalation = true;
    escalationReason = `low_confidence:${parsed.confidence}`;
  }

  return {
    data: parsed,
    quality,
    tier: "haiku",
    cost: result,
    needsEscalation,
    escalationReason,
  };
}

/**
 * Parse a listing title into year/make/model.
 */
async function parseTitle(title: string): Promise<{
  data: any;
  cost: AgentCallResult;
}> {
  const result = await callTier("haiku", TITLE_PARSE_SYSTEM, title, {
    maxTokens: 256,
  });
  const parsed = parseJsonResponse(result.content);
  return { data: parsed, cost: result };
}

/**
 * Parse a batch of titles (single Haiku call — efficient).
 */
async function parseTitleBatch(titles: string[]): Promise<{
  data: any[];
  cost: AgentCallResult;
}> {
  const numberedList = titles
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const batchSystem = `${TITLE_PARSE_SYSTEM}

You will receive multiple titles, one per line. Return a JSON array where each element corresponds to the input title at that position.`;

  const result = await callTier("haiku", batchSystem, numberedList, {
    maxTokens: 256 * titles.length,
  });
  const parsed = parseJsonResponse<any[]>(result.content);
  return { data: parsed, cost: result };
}

/**
 * Extract specific fields from text content.
 */
async function extractFields(
  text: string,
  fields: string[],
): Promise<{ data: any; cost: AgentCallResult }> {
  const userMessage = `Extract these fields: ${fields.join(", ")}\n\nText:\n${text.slice(0, 8000)}`;
  const result = await callTier("haiku", FIELD_EXTRACTION_SYSTEM, userMessage, {
    maxTokens: 1024,
  });
  const parsed = parseJsonResponse(result.content);
  return { data: parsed, cost: result };
}

// ─── Quality Assessment ─────────────────────────────────────────────

const KEY_FIELDS = [
  "year", "make", "model", "vin", "mileage", "exterior_color",
  "engine", "transmission", "sale_price", "asking_price",
  "seller_location", "description", "image_urls",
  "sale_status", "title_text",
];

function assessQuality(extracted: any): {
  score: number;
  fieldsExtracted: number;
  totalFields: number;
  nullFields: string[];
  issues: string[];
} {
  if (!extracted || typeof extracted !== "object") {
    return {
      score: 0,
      fieldsExtracted: 0,
      totalFields: KEY_FIELDS.length,
      nullFields: [...KEY_FIELDS],
      issues: ["Extraction returned non-object"],
    };
  }

  const nullFields: string[] = [];
  let extracted_count = 0;
  const issues: string[] = [];

  for (const field of KEY_FIELDS) {
    const val = extracted[field];
    if (val === null || val === undefined || val === "") {
      nullFields.push(field);
    } else if (field === "image_urls" && Array.isArray(val) && val.length === 0) {
      nullFields.push(field);
    } else {
      extracted_count++;
    }
  }

  // Validate specific fields
  if (extracted.vin && typeof extracted.vin === "string" && extracted.vin.length !== 17) {
    issues.push(`VIN length ${extracted.vin.length}, expected 17`);
  }
  if (extracted.year && (extracted.year < 1885 || extracted.year > 2027)) {
    issues.push(`Year ${extracted.year} out of valid range`);
  }
  if (extracted.mileage && extracted.mileage < 0) {
    issues.push(`Negative mileage: ${extracted.mileage}`);
  }
  if (extracted.sale_price && extracted.sale_price < 0) {
    issues.push(`Negative sale price: ${extracted.sale_price}`);
  }

  // No year/make/model is a major quality issue
  if (!extracted.year && !extracted.make && !extracted.model) {
    issues.push("No year, make, or model extracted");
  }

  const nullRatio = nullFields.length / KEY_FIELDS.length;
  let score = 1.0 - nullRatio;

  // Penalize for validation issues
  score -= issues.length * 0.1;

  // Bonus for having core YMM
  if (extracted.year && extracted.make && extracted.model) {
    score = Math.min(1.0, score + 0.15);
  }

  // Bonus for having price
  if (extracted.sale_price || extracted.asking_price) {
    score = Math.min(1.0, score + 0.05);
  }

  return {
    score: Math.max(0, Math.round(score * 100) / 100),
    fieldsExtracted: extracted_count,
    totalFields: KEY_FIELDS.length,
    nullFields,
    issues,
  };
}

// ─── Queue Integration ──────────────────────────────────────────────

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Process a batch of import_queue items using Haiku extraction.
 * Claims items, extracts, writes results, and tracks quality.
 */
async function processBatchFromQueue(
  batchSize: number,
  source?: string,
): Promise<{
  processed: number;
  succeeded: number;
  escalated: number;
  failed: number;
  totalCostCents: number;
  results: any[];
}> {
  const sb = getSupabase();
  const workerId = `haiku-worker-${crypto.randomUUID().slice(0, 8)}`;

  // Claim items from import_queue
  let query = sb
    .from("import_queue")
    .select("id, listing_url, listing_title, raw_data")
    .eq("status", "pending")
    .is("locked_by", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (source) {
    const sourceConfigs: Record<string, string> = {
      bat: "%bringatrailer.com%",
      carsandbids: "%carsandbids.com%",
      craigslist: "%craigslist.org%",
      hagerty: "%hagerty.com%",
      pcarmarket: "%pcarmarket.com%",
    };
    const pattern = sourceConfigs[source];
    if (pattern) {
      query = query.ilike("listing_url", pattern);
    }
  }

  const { data: items, error: claimError } = await query;
  if (claimError || !items?.length) {
    return {
      processed: 0,
      succeeded: 0,
      escalated: 0,
      failed: 0,
      totalCostCents: 0,
      results: [],
    };
  }

  // Lock the items
  const itemIds = items.map((i) => i.id);
  await sb
    .from("import_queue")
    .update({
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      status: "processing",
    })
    .in("id", itemIds);

  const results: any[] = [];
  let succeeded = 0;
  let escalated = 0;
  let failed = 0;
  let totalCostCents = 0;

  for (const item of items) {
    try {
      // Try to get archived content first
      const { data: snapshot } = await sb
        .from("listing_page_snapshots")
        .select("raw_html, markdown_content")
        .eq("url", item.listing_url)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const content = snapshot?.markdown_content || snapshot?.raw_html || "";

      let extraction: ExtractionResult;

      if (content.length > 200) {
        // We have archived content — extract from it
        extraction = await extractListing(
          content,
          item.listing_url,
          snapshot?.markdown_content ? "markdown" : "html",
        );
      } else if (item.listing_title) {
        // No archived content, but we have a title — parse that at least
        const titleResult = await parseTitle(item.listing_title);
        extraction = {
          data: {
            ...titleResult.data,
            title_text: item.listing_title,
          },
          quality: assessQuality(titleResult.data),
          tier: "haiku",
          cost: titleResult.cost,
          needsEscalation: true,
          escalationReason: "no_content_available_title_only",
        };
      } else {
        // Nothing to work with
        extraction = {
          data: null,
          quality: {
            score: 0,
            fieldsExtracted: 0,
            totalFields: KEY_FIELDS.length,
            nullFields: [...KEY_FIELDS],
            issues: ["No content or title available"],
          },
          tier: "haiku",
          cost: {
            content: "",
            tier: "haiku",
            model: "claude-haiku-4-5-20251001",
            inputTokens: 0,
            outputTokens: 0,
            costCents: 0,
            durationMs: 0,
            stopReason: "skip",
          },
          needsEscalation: true,
          escalationReason: "no_content_no_title",
        };
      }

      totalCostCents += extraction.cost.costCents;

      if (extraction.needsEscalation) {
        // Mark for escalation — sonnet-supervisor will pick these up
        await sb.from("import_queue").update({
          status: "pending_review",
          locked_by: null,
          locked_at: null,
          raw_data: {
            ...(item.raw_data || {}),
            haiku_extraction: extraction.data,
            haiku_quality: extraction.quality,
            haiku_cost: {
              inputTokens: extraction.cost.inputTokens,
              outputTokens: extraction.cost.outputTokens,
              costCents: extraction.cost.costCents,
              durationMs: extraction.cost.durationMs,
            },
            escalation_reason: extraction.escalationReason,
            haiku_processed_at: new Date().toISOString(),
          },
        }).eq("id", item.id);

        escalated++;
        results.push({
          id: item.id,
          url: item.listing_url,
          status: "escalated",
          reason: extraction.escalationReason,
          quality: extraction.quality.score,
        });
      } else if (extraction.data && extraction.quality.score >= QUALITY_THRESHOLDS.AUTO_APPROVE_THRESHOLD) {
        // High quality — auto-approve, write directly
        await sb.from("import_queue").update({
          status: "complete",
          locked_by: null,
          locked_at: null,
          processed_at: new Date().toISOString(),
          listing_year: extraction.data.year,
          listing_make: extraction.data.make,
          listing_model: extraction.data.model,
          listing_price: extraction.data.sale_price || extraction.data.asking_price,
          raw_data: {
            ...(item.raw_data || {}),
            haiku_extraction: extraction.data,
            haiku_quality: extraction.quality,
            haiku_cost: {
              inputTokens: extraction.cost.inputTokens,
              outputTokens: extraction.cost.outputTokens,
              costCents: extraction.cost.costCents,
              durationMs: extraction.cost.durationMs,
            },
            auto_approved: true,
            haiku_processed_at: new Date().toISOString(),
          },
        }).eq("id", item.id);

        succeeded++;
        results.push({
          id: item.id,
          url: item.listing_url,
          status: "completed",
          quality: extraction.quality.score,
          fields: extraction.quality.fieldsExtracted,
        });
      } else {
        // Medium quality — needs supervisor review
        await sb.from("import_queue").update({
          status: "pending_review",
          locked_by: null,
          locked_at: null,
          listing_year: extraction.data?.year,
          listing_make: extraction.data?.make,
          listing_model: extraction.data?.model,
          listing_price: extraction.data?.sale_price || extraction.data?.asking_price,
          raw_data: {
            ...(item.raw_data || {}),
            haiku_extraction: extraction.data,
            haiku_quality: extraction.quality,
            haiku_cost: {
              inputTokens: extraction.cost.inputTokens,
              outputTokens: extraction.cost.outputTokens,
              costCents: extraction.cost.costCents,
              durationMs: extraction.cost.durationMs,
            },
            needs_supervisor_review: true,
            haiku_processed_at: new Date().toISOString(),
          },
        }).eq("id", item.id);

        escalated++;
        results.push({
          id: item.id,
          url: item.listing_url,
          status: "pending_review",
          quality: extraction.quality.score,
          fields: extraction.quality.fieldsExtracted,
        });
      }
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[haiku-worker] Error processing ${item.id}: ${errMsg}`);

      await sb.from("import_queue").update({
        status: "failed",
        locked_by: null,
        locked_at: null,
        error_message: `haiku-worker: ${errMsg}`,
        last_attempt_at: new Date().toISOString(),
        attempts: (item as any).attempts ? (item as any).attempts + 1 : 1,
      }).eq("id", item.id);

      results.push({
        id: item.id,
        url: item.listing_url,
        status: "failed",
        error: errMsg,
      });
    }
  }

  return {
    processed: items.length,
    succeeded,
    escalated,
    failed,
    totalCostCents: Math.round(totalCostCents * 10000) / 10000,
    results,
  };
}

// ─── HTTP Handler ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "extract_listing";

    switch (action) {
      case "extract_listing": {
        const content = body.markdown || body.html || "";
        const url = body.url || "unknown";
        if (!content && !body.title) {
          return json(400, { error: "Provide html, markdown, or title" });
        }
        if (content) {
          const result = await extractListing(
            content,
            url,
            body.markdown ? "markdown" : "html",
          );
          return json(200, {
            success: true,
            ...result,
          });
        }
        // Title only
        const titleResult = await parseTitle(body.title);
        return json(200, {
          success: true,
          data: titleResult.data,
          tier: "haiku",
          cost: titleResult.cost,
        });
      }

      case "parse_title": {
        if (!body.title) {
          return json(400, { error: "Provide title" });
        }
        const result = await parseTitle(body.title);
        return json(200, { success: true, ...result });
      }

      case "parse_titles": {
        const titles = body.titles;
        if (!Array.isArray(titles) || titles.length === 0) {
          return json(400, { error: "Provide titles array" });
        }
        // Chunk into batches of 20 for efficiency
        const chunkSize = 20;
        const allData: any[] = [];
        let totalCost = 0;
        for (let i = 0; i < titles.length; i += chunkSize) {
          const chunk = titles.slice(i, i + chunkSize);
          const result = await parseTitleBatch(chunk);
          allData.push(...result.data);
          totalCost += result.cost.costCents;
        }
        return json(200, {
          success: true,
          data: allData,
          count: allData.length,
          totalCostCents: totalCost,
        });
      }

      case "extract_fields": {
        const text = body.text || body.html || body.markdown || "";
        const fields = body.fields || [];
        if (!text || !fields.length) {
          return json(400, { error: "Provide text and fields array" });
        }
        const result = await extractFields(text, fields);
        return json(200, { success: true, ...result });
      }

      case "batch_extract": {
        const batchSize = Math.min(body.batch_size || 5, 20);
        const source = body.source;
        const result = await processBatchFromQueue(batchSize, source);
        return json(200, { success: true, ...result });
      }

      case "health": {
        return json(200, {
          status: "healthy",
          tier: "haiku",
          model: "claude-haiku-4-5-20251001",
          capabilities: [
            "extract_listing",
            "parse_title",
            "parse_titles",
            "extract_fields",
            "batch_extract",
          ],
        });
      }

      default:
        return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[haiku-extraction-worker] Error: ${msg}`);
    return json(500, { error: msg });
  }
});
