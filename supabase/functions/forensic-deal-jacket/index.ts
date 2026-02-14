import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── FORENSIC DEAL JACKET PROMPT ──────────────────────────────────────────────
// This is intentionally long and specific. Generic OCR misses the accounting tricks.
const FORENSIC_PROMPT = `You are a forensic accountant analyzing a dealer deal jacket (vehicle dealership sales document).
Your job is to extract EVERY number, EVERY line item, EVERY fee, and EVERY calculation on this document with extreme precision.

Deal jackets are internal dealer accounting documents that track the full financial lifecycle of a vehicle sale:
acquisition cost → reconditioning expenses → sale price → profit calculation.

Dealers often use these to inflate expenses, create phantom costs, and minimize reported profit.
Your job is to extract the raw data so it can be audited.

EXTRACTION REQUIREMENTS:

1. DEAL HEADER:
   - stock_number, deal_number
   - sold_date (YYYY-MM-DD), consignment_date (YYYY-MM-DD if visible)
   - seller_entity (the dealership/consignor name)
   - buyer_name, buyer_address, buyer_city, buyer_state, buyer_zip
   - buyer_phone, buyer_email
   - salesperson / assigned_from

2. VEHICLE INFO:
   - year, make, model, trim, series
   - vin (exact characters, preserve ambiguous B/8 etc)
   - odometer, color
   - notes (any condition notes visible)

3. ACQUISITION COSTS (every line):
   - purchase_cost (what they paid for the vehicle)
   - listing_fee (auction listing/buying fee)
   - travel_shipping_cost
   - isa_purchase_cost (inter-store/entity transfer cost)
   - isa_sale_fee (inter-store sale fee/credit)
   - any_1099_amounts
   - total_pre_recon (subtotal before reconditioning)

4. RECONDITIONING LINE ITEMS — THIS IS THE MOST IMPORTANT SECTION.
   Extract EVERY SINGLE LINE as an object:
   {
     "line_number": sequential,
     "description": "exactly what's written - vendor name, service description, any codes",
     "sub_calculations": "any math shown (e.g. '73.10+79+18.45')",
     "amount": dollar amount (positive number),
     "vendor_named": true/false (is a real vendor/shop named?),
     "vendor_name": "extracted vendor name or null",
     "is_round_number": true/false (amounts like 2000, 2500, 5000 are suspicious),
     "has_receipt_indicators": true/false (invoice #, date, specific parts listed)
   }

   Common recon items: paint, body work, upholstery, mechanical, tires, detail,
   dry ice blasting, fuel, transport, auction fees, parts, labor.

   CRITICAL: Capture the EXACT text for each line. Don't summarize or clean up.
   If you see cryptic abbreviations, preserve them exactly.

5. SALE DETAILS:
   - sale_price
   - document_fee
   - dealer_handling_fee
   - warranty_contract_price
   - service_contract_price
   - smog_fee
   - other_fees (array of {description, amount})
   - taxable_sales_proceeds
   - sales_tax_rate, sales_tax_amount
   - total_gross_sale_proceeds

6. TRADE-IN (if present):
   - trade_year, trade_make, trade_model, trade_vin
   - trade_odometer, trade_color
   - trade_allowance (what they gave the customer)
   - trade_payoff (any lien payoff)
   - trade_acv (actual cash value to dealer)
   - trade_lien_holder

7. PROFIT CALCULATIONS — extract ALL profit lines:
   - total_reconditioning
   - total_cost (all-in cost)
   - gross_profit_before_adjustments
   - Any named deductions (e.g. "LWI", "Investment", "Commission", "Pack")
   - each_deduction: [{name, amount, description_of_what_it_is}]
   - final_gross_profit (the bottom line number, often highlighted)

8. INVESTMENT/FINANCING ENTRIES:
   - Any "investment" lines (e.g. "Laura Wynn Investment", "LWI")
   - investor_name, investment_amount, roi_amount, investment_notes
   - These are often phantom entries — extract them exactly as written

9. PAYMENT TRACKING:
   - total_payment_received, payment_date
   - balance_due, balance_due_date
   - payment_method if visible

10. RAW TEXT:
    - Transcribe any handwritten notes
    - Capture any crossed-out or modified numbers (note as "original: X, changed_to: Y")
    - Note any highlighted/boxed numbers

Return ONLY valid JSON:
{
  "deal_header": { ... },
  "vehicle": { ... },
  "acquisition": { line_items: [...], total_pre_recon: number },
  "reconditioning": { line_items: [...], total: number },
  "sale": { ... },
  "trade_in": { ... } or null,
  "profit": {
    total_cost: number,
    gross_before_adjustments: number,
    deductions: [...],
    final_gross_profit: number
  },
  "investments": [...],
  "payments": { ... },
  "raw_notes": "any handwritten or modified text",
  "math_verification": {
    "acquisition_adds_up": true/false,
    "recon_adds_up": true/false,
    "total_cost_matches": true/false,
    "profit_math_correct": true/false,
    "discrepancies": ["describe any math that doesn't add up"]
  }
}`;

