/**
 * Document OCR Worker — Classification + Extraction + Batch Orchestration
 *
 * Processes items from document_ocr_queue through three stages:
 *   1. Classification — Identify document type + orientation (Gemini Flash, free)
 *   2. Extraction — OCR all fields (Claude Sonnet → GPT-4o → xAI fallback)
 *   3. Linking — Trigger link-document-entities for entity creation
 *
 * Modes:
 *   classify  — Classify a single document
 *   extract   — Extract data from a classified document
 *   process   — Full classify → extract → link pipeline for one document
 *   batch     — Pull N pending items from queue, process sequentially
 *   status    — Queue statistics
 *
 * POST /functions/v1/document-ocr-worker
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

const WORKER_ID = `ocr-worker-${crypto.randomUUID().slice(0, 8)}`;

// ─── DOCUMENT TYPE PROMPTS ─────────────────────────────────────────────────
// Extended from ds-extract-document DOC_PROMPTS with additional types

const DOC_PROMPTS: Record<string, string> = {
  title: `Extract ALL fields from this vehicle title/certificate of title:
- vin, year, make, model, body_style
- title_number, state (2-letter), issue_date (YYYY-MM-DD)
- owner_names (array), owner_address
- lienholder_name, lienholder_address
- odometer (number, no commas), odometer_status (Actual/Exempt/Not Actual/Exceeds Mechanical Limits)
- brand (Clean/Salvage/Rebuilt/Flood/Junk or null)`,

  bill_of_sale: `Extract ALL fields from this bill of sale:
- vin, year, make, model
- buyer_name, buyer_address
- seller_name, seller_address
- sale_date (YYYY-MM-DD), sale_price (number, no $ or commas)
- odometer (number), tax_amount (number)
- payment_method, notary_date`,

  buyers_order: `Extract ALL fields from this buyer's order / purchase agreement:
- vin, year, make, model, color, stock_number
- buyer_name, buyer_address, buyer_phone
- seller_name (dealership), seller_address
- sale_price, trade_allowance, trade_vehicle_year, trade_vehicle_make, trade_vehicle_model, trade_vehicle_vin
- down_payment, amount_financed, lender_name, apr, term_months, monthly_payment
- fees (array of {description, amount}): doc fee, tax, registration, smog, etc.
- total_price, deal_date (YYYY-MM-DD), salesperson`,

  cost_sheet: `Extract ALL fields from this dealer cost sheet / deal recap:
- vin, year, make, model, trim, color, stock_number, deal_number
- initial_cost (what dealer paid), invoice_cost
- reconditioning_costs (array of {item, cost}), total_reconditioning
- shipping_cost, pack_amount
- total_cost, sale_price, gross_profit
- acquired_from, acquired_date (YYYY-MM-DD)
- sold_to, sold_date (YYYY-MM-DD), salesperson, commission`,

  repair_order: `Extract ALL fields from this repair order / work order:
- ro_number, vin, year, make, model, mileage
- customer_name, customer_phone
- date_in (YYYY-MM-DD), date_out (YYYY-MM-DD)
- labor_items (array of {description, hours, rate, amount})
- parts (array of {part_number, description, quantity, unit_price, amount})
- sublet_items (array of {vendor, description, amount})
- total_labor, total_parts, total_sublet, total_amount
- technician, service_advisor`,

  odometer_disclosure: `Extract ALL fields from this odometer disclosure statement:
- vin, year, make, model
- odometer_reading (number), odometer_date (YYYY-MM-DD)
- odometer_status (Actual/Exempt/Not Actual/Exceeds Mechanical Limits)
- seller_name, seller_address
- buyer_name, buyer_address
- seller_signature_present (true/false), buyer_signature_present (true/false)`,

  deal_jacket: `Extract ALL fields from this dealer deal jacket / deal recap sheet:
- stock_number, deal_number, sold_date (YYYY-MM-DD)
- buyer_name, buyer_address, salesperson
- seller_entity (dealership name)
- vin, year, make, model, trim, color, odometer
- purchase_cost, listing_fee, shipping_cost
- reconditioning_items (array of {description, amount, vendor_name})
- total_reconditioning, total_cost
- sale_price, gross_profit
- trade_in_year, trade_in_make, trade_in_model, trade_in_vin, trade_in_allowance`,

  receipt: `Extract ALL fields from this receipt / invoice:
- vendor_name, vendor_address, vendor_phone
- receipt_number, invoice_number, date (YYYY-MM-DD)
- line_items (array of {description, quantity, unit_price, amount})
- subtotal, tax, total
- payment_method
- any vehicle reference: vin, year, make, model, stock_number`,

  auction_slip: `Extract ALL fields from this auction slip / run sheet:
- auction_house, auction_date (YYYY-MM-DD), auction_location
- lot_number, run_number, lane
- vin, year, make, model, color, odometer
- seller_name, seller_number
- high_bid, sale_price, buyer_fee, seller_fee
- sold (true/false), condition_announcements
- title_status, arbitration_deadline`,

  smog_certificate: `Extract ALL fields from this smog/emissions certificate:
- station_name, station_number, technician
- vin, year, make, model, license_plate
- test_date (YYYY-MM-DD), result (pass/fail)
- odometer, certificate_number
- next_due_date if visible`,

  registration: `Extract ALL fields from this vehicle registration:
- vin, year, make, model, body_type, color
- license_plate, state
- registered_owner, owner_address
- registration_date (YYYY-MM-DD), expiration_date (YYYY-MM-DD)
- fees_paid, use_class`,

  insurance_card: `Extract ALL fields from this insurance card/declaration:
- insured_name, policy_number
- vin, year, make, model
- coverage_type, effective_date (YYYY-MM-DD), expiration_date (YYYY-MM-DD)
- insurer_name, agent_name`,

  shipping_bill: `Extract ALL fields from this shipping/transport bill:
- carrier_name, carrier_address
- pickup_location, delivery_location
- vin, year, make, model
- ship_date (YYYY-MM-DD), delivery_date (YYYY-MM-DD)
- distance, transport_cost, condition_at_pickup, condition_at_delivery`,

  consignment_agreement: `Extract ALL fields from this consignment agreement:
- consignor_name, consignor_address
- consignee_name (dealer/auction), consignee_address
- vin, year, make, model, odometer
- agreed_price, commission_rate, commission_amount
- agreement_date (YYYY-MM-DD), expiration_date
- terms, conditions`,

  lien_release: `Extract ALL fields from this lien release / lien satisfaction:
- lienholder_name, lienholder_address
- vin, year, make, model
- borrower_name
- loan_number, release_date (YYYY-MM-DD)
- original_amount, satisfaction_date`,

  other: `Extract ALL readable text and data from this document:
- document_title or heading
- any vehicle info: vin, year, make, model
- any names, addresses, dates, amounts
- any identifiers (stock numbers, reference numbers, etc.)`,
};

const ALL_DOC_TYPES = Object.keys(DOC_PROMPTS);

// ─── CLASSIFICATION PROMPT ─────────────────────────────────────────────────

const CLASSIFY_PROMPT = `Classify this document image. Return ONLY valid JSON:
{
  "document_type": "one of: ${ALL_DOC_TYPES.join(', ')}",
  "confidence": 0-100,
  "orientation_degrees": 0 | 90 | 180 | 270,
  "key_identifiers": {
    "vin": "if visible",
    "stock_number": "if visible",
    "date": "if visible",
    "names": ["any names visible"]
  }
}

Rules:
- Choose the MOST SPECIFIC type that matches
- confidence 90+ = clearly matches one type
- confidence 60-89 = partially matches, some ambiguity
- confidence below 60 = uncertain
- orientation_degrees = how much the image needs to be rotated clockwise to be right-side-up (0 if already correct)
- If you cannot read the document at all, use type "other" with low confidence`;

// ─── EXTRACTION PROMPT ─────────────────────────────────────────────────────

const BASE_EXTRACT_PROMPT = `You are a precision OCR system for vehicle dealership documents.

CRITICAL RULES:
- ONLY extract text you can ACTUALLY READ in the image
- If you cannot read a field, set it to null
- NEVER guess or fabricate values - use null instead
- VINs must be exactly 17 characters for post-1981 vehicles
- Dollar amounts: plain numbers only (no $ or commas)
- Dates: YYYY-MM-DD format

Return ONLY valid JSON with this structure:
{
  "document_type": "the type",
  "document_type_confidence": 0-100,
  "extracted_data": { ... all fields for this document type ... },
  "confidences": { "field_name": 0-100 for each extracted field },
  "raw_ocr_text": "150-250 chars of key text verbatim from the document"
}`;

function buildExtractionPrompt(docType: string): string {
  const typePrompt = DOC_PROMPTS[docType] || DOC_PROMPTS['other'];
  return `${BASE_EXTRACT_PROMPT}\n\nThis is a "${docType}" document. Extract these specific fields:\n${typePrompt}`;
}

// ─── VIN VALIDATION (from ds-extract-document) ─────────────────────────────

function validateVin(vin: string | null | undefined): { valid: boolean; reason?: string } {
  if (!vin) return { valid: true };
  if (vin.length < 5) return { valid: false, reason: 'too_short' };
  if (vin.length === 17) {
    if (/[IOQ]/i.test(vin)) return { valid: false, reason: 'invalid_chars_ioq' };
    if (/123456/.test(vin)) return { valid: false, reason: 'fake_pattern' };
    return { valid: true };
  }
  if (vin.length > 5 && vin.length < 17) return { valid: true };
  return { valid: false, reason: 'wrong_length' };
}

// ─── POST-PROCESS (from ds-extract-document) ───────────────────────────────

function postProcessResult(result: any): { data: any; needsReview: boolean; reviewReasons: string[] } {
  const reviewReasons: string[] = [];
  const confidences = result.confidences || {};
  const data = result.extracted_data || {};

  const vinCheck = validateVin(data.vin);
  if (!vinCheck.valid) {
    confidences.vin = Math.min(confidences.vin || 0, 50);
    reviewReasons.push(`VIN validation: ${vinCheck.reason}`);
  }

  if (data.year && (data.year < 1886 || data.year > 2027)) {
    confidences.year = Math.min(confidences.year || 0, 30);
    reviewReasons.push(`Year out of range: ${data.year}`);
  }

  const suspectNames = ['john doe', 'jane doe', 'john smith', 'jane smith', 'test user'];
  const names = [data.buyer_name, data.seller_name, data.sold_to, data.customer_name,
                 data.consignor_name, data.consignee_name, data.insured_name]
    .filter(Boolean).map((n: string) => n.toLowerCase());
  for (const name of names) {
    if (suspectNames.includes(name)) {
      reviewReasons.push(`Suspicious name: ${name}`);
    }
  }

  const criticalFields = ['vin', 'year', 'make', 'model', 'sale_price', 'buyer_name', 'seller_name', 'owner_names'];
  for (const field of criticalFields) {
    const conf = confidences[field];
    if (conf !== undefined && conf < 90 && data[field] !== null && data[field] !== undefined) {
      reviewReasons.push(`Low confidence on ${field}: ${conf}`);
    }
  }

  const needsReview = reviewReasons.length > 0 || (result.document_type_confidence || 0) < 80;
  return { data: { ...result, confidences }, needsReview, reviewReasons };
}

// ─── IMAGE UTILITIES ───────────────────────────────────────────────────────

// Matches Supabase storage URLs: .../storage/v1/object/public/<bucket>/<path>
const SUPABASE_STORAGE_RE = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/;

async function bufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[]);
  }
  return btoa(binary);
}

async function getImageAsBase64(storagePath: string): Promise<{ base64: string; mediaType: string }> {
  // Full URL — try direct fetch first, fall back to signed URL for private buckets
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    const resp = await fetch(storagePath);
    if (resp.ok) {
      const buffer = await resp.arrayBuffer();
      return { base64: await bufferToBase64(buffer), mediaType: resp.headers.get("content-type") || "image/jpeg" };
    }

    // Direct fetch failed — likely a private bucket. Parse bucket/path and generate signed URL.
    const match = storagePath.match(SUPABASE_STORAGE_RE);
    if (match) {
      const [, bucket, path] = match;
      const { data: signedData } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
      if (signedData?.signedUrl) {
        const signedResp = await fetch(signedData.signedUrl);
        if (signedResp.ok) {
          const buffer = await signedResp.arrayBuffer();
          return { base64: await bufferToBase64(buffer), mediaType: signedResp.headers.get("content-type") || "image/jpeg" };
        }
      }
    }

    throw new Error(`Cannot access image: ${storagePath}`);
  }

  // Relative path — use deal-documents bucket (files live at e.g. "documents/2026/..." within this bucket)
  const { data: signedData, error: signError } = await supabase.storage
    .from("deal-documents")
    .createSignedUrl(storagePath, 600);

  if (signError || !signedData?.signedUrl) {
    const publicUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/deal-documents/${storagePath}`;
    const resp = await fetch(publicUrl);
    if (!resp.ok) throw new Error(`Cannot access image: ${storagePath}`);
    const buffer = await resp.arrayBuffer();
    return { base64: await bufferToBase64(buffer), mediaType: resp.headers.get("content-type") || "image/jpeg" };
  }

  const resp = await fetch(signedData.signedUrl);
  if (!resp.ok) throw new Error(`Failed to fetch signed URL: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return { base64: await bufferToBase64(buffer), mediaType: resp.headers.get("content-type") || "image/jpeg" };
}

function getImageUrl(storagePath: string): string {
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    return storagePath;
  }
  return `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/deal-documents/${storagePath}`;
}

// ─── CLASSIFICATION (Gemini Flash — free tier) ─────────────────────────────

async function classifyWithGemini(base64Image: string): Promise<any> {
  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY not configured");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: CLASSIFY_PROMPT },
            { inline_data: { mime_type: "image/jpeg", data: base64Image } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1000 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini ${response.status}: ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
}

async function classifyWithGPT4o(imageUrl: string): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: CLASSIFY_PROMPT },
          { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
        ],
      }],
      max_tokens: 500,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`OpenAI classify ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

async function classifyWithClaude(base64Image: string, mediaType: string): Promise<any> {
  const apiKey = Deno.env.get("NUKE_CLAUDE_API") || Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("No Anthropic API key");

  const mType = mediaType.includes("png") ? "image/png" : mediaType.includes("webp") ? "image/webp" : "image/jpeg";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mType, data: base64Image } },
          { type: "text", text: CLASSIFY_PROMPT + "\n\nRespond with ONLY the JSON object." },
        ],
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic classify ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("Empty Anthropic response");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
}

async function classifyDocument(storagePath: string): Promise<{ document_type: string; confidence: number; orientation_degrees: number; provider: string }> {
  const { base64, mediaType } = await getImageAsBase64(storagePath);

  // Try Gemini Flash first (free)
  try {
    const result = await classifyWithGemini(base64);
    if (result.confidence >= 70) {
      return { ...result, provider: "google" };
    }
    // Low confidence — escalate
    console.log(`Gemini confidence ${result.confidence} < 70, escalating`);
  } catch (e) {
    console.warn("Gemini classification failed:", (e as Error).message);
  }

  // Fallback to Claude Haiku (fast + cheap)
  try {
    const result = await classifyWithClaude(base64, mediaType);
    return { ...result, provider: "anthropic" };
  } catch (e) {
    console.warn("Claude classification failed:", (e as Error).message);
  }

  // Last resort: GPT-4o
  try {
    const imageUrl = getImageUrl(storagePath);
    const result = await classifyWithGPT4o(imageUrl);
    return { ...result, provider: "openai" };
  } catch (e) {
    console.warn("GPT-4o classification failed:", (e as Error).message);
  }

  return { document_type: "other", confidence: 0, orientation_degrees: 0, provider: "none" };
}

// ─── EXTRACTION (Claude Sonnet → GPT-4o → xAI) ────────────────────────────

async function extractWithClaude(base64Image: string, mediaType: string, docType: string): Promise<any> {
  const apiKey = Deno.env.get("NUKE_CLAUDE_API") || Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("No Anthropic API key");

  const mType = mediaType.includes("png") ? "image/png" : mediaType.includes("webp") ? "image/webp" : "image/jpeg";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mType, data: base64Image } },
          { type: "text", text: buildExtractionPrompt(docType) + "\n\nRespond with ONLY the JSON object, no markdown fences." },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic ${response.status}: ${err.substring(0, 300)}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("Empty Anthropic response");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  const usage = data.usage || {};

  return {
    result: parsed,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    tokens_input: usage.input_tokens || 0,
    tokens_output: usage.output_tokens || 0,
    cost_usd: ((usage.input_tokens || 0) * 3 / 1_000_000) + ((usage.output_tokens || 0) * 15 / 1_000_000),
  };
}

async function extractWithOpenAI(imageUrl: string, docType: string): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("No OpenAI API key");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: buildExtractionPrompt(docType) },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      }],
      max_tokens: 4000,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) throw new Error(`OpenAI extract ${response.status}`);
  const data = await response.json();
  const usage = data.usage || {};

  return {
    result: JSON.parse(data.choices[0].message.content),
    provider: "openai",
    model: "gpt-4o",
    tokens_input: usage.prompt_tokens || 0,
    tokens_output: usage.completion_tokens || 0,
    cost_usd: ((usage.prompt_tokens || 0) * 5 / 1_000_000) + ((usage.completion_tokens || 0) * 15 / 1_000_000),
  };
}

async function extractWithXAI(imageUrl: string, docType: string): Promise<any> {
  const apiKey = Deno.env.get("XAI_API_KEY");
  if (!apiKey) throw new Error("No xAI API key");

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-2-vision-1212",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: buildExtractionPrompt(docType) + "\n\nReturn ONLY valid JSON." },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      }],
      max_tokens: 4000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) throw new Error(`xAI extract ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const jsonMatch = content?.match(/\{[\s\S]*\}/);

  return {
    result: jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content),
    provider: "xai",
    model: "grok-2-vision-1212",
    tokens_input: 0,
    tokens_output: 0,
    cost_usd: 0.02, // Estimate
  };
}

async function extractDocument(storagePath: string, docType: string): Promise<any> {
  const { base64, mediaType } = await getImageAsBase64(storagePath);
  const imageUrl = getImageUrl(storagePath);
  const errors: string[] = [];

  // Try Claude Sonnet first (best at dense document OCR)
  try {
    return await extractWithClaude(base64, mediaType, docType);
  } catch (e) {
    errors.push(`Claude: ${(e as Error).message}`);
    console.warn("Claude extraction failed:", (e as Error).message);
  }

  // Fallback: GPT-4o
  try {
    return await extractWithOpenAI(imageUrl, docType);
  } catch (e) {
    errors.push(`GPT-4o: ${(e as Error).message}`);
    console.warn("GPT-4o extraction failed:", (e as Error).message);
  }

  // Last resort: xAI
  try {
    return await extractWithXAI(imageUrl, docType);
  } catch (e) {
    errors.push(`xAI: ${(e as Error).message}`);
  }

  throw new Error(`All providers failed: ${errors.join(" | ")}`);
}

// ─── COST TRACKING ─────────────────────────────────────────────────────────

async function trackCost(extraction: any) {
  try {
    const today = new Date().toISOString().split("T")[0];
    // Try upsert — increment if exists
    const { data: existing } = await supabase
      .from("ds_cost_tracking")
      .select("id, total_extractions, total_cost_usd, total_tokens_input, total_tokens_output")
      .eq("date", today)
      .eq("provider", extraction.provider)
      .eq("model", extraction.model)
      .maybeSingle();

    if (existing) {
      await supabase.from("ds_cost_tracking").update({
        total_extractions: (existing.total_extractions || 0) + 1,
        total_cost_usd: (existing.total_cost_usd || 0) + (extraction.cost_usd || 0),
        total_tokens_input: (existing.total_tokens_input || 0) + (extraction.tokens_input || 0),
        total_tokens_output: (existing.total_tokens_output || 0) + (extraction.tokens_output || 0),
      }).eq("id", existing.id);
    } else {
      await supabase.from("ds_cost_tracking").insert({
        date: today,
        provider: extraction.provider,
        model: extraction.model,
        total_extractions: 1,
        total_cost_usd: extraction.cost_usd || 0,
        total_tokens_input: extraction.tokens_input || 0,
        total_tokens_output: extraction.tokens_output || 0,
      });
    }
  } catch (e) {
    console.warn("Cost tracking failed:", (e as Error).message);
  }
}

// ─── QUEUE OPERATIONS ──────────────────────────────────────────────────────

async function lockQueueItem(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("document_ocr_queue")
    .update({ locked_at: new Date().toISOString(), locked_by: WORKER_ID })
    .eq("id", id)
    .is("locked_at", null);
  return !error;
}

async function unlockQueueItem(id: string) {
  await supabase
    .from("document_ocr_queue")
    .update({ locked_at: null, locked_by: null })
    .eq("id", id);
}

async function updateQueueStatus(id: string, status: string, updates: Record<string, any> = {}) {
  await supabase
    .from("document_ocr_queue")
    .update({ status, locked_at: null, locked_by: null, ...updates })
    .eq("id", id);
}

async function failQueueItem(id: string, error: string, attempts: number) {
  const backoffMinutes = Math.pow(2, attempts) * 5; // 10, 20, 40 min
  await supabase
    .from("document_ocr_queue")
    .update({
      status: "failed",
      error_message: error.substring(0, 500),
      attempts,
      locked_at: null,
      locked_by: null,
      next_attempt_at: new Date(Date.now() + backoffMinutes * 60000).toISOString(),
    })
    .eq("id", id);
}

// ─── PROCESS SINGLE QUEUE ITEM ─────────────────────────────────────────────

async function processQueueItem(item: any): Promise<any> {
  const startTime = Date.now();
  const attempts = (item.attempts || 0) + 1;

  // Lock the row
  if (!(await lockQueueItem(item.id))) {
    return { id: item.id, skipped: true, reason: "already_locked" };
  }

  try {
    // Stage 1: Classification
    await updateQueueStatus(item.id, "classifying", { locked_at: new Date().toISOString(), locked_by: WORKER_ID });
    const classification = await classifyDocument(item.storage_path);

    // Skip non-documents
    if (classification.confidence < 30 || classification.document_type === "other" && classification.confidence < 50) {
      await updateQueueStatus(item.id, "skipped", {
        document_type: classification.document_type,
        document_type_confidence: classification.confidence,
        attempts,
      });
      return { id: item.id, status: "skipped", document_type: classification.document_type, confidence: classification.confidence };
    }

    // Stage 2: Extraction
    await updateQueueStatus(item.id, "extracting", {
      document_type: classification.document_type,
      document_type_confidence: classification.confidence,
      orientation_degrees: classification.orientation_degrees || 0,
      locked_at: new Date().toISOString(),
      locked_by: WORKER_ID,
    });

    const extraction = await extractDocument(item.storage_path, classification.document_type);
    const { data: processedData, needsReview, reviewReasons } = postProcessResult(extraction.result);

    // Track cost
    await trackCost(extraction);

    // Update queue with extraction results
    await updateQueueStatus(item.id, "linking", {
      extraction_provider: extraction.provider,
      extraction_model: extraction.model,
      extraction_data: processedData,
      extraction_cost_usd: extraction.cost_usd,
      attempts,
      locked_at: new Date().toISOString(),
      locked_by: WORKER_ID,
    });

    // Update deal_documents with OCR data
    if (item.deal_document_id) {
      await supabase.from("deal_documents").update({
        document_type: classification.document_type,
        ocr_data: {
          status: "extracted",
          extracted_at: new Date().toISOString(),
          provider: extraction.provider,
          model: extraction.model,
          data: processedData,
          needs_review: needsReview,
          review_reasons: reviewReasons,
        },
      }).eq("id", item.deal_document_id);
    }

    // Stage 3: Entity linking — call link-document-entities
    let linkResult: any = null;
    try {
      const linkResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/link-document-entities`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            queue_id: item.id,
            deal_document_id: item.deal_document_id,
            document_type: classification.document_type,
            extraction_data: processedData,
            storage_path: item.storage_path,
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      linkResult = await linkResp.json();
    } catch (e) {
      console.warn("Entity linking failed (non-fatal):", (e as Error).message);
    }

    // Mark complete
    await updateQueueStatus(item.id, "complete", {
      linked_vehicle_id: linkResult?.vehicle_id || null,
      linked_deal_id: linkResult?.deal_id || null,
      linked_organization_ids: linkResult?.organization_ids || null,
      linked_contact_ids: linkResult?.contact_ids || null,
      observation_ids: linkResult?.observation_ids || null,
      attempts,
    });

    return {
      id: item.id,
      status: "complete",
      document_type: classification.document_type,
      confidence: classification.confidence,
      provider: extraction.provider,
      cost_usd: extraction.cost_usd,
      needs_review: needsReview,
      entities_linked: linkResult || null,
      duration_ms: Date.now() - startTime,
    };
  } catch (err) {
    console.error(`Processing failed for ${item.id}:`, err);
    await failQueueItem(item.id, (err as Error).message, attempts);
    return {
      id: item.id,
      status: "failed",
      error: (err as Error).message.substring(0, 200),
      attempts,
      duration_ms: Date.now() - startTime,
    };
  }
}

// ─── BATCH PROCESSING ──────────────────────────────────────────────────────

async function processBatch(limit: number): Promise<any> {
  // Pull pending items first
  const { data: pendingItems } = await supabase
    .from("document_ocr_queue")
    .select("*")
    .eq("status", "pending")
    .is("locked_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  // Also pull retryable failed items
  const { data: retryItems } = await supabase
    .from("document_ocr_queue")
    .select("*")
    .eq("status", "failed")
    .is("locked_at", null)
    .lt("next_attempt_at", new Date().toISOString())
    .lt("attempts", 3)
    .order("next_attempt_at", { ascending: true })
    .limit(Math.max(0, limit - (pendingItems?.length || 0)));

  const items = [...(pendingItems || []), ...(retryItems || [])].slice(0, limit);
  const error = null;

  if (error || !items?.length) {
    return { processed: 0, message: items?.length === 0 ? "Queue empty" : error?.message };
  }

  const results = { processed: 0, completed: 0, failed: 0, skipped: 0, total_cost_usd: 0, details: [] as any[] };

  for (const item of items) {
    const result = await processQueueItem(item);
    results.processed++;
    if (result.status === "complete") results.completed++;
    else if (result.status === "failed") results.failed++;
    else if (result.status === "skipped") results.skipped++;
    results.total_cost_usd += result.cost_usd || 0;
    results.details.push(result);
  }

  return results;
}

// ─── STATUS ────────────────────────────────────────────────────────────────

async function getQueueStatus(): Promise<any> {
  // Count by status
  const statuses = ["pending", "classifying", "extracting", "linking", "complete", "failed", "skipped"];
  const statusCounts: Record<string, number> = {};

  for (const s of statuses) {
    const { count } = await supabase
      .from("document_ocr_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    statusCounts[s] = count || 0;
  }

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  // Locked items (stale?)
  const { count: lockedCount } = await supabase
    .from("document_ocr_queue")
    .select("*", { count: "exact", head: true })
    .not("locked_at", "is", null);

  // Cost summary
  const { data: costData } = await supabase
    .from("document_pipeline_cost_summary")
    .select("*")
    .limit(7);

  return {
    total,
    by_status: statusCounts,
    locked: lockedCount || 0,
    progress_pct: total > 0 ? Math.round(((statusCounts.complete || 0) + (statusCounts.skipped || 0)) / total * 100) : 0,
    cost_last_7_days: costData || [],
  };
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { mode = "batch", queue_id, storage_path, document_type_hint, limit = 100 } = body;

    if (mode === "status") {
      const status = await getQueueStatus();
      return json({ ...status, mode: "status" });
    }

    if (mode === "classify" && storage_path) {
      const result = await classifyDocument(storage_path);
      return json({ ...result, mode: "classify", duration_ms: Date.now() - startTime });
    }

    if (mode === "extract" && storage_path) {
      const docType = document_type_hint || "other";
      const extraction = await extractDocument(storage_path, docType);
      const { data, needsReview, reviewReasons } = postProcessResult(extraction.result);
      await trackCost(extraction);
      return json({
        ...data,
        _provider: extraction.provider,
        _model: extraction.model,
        _cost_usd: extraction.cost_usd,
        _needs_review: needsReview,
        _review_reasons: reviewReasons,
        mode: "extract",
        duration_ms: Date.now() - startTime,
      });
    }

    if (mode === "process" && queue_id) {
      const { data: item } = await supabase
        .from("document_ocr_queue")
        .select("*")
        .eq("id", queue_id)
        .single();
      if (!item) return json({ error: "Queue item not found" }, 404);
      const result = await processQueueItem(item);
      return json({ ...result, mode: "process" });
    }

    if (mode === "batch") {
      const result = await processBatch(limit);
      return json({ ...result, mode: "batch", worker: WORKER_ID, duration_ms: Date.now() - startTime });
    }


    return json({ error: "Unknown mode. Use: classify, extract, process, batch, status" }, 400);
  } catch (err) {
    console.error("Worker error:", err);
    return json({ error: (err as Error).message, duration_ms: Date.now() - startTime }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
