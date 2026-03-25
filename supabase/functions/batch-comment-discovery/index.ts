/**
 * BATCH COMMENT DISCOVERY
 *
 * High-throughput comment analysis pipeline.
 * Processes vehicles with unanalyzed comments through Claude Haiku
 * to extract sentiment, condition signals, expert insights, market signals.
 *
 * Two-level output:
 * 1. Vehicle-level: comment_discoveries (per-vehicle expert analysis)
 * 2. Market-level: feeds into aggregate-sentiment for make/model trends
 *
 * POST /functions/v1/batch-comment-discovery
 * Body: {
 *   "batch_size"?: number (default 20, max 50),
 *   "min_comments"?: number (default 5),
 *   "offset"?: number (for pagination),
 *   "max_comment_chars"?: number (default 12000),
 *   "continue"?: boolean (auto-chain next batch)
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISCOVERY_PROMPT = `You are analyzing auction comments from a collector vehicle listing. Extract insights for BOTH vehicle-level assessment AND market-level trends.

VEHICLE: {year} {make} {model}
SALE PRICE: {sale_price}
COMMENTS ({comment_count} total, showing up to 150):
---
{comments}
---

Analyze thoroughly. Return JSON:

{
  "sentiment": {
    "overall": "positive|negative|mixed|neutral",
    "score": -1.0 to 1.0,
    "mood_keywords": ["..."],
    "emotional_themes": ["..."]
  },
  "condition_signals": {
    "overall_impression": "excellent|good|fair|poor|unknown",
    "positives": ["rust-free frame", "matching numbers", ...],
    "negatives": ["repaint noted", "aftermarket parts", ...],
    "modifications": ["..."],
    "restoration_quality": "concours|professional|amateur|unknown",
    "originality": "all-original|mostly-original|modified|restomod|unknown"
  },
  "expert_insights": [{"insight": "...", "expertise_level": "high|medium|low"}],
  "seller_disclosures": ["..."],
  "community_concerns": ["..."],
  "comparable_sales": [{"description": "...", "price": null}],
  "market_signals": {
    "demand_level": "high|moderate|low",
    "rarity_assessment": "rare|uncommon|common",
    "price_trend": "rising|stable|declining|unknown",
    "value_factors": ["..."]
  },
  "authenticity_discussion": {
    "concerns_raised": false,
    "details": "..."
  },
  "price_sentiment": {
    "community_view": "bargain|fair|high|too_high|unknown",
    "reasoning": "..."
  },
  "discussion_themes": ["..."],
  "key_quotes": [{"quote": "...", "significance": "..."}],
  "meta_analysis": {
    "data_quality_score": 0.0 to 1.0,
    "missing_data": ["..."],
    "confidence_ratings": {
      "sentiment": "high|medium|low",
      "condition": "high|medium|low",
      "authenticity": "high|medium|low",
      "price_assessment": "high|medium|low"
    }
  }
}

Return ONLY valid JSON.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "discover"; // "discover" (legacy) or "extract_claims"

    if (mode === "extract_claims") {
      const result = await extractClaims(supabase, supabaseUrl, serviceKey, anthropicKey, body);
      return jsonResponse({ success: true, mode, elapsed_ms: Date.now() - startTime, ...result });
    }

    const batchSize = Math.max(1, Math.min(parseInt(String(body.batch_size ?? 20), 10) || 20, 50));
    const minComments = Math.max(0, parseInt(String(body.min_comments ?? 5), 10) || 5);
    const maxCommentChars = body.max_comment_chars ?? 12000;
    const shouldContinue = body.continue ?? false;

    // Phase 1: Use vehicle_events (pre-aggregated comment counts, fast)
    // Phase 2: Fall back to auction_comments direct scan for non-BaT vehicles
    const { data: candidates, error: cErr } = await supabase.rpc("execute_sql", {
      query: `SELECT ve.vehicle_id, ve.comment_count, ve.source_platform, v.year, v.make, v.model, COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price FROM vehicle_events ve JOIN vehicles v ON v.id = ve.vehicle_id AND v.deleted_at IS NULL WHERE ve.source_platform IN ('bat', 'hagerty') AND ve.vehicle_id IS NOT NULL AND ve.comment_count >= ${minComments} AND NOT EXISTS (SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = ve.vehicle_id) ORDER BY ve.comment_count DESC LIMIT ${batchSize}`
    });

    if (cErr) throw new Error(`Candidate query failed: ${JSON.stringify(cErr)}`);

    const vehiclesToProcess = Array.isArray(candidates) ? candidates : [];

    if (vehiclesToProcess.length === 0) {
      return jsonResponse({
        success: true,
        message: "No more vehicles to discover",
        discovered: 0,
        remaining: 0,
        elapsed_ms: Date.now() - startTime,
      });
    }

    console.log(`[batch-discover] Processing ${vehiclesToProcess.length} vehicles (min ${minComments} comments)`);

    // Process vehicles in parallel batches of 5
    const PARALLEL = 5;
    const results = { discovered: 0, errors: 0, error_details: [] as string[], samples: [] as any[] };

    for (let i = 0; i < vehiclesToProcess.length; i += PARALLEL) {
      // Check time budget — leave 10s for cleanup
      if (Date.now() - startTime > 50000) {
        console.log(`[batch-discover] Time budget exceeded at vehicle ${i}, stopping`);
        break;
      }

      const chunk = vehiclesToProcess.slice(i, i + PARALLEL);
      const promises = chunk.map(v => processVehicle(supabase, v, anthropicKey, maxCommentChars));
      const settled = await Promise.allSettled(promises);

      for (let j = 0; j < settled.length; j++) {
        const result = settled[j];
        if (result.status === "fulfilled" && result.value.success) {
          results.discovered++;
          if (results.samples.length < 3) {
            results.samples.push(result.value.sample);
          }
        } else {
          results.errors++;
          const errMsg = result.status === "rejected" ? result.reason?.message : result.value?.error;
          results.error_details.push(`${chunk[j].vehicle_id}: ${errMsg}`);
        }
      }
    }

    // Get remaining count (fast — vehicle_events is indexed)
    const { data: remainingData } = await supabase.rpc("execute_sql", {
      query: `SELECT count(*) AS remaining FROM vehicle_events ve WHERE ve.source_platform IN ('bat', 'hagerty') AND ve.vehicle_id IS NOT NULL AND ve.comment_count >= ${minComments} AND NOT EXISTS (SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = ve.vehicle_id)`
    });
    const remaining = Array.isArray(remainingData) ? Number(remainingData[0]?.remaining || 0) : 0;

    // Self-continue if requested and there's more work
    if (shouldContinue && remaining > 0 && results.discovered > 0) {
      // Fire-and-forget next batch
      const nextUrl = `${supabaseUrl}/functions/v1/batch-comment-discovery`;
      fetch(nextUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          batch_size: batchSize,
          min_comments: minComments,
          max_comment_chars: maxCommentChars,
          continue: true,
        }),
      }).catch(e => console.error("[batch-discover] Continue chain failed:", e));
    }

    return jsonResponse({
      success: true,
      ...results,
      remaining,
      elapsed_ms: Date.now() - startTime,
      continued: shouldContinue && remaining > 0,
    });

  } catch (e: any) {
    console.error("[batch-discover] Error:", e);
    return jsonResponse({ error: e.message, elapsed_ms: Date.now() - startTime }, 500);
  }
});

async function processVehicle(
  supabase: any,
  vehicle: any,
  anthropicKey: string,
  maxChars: number,
): Promise<{ success: boolean; sample?: any; error?: string }> {
  try {
    // Get comments for this vehicle — try auction_comments first (BaT), then vehicle_observations (Hagerty)
    let comments: any[] | null = null;
    const { data: auctionComments, error: cErr } = await supabase
      .from("auction_comments")
      .select("comment_text, author_username, is_seller, posted_at, bid_amount")
      .eq("vehicle_id", vehicle.vehicle_id)
      .order("posted_at", { ascending: true })
      .limit(200);

    if (!cErr && auctionComments && auctionComments.length >= 3) {
      comments = auctionComments;
    } else {
      // Fallback: Hagerty comments stored as vehicle_observations (kind='comment')
      const { data: obsComments } = await supabase
        .from("vehicle_observations")
        .select("id, content_text, structured_data, observed_at")
        .eq("vehicle_id", vehicle.vehicle_id)
        .eq("kind", "comment")
        .order("observed_at", { ascending: true })
        .limit(200);

      if (obsComments && obsComments.length >= 3) {
        comments = obsComments.map((o: any) => ({
          comment_text: o.content_text || "",
          author_username: o.structured_data?.author || o.structured_data?.author_username || "anon",
          is_seller: o.structured_data?.is_seller || false,
          posted_at: o.observed_at,
          bid_amount: o.structured_data?.bid_amount || null,
        }));
      }
    }

    if (!comments || comments.length < 3) {
      return { success: false, error: "Not enough comments" };
    }

    // Format comments, truncate to fit context window
    let formatted = "";
    let count = 0;
    for (const c of comments) {
      const prefix = c.is_seller ? "[SELLER] " : "";
      const user = c.author_username || "anon";
      const bid = c.bid_amount ? ` [BID: $${Number(c.bid_amount).toLocaleString()}]` : "";
      const line = `${prefix}@${user}${bid}: ${c.comment_text}\n\n`;
      if (formatted.length + line.length > maxChars) break;
      formatted += line;
      count++;
    }

    const prompt = DISCOVERY_PROMPT
      .replace("{year}", String(vehicle.year || "Unknown"))
      .replace("{make}", vehicle.make || "Unknown")
      .replace("{model}", vehicle.model || "Unknown")
      .replace("{sale_price}", vehicle.sale_price ? `$${Number(vehicle.sale_price).toLocaleString()}` : "Unknown")
      .replace("{comment_count}", String(comments.length))
      .replace("{comments}", formatted);

    // Call Claude Haiku
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: 2048,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { success: false, error: `Anthropic ${response.status}: ${errText.slice(0, 200)}` };
    }

    const result = await response.json();
    const content = result.content?.[0]?.text || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "No JSON in response" };
    }

    let discovered;
    try {
      discovered = JSON.parse(jsonMatch[0]);
    } catch {
      return { success: false, error: "Failed to parse discovery JSON" };
    }

    // Extract top-level fields for quick access
    const sentiment = discovered.sentiment?.overall || null;
    const sentimentScore = discovered.sentiment?.score || null;
    const meta = discovered.meta_analysis || {};

    // Upsert into comment_discoveries
    const { error: insertError } = await supabase
      .from("comment_discoveries")
      .upsert({
        vehicle_id: vehicle.vehicle_id,
        discovered_at: new Date().toISOString(),
        raw_extraction: discovered,
        comment_count: comments.length,
        total_fields: countFields(discovered),
        sale_price: vehicle.sale_price,
        overall_sentiment: sentiment,
        sentiment_score: sentimentScore,
        data_quality_score: meta.data_quality_score || null,
        missing_data_flags: meta.missing_data || [],
        recommended_sources: meta.recommended_sources || [],
      }, { onConflict: "vehicle_id" });

    if (insertError) {
      return { success: false, error: `Insert failed: ${insertError.message}` };
    }

    return {
      success: true,
      sample: {
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        price: vehicle.sale_price,
        comments: comments.length,
        comments_analyzed: count,
        sentiment,
        sentiment_score: sentimentScore,
        condition: discovered.condition_signals?.overall_impression || null,
        demand: discovered.market_signals?.demand_level || null,
        themes: discovered.discussion_themes?.slice(0, 3) || [],
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════
// MODE: EXTRACT_CLAIMS — Per-comment claim extraction via LLM
// ═══════════════════════════════════════════════════

async function extractClaims(
  supabase: any, supabaseUrl: string, serviceKey: string, anthropicKey: string, body: any
) {
  const { buildClaimExtractionPrompt, parseClaimResponse, computeClaimConfidence } = await import("../_shared/commentRefinery.ts");

  const batchSize = Math.min(body.batch_size || 10, 30); // vehicles per invocation
  const commentsPerCall = body.comments_per_call || 10;   // comments per LLM call
  const shouldContinue = body.continue ?? false;
  const vehicleId = body.vehicle_id || null;
  const startTime = Date.now();

  // Find vehicles with pending claims (triaged but not LLM-processed)
  let candidateQuery = supabase
    .from("comment_claims_progress")
    .select("vehicle_id")
    .eq("llm_processed", false)
    .gte("claim_density_score", 0.3)
    .order("claim_density_score", { ascending: false })
    .limit(batchSize * 20); // fetch extra to group by vehicle

  if (vehicleId) candidateQuery = candidateQuery.eq("vehicle_id", vehicleId);

  const { data: pendingRows, error: pendErr } = await candidateQuery;
  if (pendErr) return { error: pendErr.message, processed: 0 };

  // Group by vehicle
  const vehicleIds = [...new Set((pendingRows || []).map((r: any) => r.vehicle_id))].slice(0, batchSize);
  if (vehicleIds.length === 0) return { processed: 0, claims_total: 0, vehicles: 0, note: "No pending claims above threshold" };

  // Get vehicle context
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, year, make, model, vin, sale_price")
    .in("id", vehicleIds);

  const vehicleMap = new Map((vehicles || []).map((v: any) => [v.id, v]));

  let totalClaims = 0;
  let totalProcessed = 0;
  let totalCostCents = 0;
  let vehiclesProcessed = 0;
  const errors: string[] = [];

  for (const vId of vehicleIds) {
    if (Date.now() - startTime > 45000) break; // time budget

    const vehicle = vehicleMap.get(vId);
    if (!vehicle) continue;

    // Detect source platform for this vehicle
    const { data: veRows } = await supabase
      .from("vehicle_events")
      .select("source_platform")
      .eq("vehicle_id", vId)
      .limit(1);
    const sourcePlatform = veRows?.[0]?.source_platform || "bat";

    // Get pending comments for this vehicle (above threshold, not yet processed)
    const { data: pendingComments } = await supabase
      .from("comment_claims_progress")
      .select("comment_id, claim_density_score")
      .eq("vehicle_id", vId)
      .eq("llm_processed", false)
      .gte("claim_density_score", 0.3)
      .order("claim_density_score", { ascending: false })
      .limit(50); // max 50 comments per vehicle per run

    if (!pendingComments || pendingComments.length === 0) continue;

    const commentIds = pendingComments.map((p: any) => p.comment_id);

    // Fetch full comment text — try auction_comments first, then vehicle_observations
    let fullComments: any[] | null = null;
    const { data: acComments } = await supabase
      .from("auction_comments")
      .select("id, comment_text, author_username, is_seller, posted_at, bid_amount")
      .in("id", commentIds);

    if (acComments && acComments.length > 0) {
      fullComments = acComments;
    } else {
      // Fallback: Hagerty comments stored as vehicle_observations (kind='comment')
      const { data: obsComments } = await supabase
        .from("vehicle_observations")
        .select("id, content_text, structured_data, observed_at")
        .in("id", commentIds);

      if (obsComments && obsComments.length > 0) {
        fullComments = obsComments.map((o: any) => ({
          id: o.id,
          comment_text: o.content_text || "",
          author_username: o.structured_data?.author || o.structured_data?.author_username || "anon",
          is_seller: o.structured_data?.is_seller || false,
          posted_at: o.observed_at,
          bid_amount: o.structured_data?.bid_amount || null,
        }));
      }
    }

    if (!fullComments || fullComments.length === 0) continue;

    // Get existing field_evidence for this vehicle (so LLM knows what's already known)
    const { data: existingEvidence } = await supabase
      .from("field_evidence")
      .select("field_name")
      .eq("vehicle_id", vId)
      .limit(50);
    const existingFieldNames = [...new Set((existingEvidence || []).map((e: any) => e.field_name))];

    // Process in batches of commentsPerCall
    for (let i = 0; i < fullComments.length; i += commentsPerCall) {
      if (Date.now() - startTime > 45000) break;

      const batch = fullComments.slice(i, i + commentsPerCall);
      const vehicleCtx = {
        vehicle_id: vId,
        year: vehicle.year, make: vehicle.make, model: vehicle.model,
        vin: vehicle.vin, sale_price: vehicle.sale_price,
      };

      const prompt = buildClaimExtractionPrompt(vehicleCtx, batch, existingFieldNames);

      // Call LLM — try xAI Grok Mini (cheapest), then Gemini, then Haiku
      let content = "";
      let costCents = 0;
      let modelUsed = "";

      // 1. xAI Grok-3-Mini ($0.30/M in, $0.50/M out — cheapest available)
      const xaiKey = Deno.env.get("XAI_API_KEY") || "";
      if (!content && xaiKey) {
        try {
          const resp = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${xaiKey}` },
            body: JSON.stringify({
              model: "grok-3-mini",
              temperature: 0.1,
              max_tokens: 4096,
              messages: [{ role: "user", content: prompt }],
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            content = data.choices?.[0]?.message?.content || "";
            const inTok = data.usage?.prompt_tokens || 0;
            const outTok = data.usage?.completion_tokens || 0;
            costCents = (inTok * 0.03 + outTok * 0.05) / 1000; // $0.30/$0.50 per M tokens
            modelUsed = "grok-3-mini";
          } else {
            const errBody = await resp.text().catch(() => "");
            errors.push(`Grok ${resp.status}: ${errBody.slice(0, 150)}`);
          }
        } catch (e: any) { errors.push(`Grok error: ${e.message}`); }
      }

      // 2. Gemini fallback (free)
      const googleKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";
      if (!content && googleKey) {
        try {
          const gemResp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${googleKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
              }),
            }
          );
          if (gemResp.ok) {
            const gd = await gemResp.json();
            content = gd.candidates?.[0]?.content?.parts?.[0]?.text || "";
            modelUsed = "gemini-2.5-flash-lite";
            costCents = 0;
          } else {
            const gemErr = await gemResp.text().catch(() => "");
            errors.push(`Gemini ${gemResp.status}: ${gemErr.slice(0, 150)}`);
          }
        } catch (e: any) { errors.push(`Gemini error: ${e.message}`); }
      }

      // 3. Haiku fallback
      if (!content && anthropicKey) {
        try {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 4096, temperature: 0.1, messages: [{ role: "user", content: prompt }] }),
          });
          if (resp.ok) {
            const lr = await resp.json();
            content = lr.content?.[0]?.text || "";
            costCents = ((lr.usage?.input_tokens || 0) * 0.0025 + (lr.usage?.output_tokens || 0) * 0.0125) / 10;
            modelUsed = "claude-3-5-haiku-latest";
          }
        } catch { /* ignore */ }
      }

      if (!content) {
        errors.push(`No LLM response for ${vId} batch ${i}`);
        continue;
      }

      // Parse claims
      const { claims, parseErrors } = parseClaimResponse(content, batch);
      if (parseErrors.length > 0) {
        errors.push(...parseErrors.slice(0, 3).map((e: string) => `${vId}: ${e}`));
      }

      // Write Category A/B claims to field_evidence
      const fieldClaims = claims.filter(c => c.category === 'A' || c.category === 'B');
      const fieldEvidenceRows = fieldClaims.map(c => {
        const anchor = c.temporal_anchor && c.temporal_anchor !== 'null' && c.temporal_anchor !== 'current'
          ? new Date(c.temporal_anchor) : null;
        const conf = computeClaimConfidence(c.confidence, null, c.claim_type, anchor);
        return {
          vehicle_id: vId,
          field_name: c.field_name || c.claim_type,
          proposed_value: c.proposed_value,
          source_type: 'auction_comment_claim',
          source_confidence: Math.round((isNaN(conf) ? c.confidence : conf) * 100),
          extraction_context: batch.find((b: any) => b.id === c.comment_id)?.comment_text?.substring(0, 500) || '',
          supporting_signals: [{  // JSONB — pass object, not string
            quote: c.quote,
            author: batch.find((b: any) => b.id === c.comment_id)?.author_username || 'unknown',
            temporal_anchor: c.temporal_anchor,
            claim_type: c.claim_type,
            category: c.category,
            model: modelUsed,
          }],
          status: 'pending',
          raw_extraction_data: { reasoning: c.reasoning, contradicts_existing: c.contradicts_existing },
        };
      });

      if (fieldEvidenceRows.length > 0) {
        const { error: feErr } = await supabase
          .from("field_evidence")
          .upsert(fieldEvidenceRows, { onConflict: "vehicle_id,field_name,source_type,proposed_value" });
        if (feErr) errors.push(`field_evidence write: ${feErr.message}`);
      }

      // Write Category B claims as condition observations via ingest-observation
      const conditionClaims = claims.filter(c => c.category === 'B');
      for (const c of conditionClaims) {
        try {
          await supabase.functions.invoke("ingest-observation", {
            body: {
              source_slug: sourcePlatform,
              kind: "condition",
              observed_at: c.temporal_anchor && c.temporal_anchor !== 'null'
                ? c.temporal_anchor
                : batch.find((b: any) => b.id === c.comment_id)?.posted_at || new Date().toISOString(),
              content_text: c.quote,
              structured_data: {
                claim_type: c.claim_type,
                proposed_value: c.proposed_value,
                confidence: c.confidence,
                author: batch.find((b: any) => b.id === c.comment_id)?.author_username || 'unknown',
                category: 'B',
              },
              vehicle_id: vId,
              extraction_method: "comment_refinery_condition_v1",
              agent_model: modelUsed,
            },
          });
        } catch (condErr: any) {
          errors.push(`condition-obs: ${condErr.message?.slice(0, 100)}`);
        }
      }

      // Write Category C claims as vehicle_observations via ingest-observation
      const provClaims = claims.filter(c => c.category === 'C');
      for (const c of provClaims) {
        try {
          await supabase.functions.invoke("ingest-observation", {
            body: {
              source_slug: sourcePlatform,
              kind: c.observation_kind || "expert_opinion",
              observed_at: c.temporal_anchor && c.temporal_anchor !== 'null'
                ? c.temporal_anchor
                : batch.find((b: any) => b.id === c.comment_id)?.posted_at || new Date().toISOString(),
              content_text: c.quote,
              structured_data: {
                claim_type: c.claim_type,
                proposed_value: c.proposed_value,
                reasoning: c.reasoning,
                author: batch.find((b: any) => b.id === c.comment_id)?.author_username || 'unknown',
              },
              vehicle_id: vId,
              extraction_method: "comment_refinery_v1",
              agent_model: modelUsed,
            },
          });
        } catch (obsErr: any) {
          errors.push(`ingest-obs: ${obsErr.message?.slice(0, 100)}`);
        }
      }

      // Update comment_claims_progress for processed comments
      const batchCommentIds = batch.map((b: any) => b.id);
      const claimCountByComment = new Map<string, number>();
      for (const c of claims) {
        claimCountByComment.set(c.comment_id, (claimCountByComment.get(c.comment_id) || 0) + 1);
      }

      for (const cId of batchCommentIds) {
        await supabase
          .from("comment_claims_progress")
          .update({
            llm_processed: true,
            llm_model: modelUsed,
            llm_cost_cents: Math.round(costCents / batch.length * 10000) / 10000,
            claims_extracted: claimCountByComment.get(cId) || 0,
            processed_at: new Date().toISOString(),
          })
          .eq("comment_id", cId);
      }

      totalClaims += claims.length;
      totalProcessed += batch.length;
      totalCostCents += costCents;
    }

    vehiclesProcessed++;
  }

  // Self-chain if requested
  if (shouldContinue && vehiclesProcessed > 0) {
    const { count: remaining } = await supabase
      .from("comment_claims_progress")
      .select("id", { count: "exact", head: true })
      .eq("llm_processed", false)
      .gte("claim_density_score", 0.3);

    if ((remaining ?? 0) > 0) {
      fetch(`${supabaseUrl}/functions/v1/batch-comment-discovery`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "extract_claims", batch_size: body.batch_size, continue: true }),
      }).catch(e => console.error("[extract_claims] Chain failed:", e));
    }
  }

  return {
    vehicles: vehiclesProcessed,
    comments_processed: totalProcessed,
    claims_total: totalClaims,
    cost_cents: Math.round(totalCostCents * 100) / 100,
    errors: errors.slice(0, 10),
  };
}

function countFields(obj: any, depth = 0): number {
  if (depth > 5 || obj === null || obj === undefined) return 0;
  if (typeof obj !== "object") return 1;
  if (Array.isArray(obj)) return obj.reduce((s, i) => s + countFields(i, depth + 1), 0);
  return Object.values(obj).reduce((s: number, v) => s + countFields(v, depth + 1), 0);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