// ─── FORENSIC ANALYSIS (post-OCR) ────────────────────────────────────────────

interface ReconLineItem {
  line_number: number;
  description: string;
  sub_calculations?: string;
  amount: number;
  vendor_named: boolean;
  vendor_name?: string | null;
  is_round_number: boolean;
  has_receipt_indicators: boolean;
}

interface TrustScore {
  level: "verified" | "partially_verified" | "unverified" | "suspicious";
  score: number; // 0.0 - 1.0
  reasons: string[];
  matching_receipts?: string[]; // receipt IDs that match
}

function analyzeExpenseTrust(item: ReconLineItem, matchingReceipts: any[]): TrustScore {
  const reasons: string[] = [];
  let score = 0.5; // start neutral

  // Vendor named = +0.15
  if (item.vendor_named && item.vendor_name) {
    score += 0.15;
    reasons.push(`Vendor named: ${item.vendor_name}`);
  } else {
    score -= 0.15;
    reasons.push("No vendor identified");
  }

  // Round numbers are suspicious
  if (item.is_round_number) {
    score -= 0.1;
    reasons.push("Round number amount (typical of estimates, not actual invoices)");
  }

  // Receipt indicators
  if (item.has_receipt_indicators) {
    score += 0.1;
    reasons.push("Has receipt indicators (invoice #, specific parts, dates)");
  }

  // Matching receipts in database = big boost
  if (matchingReceipts.length > 0) {
    score += 0.3;
    reasons.push(
      `${matchingReceipts.length} matching receipt(s) found in database`
    );
  } else {
    score -= 0.1;
    reasons.push("No matching receipts found in database");
  }

  // Amount-based suspicion
  if (item.amount > 3000 && !item.vendor_named) {
    score -= 0.15;
    reasons.push("Large amount (>$3k) with no vendor — high suspicion");
  }

  // Vague labor descriptions
  const desc = (item.description || "").toLowerCase();
  if (
    desc.includes("labor") &&
    !item.vendor_named &&
    item.is_round_number
  ) {
    score -= 0.1;
    reasons.push(
      "Vague labor charge with round number — likely self-billed"
    );
  }

  // Self-referential payments (money going back to dealer)
  if (
    desc.includes("commission") ||
    desc.includes("pack") ||
    desc.includes("handling")
  ) {
    score -= 0.05;
    reasons.push("Internal dealer charge — money stays in-house");
  }

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  // Determine level
  let level: TrustScore["level"];
  if (score >= 0.75) level = "verified";
  else if (score >= 0.5) level = "partially_verified";
  else if (score >= 0.25) level = "unverified";
  else level = "suspicious";

  return {
    level,
    score: Math.round(score * 100) / 100,
    reasons,
    matching_receipts: matchingReceipts.map((r: any) => r.id),
  };
}

function analyzeInvestmentTrust(investment: any): TrustScore {
  const reasons: string[] = [];
  let score = 0.1; // investments start very low trust

  reasons.push(
    "Investment/financing entry — requires wire transfer or bank statement proof"
  );

  if (investment.investment_amount > 10000) {
    score -= 0.05;
    reasons.push("Large investment amount — higher proof burden");
  }

  // If ROI is deducted from profit
  if (investment.roi_amount) {
    reasons.push(
      `ROI of $${investment.roi_amount} deducted from profit — reduces taxable income`
    );
    score -= 0.05;
  }

  return {
    level: "suspicious",
    score: Math.max(0, score),
    reasons,
  };
}

