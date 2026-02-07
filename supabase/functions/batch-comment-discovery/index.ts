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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

serve(async (req) => {
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
    const batchSize = Math.min(body.batch_size || 20, 50);
    const minComments = body.min_comments ?? 5;
    const maxCommentChars = body.max_comment_chars ?? 12000;
    const shouldContinue = body.continue ?? false;

    // Phase 1: Use bat_listings (pre-aggregated comment counts, fast)
    // Phase 2: Fall back to auction_comments direct scan for non-BaT vehicles
    const { data: candidates, error: cErr } = await supabase.rpc("execute_sql", {
      query: `SELECT bl.vehicle_id, bl.comment_count, v.year, v.make, v.model, COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price FROM bat_listings bl JOIN vehicles v ON v.id = bl.vehicle_id AND v.deleted_at IS NULL WHERE bl.vehicle_id IS NOT NULL AND bl.comment_count >= ${minComments} AND NOT EXISTS (SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = bl.vehicle_id) ORDER BY bl.comment_count DESC LIMIT ${batchSize}`
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

    // Get remaining count (fast — bat_listings is small)
    const { data: remainingData } = await supabase.rpc("execute_sql", {
      query: `SELECT count(*) AS remaining FROM bat_listings bl WHERE bl.vehicle_id IS NOT NULL AND bl.comment_count >= ${minComments} AND NOT EXISTS (SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = bl.vehicle_id)`
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
    // Get comments for this vehicle
    const { data: comments, error: cErr } = await supabase
      .from("auction_comments")
      .select("comment_text, author_username, is_seller, posted_at, bid_amount")
      .eq("vehicle_id", vehicle.vehicle_id)
      .order("posted_at", { ascending: true })
      .limit(200);

    if (cErr || !comments || comments.length < 3) {
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

    const discovered = JSON.parse(jsonMatch[0]);

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