function generateForensicSummary(extraction: any, trustScores: any): any {
  const recon = extraction.reconditioning || {};
  const lineItems = recon.line_items || [];
  const profit = extraction.profit || {};

  // Categorize expenses by trust level
  const byLevel = { verified: 0, partially_verified: 0, unverified: 0, suspicious: 0 };
  const amountByLevel = { verified: 0, partially_verified: 0, unverified: 0, suspicious: 0 };

  for (const ts of trustScores.expense_trust || []) {
    byLevel[ts.trust.level as keyof typeof byLevel]++;
    amountByLevel[ts.trust.level as keyof typeof amountByLevel] += ts.amount || 0;
  }

  // Calculate the "real" profit if unverified/suspicious expenses were removed
  const questionableExpenses = amountByLevel.unverified + amountByLevel.suspicious;
  const reportedProfit = profit.final_gross_profit || 0;
  const adjustedProfit = reportedProfit + questionableExpenses;

  // Investment phantom amounts
  const investmentDeductions = (extraction.investments || []).reduce(
    (sum: number, inv: any) => sum + (inv.roi_amount || inv.investment_amount || 0), 0
  );

  return {
    headline: `${lineItems.length} expense line items, ${byLevel.verified + byLevel.partially_verified} have some validation, ${byLevel.unverified + byLevel.suspicious} are unverified/suspicious`,
    expense_breakdown: byLevel,
    amount_breakdown: amountByLevel,
    reported_profit: reportedProfit,
    questionable_expenses: questionableExpenses,
    adjusted_profit_if_unverified_removed: adjustedProfit,
    phantom_investment_deductions: investmentDeductions,
    true_profit_estimate: adjustedProfit + investmentDeductions,
    red_flags: [
      ...(recon.total > (extraction.acquisition?.total_pre_recon || 0) * 1.0
        ? [`Reconditioning ($${recon.total}) exceeds purchase price ($${extraction.acquisition?.total_pre_recon}) — ${Math.round((recon.total / (extraction.acquisition?.total_pre_recon || 1)) * 100)}% of acquisition cost`]
        : []),
      ...(investmentDeductions > 0
        ? [`Phantom investment deduction of $${investmentDeductions} reduces reported profit without proof of payment`]
        : []),
      ...(amountByLevel.suspicious > 1000
        ? [`$${amountByLevel.suspicious.toFixed(2)} in suspicious expenses (no vendor, round numbers, vague descriptions)`]
        : []),
      ...((extraction.math_verification?.discrepancies || []) as string[]),
    ],
    validation_needed: [
      ...lineItems
        .filter((_: any, i: number) =>
          (trustScores.expense_trust || [])[i]?.trust?.level === "unverified" ||
          (trustScores.expense_trust || [])[i]?.trust?.level === "suspicious"
        )
        .map((item: any) => ({
          description: item.description,
          amount: item.amount,
          proof_needed:
            item.vendor_named
              ? `Get invoice/receipt from ${item.vendor_name}`
              : "Need vendor name + receipt/invoice",
        })),
      ...(extraction.investments || []).map((inv: any) => ({
        description: `Investment: ${inv.investor_name || "unknown"}`,
        amount: inv.roi_amount || inv.investment_amount,
        proof_needed: "Wire transfer confirmation or bank statement",
      })),
    ],
  };
}

// ─── VISION EXTRACTION (Claude primary, OpenAI fallback) ──────────────────────

async function extractWithVision(imageUrl: string): Promise<any> {
  const errors: string[] = [];

  // Try Claude first (better at dense document OCR)
  const anthropicKey = Deno.env.get("NUKE_CLAUDE_API") || Deno.env.get("VITE_NUKE_CLAUDE_API") || Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("CLAUDE_API_KEY");
  if (anthropicKey) {
    try {
      return await extractWithClaude(imageUrl, anthropicKey);
    } catch (e) {
      const msg = (e as Error).message;
      console.warn("Claude failed:", msg);
      errors.push(`Claude: ${msg}`);
    }
  } else {
    errors.push("No ANTHROPIC_API_KEY or CLAUDE_API_KEY found");
  }

  // Fallback to OpenAI
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey) {
    try {
      return await extractWithOpenAI(imageUrl, openaiKey);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`OpenAI: ${msg}`);
    }
  }

  // Last resort: xAI (grok-2-vision)
  const xaiKey = Deno.env.get("XAI_API_KEY");
  if (xaiKey) {
    try {
      return await extractWithXAI(imageUrl, xaiKey);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`xAI: ${msg}`);
    }
  }

  throw new Error(`All providers failed: ${errors.join(" | ")}`);
}

async function extractWithClaude(imageUrl: string, apiKey: string): Promise<any> {
  // Fetch image and convert to base64
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.status}`);

  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = btoa(
    new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
  );
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  const mediaType = contentType.includes("png") ? "image/png" :
                    contentType.includes("webp") ? "image/webp" : "image/jpeg";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
            { type: "text", text: FORENSIC_PROMPT + "\n\nIMPORTANT: The image may be upside down or rotated. Rotate mentally if needed. Respond with ONLY the JSON object, no markdown fences." },
          ],
        }],
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text;
    if (!content) throw new Error("Empty Anthropic response");

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

async function extractWithOpenAI(imageUrl: string, apiKey: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: FORENSIC_PROMPT },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        }],
        max_tokens: 4000,
        temperature: 0.05,
        response_format: { type: "json_object" },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty OpenAI response");

    return JSON.parse(content);
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

async function extractWithXAI(imageUrl: string, apiKey: string): Promise<any> {
  // xAI uses OpenAI-compatible API
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-2-vision-1212",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: FORENSIC_PROMPT + "\n\nIMPORTANT: The image may be upside down. Rotate mentally if needed. Return ONLY valid JSON." },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        }],
        max_tokens: 4000,
        temperature: 0.05,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`xAI ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty xAI response");

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const {
      image_id,
      image_url,
      vehicle_id,
      mode = "single", // "single" | "batch" | "revalidate" | "manual"
      limit = 10,
      store_results = true,
      extraction, // Pre-extracted JSON for "manual" mode (from Claude Code, Ollama, etc.)
    } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Resolve images to process ──
    let imagesToProcess: { id: string; url: string; vehicle_id: string | null }[] = [];

    if (mode === "batch") {
      // Find all deal jacket / documentation images that haven't been forensically analyzed
      const { data: images } = await supabase
        .from("vehicle_images")
        .select("id, image_url, vehicle_id, ai_extractions")
        .or(
          "category.eq.documentation,ai_scan_metadata->>tier_1_analysis->>category.eq.documentation"
        )
        .not("image_url", "is", null)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (images) {
        // Filter out already-analyzed ones
        imagesToProcess = images
          .filter(
            (img: any) =>
              !img.ai_extractions?.some(
                (e: any) => e.type === "forensic_deal_jacket"
              )
          )
          .map((img: any) => ({
            id: img.id,
            url: img.image_url,
            vehicle_id: img.vehicle_id,
          }));
      }
    } else if (mode === "revalidate" && vehicle_id) {
      // Re-run trust scoring against current receipts (no new OCR)
      const { data: images } = await supabase
        .from("vehicle_images")
        .select("id, image_url, vehicle_id, ai_extractions")
        .eq("vehicle_id", vehicle_id)
        .not("ai_extractions", "is", null);

      if (images) {
        // Find images with existing forensic extraction
        for (const img of images) {
          const existing = img.ai_extractions?.find(
            (e: any) => e.type === "forensic_deal_jacket"
          );
          if (existing) {
            imagesToProcess.push({
              id: img.id,
              url: img.image_url,
              vehicle_id: img.vehicle_id,
            });
          }
        }
      }
    } else {
      // Single image mode
      if (image_id) {
        const { data: img } = await supabase
          .from("vehicle_images")
          .select("id, image_url, vehicle_id")
          .eq("id", image_id)
          .single();
        if (img)
          imagesToProcess.push({
            id: img.id,
            url: img.image_url,
            vehicle_id: img.vehicle_id,
          });
      } else if (image_url) {
        imagesToProcess.push({
          id: "manual",
          url: image_url,
          vehicle_id: vehicle_id || null,
        });
      }
    }

    // ── Manual mode: pre-extracted JSON, just score + store ──
    if (mode === "manual" && extraction) {
      const imgId = image_id || "manual";
      const vId = vehicle_id || null;

      // Run trust scoring on the pre-extracted data
      const reconItems = extraction?.reconditioning?.line_items || [];
      const expenseTrust: any[] = [];

      // Get receipts for cross-reference
      let vehicleReceipts: any[] = [];
      if (vId) {
        const { data: receipts } = await supabase
          .from("receipts")
          .select("id, vendor_name, total, receipt_date")
          .eq("scope_id", vId)
          .limit(200);
        vehicleReceipts = receipts || [];
      }

      for (const item of reconItems) {
        const matchingReceipts = vehicleReceipts.filter((r: any) => {
          const amountClose = Math.abs(r.total - item.amount) / Math.max(item.amount, 1) < 0.1;
          const vendorMatch = item.vendor_name && r.vendor_name &&
            (r.vendor_name.toLowerCase().includes(item.vendor_name.toLowerCase()) ||
             item.vendor_name.toLowerCase().includes(r.vendor_name.toLowerCase()));
          return amountClose || vendorMatch;
        });
        expenseTrust.push({
          line_number: item.line_number,
          description: item.description,
          amount: item.amount,
          vendor: item.vendor_name,
          trust: analyzeExpenseTrust(item, matchingReceipts),
        });
      }

      const investmentTrust = (extraction?.investments || []).map((inv: any) => ({
        name: inv.investor_name,
        amount: inv.roi_amount || inv.investment_amount,
        trust: analyzeInvestmentTrust(inv),
      }));

      const forensicSummary = generateForensicSummary(extraction, { expense_trust: expenseTrust });

      // Store if requested
      if (store_results && imgId !== "manual") {
        const { data: currentImg } = await supabase
          .from("vehicle_images")
          .select("ai_extractions")
          .eq("id", imgId)
          .single();

        const existingExtractions = (currentImg?.ai_extractions || []).filter(
          (e: any) => e.type !== "forensic_deal_jacket"
        );

        await supabase
          .from("vehicle_images")
          .update({
            category: "documentation",
            ai_extractions: [
              ...existingExtractions,
              {
                type: "forensic_deal_jacket",
                provider: "manual",
                model: "pre-extracted",
                timestamp: new Date().toISOString(),
                result: extraction,
                trust_analysis: { expense_trust: expenseTrust, investment_trust: investmentTrust },
                forensic_summary: forensicSummary,
              },
            ],
            ai_last_scanned: new Date().toISOString(),
          })
          .eq("id", imgId);

        if (vId) {
          const { data: vehicle } = await supabase
            .from("vehicles")
            .select("origin_metadata")
            .eq("id", vId)
            .single();

          const meta = vehicle?.origin_metadata || {};
          meta.deal_jacket_forensics = {
            image_id: imgId,
            analyzed_at: new Date().toISOString(),
            stock_number: extraction?.deal_header?.stock_number,
            sold_date: extraction?.deal_header?.sold_date,
            sale_price: extraction?.sale?.sale_price,
            total_cost: extraction?.profit?.total_cost,
            reported_profit: extraction?.profit?.final_gross_profit,
            adjusted_profit: forensicSummary.true_profit_estimate,
            expense_count: reconItems.length,
            red_flag_count: forensicSummary.red_flags.length,
          };

          await supabase.from("vehicles").update({ origin_metadata: meta }).eq("id", vId);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          mode: "manual",
          extraction,
          trust_analysis: { expense_trust: expenseTrust, investment_trust: investmentTrust },
          forensic_summary: forensicSummary,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (imagesToProcess.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No images to process",
          duration_ms: Date.now() - startTime,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Process each image ──
    const results: any[] = [];

    for (const img of imagesToProcess) {
      const itemStart = Date.now();
      try {
        let extraction: any;

        if (mode === "revalidate") {
          // Use existing extraction, just re-score
          const { data: existingImg } = await supabase
            .from("vehicle_images")
            .select("ai_extractions")
            .eq("id", img.id)
            .single();

          const existing = existingImg?.ai_extractions?.find(
            (e: any) => e.type === "forensic_deal_jacket"
          );
          if (!existing) continue;
          extraction = existing.result;
        } else {
          // ── OCR with Claude (primary) or GPT-4o (fallback) ──
          extraction = await extractWithVision(img.url);
        }

        // ── Cross-reference expenses against receipts ──
        const reconItems = extraction?.reconditioning?.line_items || [];
        const expenseTrust: any[] = [];

        // Get all receipts for this vehicle (if vehicle_id exists)
        let vehicleReceipts: any[] = [];
        if (img.vehicle_id) {
          const { data: receipts } = await supabase
            .from("receipts")
            .select("id, vendor_name, total, receipt_date, line_items:receipt_items(description, total_price)")
            .or(
              `scope_id.eq.${img.vehicle_id},scope_id.eq.${img.vehicle_id}`
            )
            .limit(200);
          vehicleReceipts = receipts || [];
        }

        for (const item of reconItems) {
          // Try to match against receipts
          const matchingReceipts = vehicleReceipts.filter((r: any) => {
            // Amount match (within 10%)
            const amountClose =
              Math.abs(r.total - item.amount) / Math.max(item.amount, 1) < 0.1;
            // Vendor match (fuzzy)
            const vendorMatch =
              item.vendor_name &&
              r.vendor_name &&
              (r.vendor_name
                .toLowerCase()
                .includes(item.vendor_name.toLowerCase()) ||
                item.vendor_name
                  .toLowerCase()
                  .includes(r.vendor_name.toLowerCase()));
            return amountClose || vendorMatch;
          });

          const trust = analyzeExpenseTrust(item, matchingReceipts);
          expenseTrust.push({
            line_number: item.line_number,
            description: item.description,
            amount: item.amount,
            vendor: item.vendor_name,
            trust,
          });
        }

        // ── Score investments ──
        const investmentTrust = (extraction?.investments || []).map(
          (inv: any) => ({
            name: inv.investor_name,
            amount: inv.roi_amount || inv.investment_amount,
            trust: analyzeInvestmentTrust(inv),
          })
        );

        // ── Generate forensic summary ──
        const forensicSummary = generateForensicSummary(extraction, {
          expense_trust: expenseTrust,
        });

        const result = {
          image_id: img.id,
          vehicle_id: img.vehicle_id,
          extraction,
          trust_analysis: {
            expense_trust: expenseTrust,
            investment_trust: investmentTrust,
          },
          forensic_summary: forensicSummary,
          duration_ms: Date.now() - itemStart,
        };

        // ── Store results ──
        if (store_results && img.id !== "manual") {
          // Append to ai_extractions array
          const { data: currentImg } = await supabase
            .from("vehicle_images")
            .select("ai_extractions")
            .eq("id", img.id)
            .single();

          const existingExtractions = (currentImg?.ai_extractions || []).filter(
            (e: any) => e.type !== "forensic_deal_jacket"
          );

          await supabase
            .from("vehicle_images")
            .update({
              category: "documentation", // fix miscategorization
              ai_extractions: [
                ...existingExtractions,
                {
                  type: "forensic_deal_jacket",
                  provider: "openai",
                  model: "gpt-4o",
                  timestamp: new Date().toISOString(),
                  result: extraction,
                  trust_analysis: {
                    expense_trust: expenseTrust,
                    investment_trust: investmentTrust,
                  },
                  forensic_summary: forensicSummary,
                },
              ],
              ai_last_scanned: new Date().toISOString(),
            })
            .eq("id", img.id);

          // Also store on vehicle origin_metadata
          if (img.vehicle_id) {
            const { data: vehicle } = await supabase
              .from("vehicles")
              .select("origin_metadata")
              .eq("id", img.vehicle_id)
              .single();

            const meta = vehicle?.origin_metadata || {};
            meta.deal_jacket_forensics = {
              image_id: img.id,
              analyzed_at: new Date().toISOString(),
              stock_number: extraction?.deal_header?.stock_number,
              sold_date: extraction?.deal_header?.sold_date,
              sale_price: extraction?.sale?.sale_price,
              total_cost: extraction?.profit?.total_cost,
              reported_profit: extraction?.profit?.final_gross_profit,
              adjusted_profit: forensicSummary.true_profit_estimate,
              expense_count: reconItems.length,
              verified_expenses: forensicSummary.expense_breakdown.verified,
              suspicious_expenses:
                forensicSummary.expense_breakdown.suspicious +
                forensicSummary.expense_breakdown.unverified,
              red_flag_count: forensicSummary.red_flags.length,
              validation_items_needed:
                forensicSummary.validation_needed.length,
            };

            await supabase
              .from("vehicles")
              .update({ origin_metadata: meta })
              .eq("id", img.vehicle_id);
          }
        }

        results.push(result);
      } catch (err) {
        results.push({
          image_id: img.id,
          error: String(err),
          duration_ms: Date.now() - itemStart,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results: results.length === 1 ? results[0] : results,
        duration_ms: Date.now() - startTime,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: String(err),
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
