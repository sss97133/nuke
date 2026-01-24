/**
 * Discover Comment Data
 *
 * LEARNING PHASE - Analyze auction comments for:
 * - Sentiment & mood
 * - Expert insights
 * - Community concerns
 * - Comparable sales mentions
 * - Seller disclosures
 * - Trends & patterns
 *
 * POST /functions/v1/discover-comment-data
 * Body: { "vehicle_id": "uuid" } or { "batch_size": 5 }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COMMENT_DISCOVERY_PROMPT = `You are analyzing auction comments from a vehicle listing. Extract insights about community sentiment, expert knowledge, and notable discussions.

VEHICLE: {year} {make} {model}
SALE PRICE: {sale_price}
COMMENT COUNT: {comment_count}

COMMENTS (seller comments marked with [SELLER]):
---
{comments}
---

Analyze these comments thoroughly. Extract:

1. SENTIMENT & MOOD
   - Overall community sentiment (excited, skeptical, nostalgic, critical, etc.)
   - Sentiment score (-1.0 to 1.0, where -1 is very negative, 1 is very positive)
   - Key emotional themes

2. EXPERT INSIGHTS
   - Technical knowledge shared (specifications, history, quirks)
   - Model-specific tips or warnings
   - Authentication observations (is it real? concerns about provenance?)

3. SELLER DISCLOSURES
   - Facts revealed in Q&A
   - Corrections or clarifications
   - Condition admissions

4. COMMUNITY CONCERNS
   - Red flags raised
   - Questions about authenticity
   - Condition worries
   - Price concerns (too high? bargain?)

5. COMPARABLE SALES
   - Other sales mentioned
   - Price comparisons
   - Market commentary

6. NOTABLE DISCUSSIONS
   - Debates or disagreements
   - Interesting stories shared
   - Historical context provided

7. TRENDS & THEMES
   - What topics dominate discussion?
   - What does this tell us about market sentiment for this type of vehicle?

Return a comprehensive JSON object capturing all of this. Include specific quotes where valuable.
Use snake_case keys. Be thorough.

{
  "sentiment": {
    "overall": "<positive|negative|mixed|neutral>",
    "score": <-1.0 to 1.0>,
    "mood_keywords": [...],
    "emotional_themes": [...]
  },
  "expert_insights": [...],
  "seller_disclosures": [...],
  "community_concerns": [...],
  "comparable_sales": [...],
  "notable_discussions": [...],
  "market_signals": {...},
  "key_quotes": [...],
  "discussion_themes": [...],
  "authenticity_discussion": {...},
  "price_sentiment": {...}
}

Return ONLY valid JSON.`;

async function discoverComments(
  vehicle: any,
  comments: any[],
  anthropicKey: string
): Promise<any> {
  // Format comments
  const formattedComments = comments
    .slice(0, 100) // Limit to 100 most relevant
    .map(c => {
      const prefix = c.is_seller ? "[SELLER] " : "";
      const username = c.author_username || "anonymous";
      return `${prefix}@${username}: ${c.comment_text}`;
    })
    .join("\n\n");

  const prompt = COMMENT_DISCOVERY_PROMPT
    .replace("{year}", String(vehicle.year || "Unknown"))
    .replace("{make}", vehicle.make || "Unknown")
    .replace("{model}", vehicle.model || "Unknown")
    .replace("{sale_price}", vehicle.sale_price ? `$${vehicle.sale_price.toLocaleString()}` : "Unknown")
    .replace("{comment_count}", String(comments.length))
    .replace("{comments}", formattedComments.substring(0, 8000));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const result = await response.json();
  const content = result.content?.[0]?.text || "";

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  return { raw_response: content, parse_failed: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const incomingAuth = req.headers.get("authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const tokenForClient = incomingAuth.startsWith("Bearer ")
      ? incomingAuth.substring(7)
      : serviceKey;
    const supabase = createClient(supabaseUrl, tokenForClient);

    if (!anthropicKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicle_id;
    const batchSize = Math.min(body.batch_size || 5, 10);
    const minComments = body.min_comments ?? 20;

    let vehiclesToProcess: any[] = [];

    if (vehicleId) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, year, make, model, sale_price")
        .eq("id", vehicleId)
        .single();
      if (vehicle) vehiclesToProcess = [vehicle];
    } else {
      // Get distinct vehicle_ids that have comments in vehicle_observations
      const { data: commentSamples } = await supabase
        .from("vehicle_observations")
        .select("vehicle_id")
        .eq("kind", "comment")
        .not("vehicle_id", "is", null)
        .order("observed_at", { ascending: false })
        .limit(500);

      if (commentSamples) {
        // Get unique vehicle_ids
        const vehicleIdsWithComments = [...new Set(commentSamples.map((c: any) => c.vehicle_id))];
        console.log(`Found ${vehicleIdsWithComments.length} vehicles with comments in sample`);

        // Get already discovered vehicle_ids
        const { data: alreadyDiscovered } = await supabase
          .from("comment_discoveries")
          .select("vehicle_id");
        const discoveredIds = new Set((alreadyDiscovered || []).map((d: any) => d.vehicle_id));
        console.log(`Already discovered: ${discoveredIds.size}`);

        // Filter to undiscovered
        const undiscoveredIds = vehicleIdsWithComments.filter((id: string) => !discoveredIds.has(id));
        console.log(`Undiscovered: ${undiscoveredIds.length}`);

        if (undiscoveredIds.length > 0) {
          // Get vehicle details for undiscovered vehicles
          const { data: vehicles } = await supabase
            .from("vehicles")
            .select("id, year, make, model, sale_price")
            .in("id", undiscoveredIds.slice(0, batchSize * 2))
            .order("sale_price", { ascending: false, nullsFirst: false });

          if (vehicles) {
            for (const v of vehicles) {
              if (vehiclesToProcess.length >= batchSize) break;

              // Check comment count in vehicle_observations
              const { count } = await supabase
                .from("vehicle_observations")
                .select("id", { count: "exact", head: true })
                .eq("kind", "comment")
                .eq("vehicle_id", v.id);

              if ((count || 0) >= minComments) {
                vehiclesToProcess.push({ ...v, comment_count: count });
              }
            }
          }
        }
      }
    }

    if (vehiclesToProcess.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No vehicles to analyze",
        discovered: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      discovered: 0,
      errors: 0,
      samples: [] as any[],
    };

    for (const vehicle of vehiclesToProcess) {
      try {
        // Get comments from vehicle_observations
        const { data: rawComments } = await supabase
          .from("vehicle_observations")
          .select("content_text, structured_data, observed_at")
          .eq("kind", "comment")
          .eq("vehicle_id", vehicle.id)
          .order("observed_at", { ascending: true })
          .limit(150);

        // Transform to expected format
        const comments = (rawComments || []).map((c: any) => ({
          author_username: c.structured_data?.author_username || 'unknown',
          comment_text: c.content_text,
          is_seller: c.structured_data?.is_seller || false,
          created_at: c.observed_at,
        }));

        if (!comments || comments.length < 10) {
          results.errors++;
          continue;
        }

        console.log(`Discovering comments: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${comments.length} comments)`);

        const discovered = await discoverComments(vehicle, comments, anthropicKey);

        // Extract sentiment for quick access
        const sentiment = discovered.sentiment?.overall || null;
        const sentimentScore = discovered.sentiment?.score || null;

        // Store
        const { error: insertError } = await supabase
          .from("comment_discoveries")
          .upsert({
            vehicle_id: vehicle.id,
            discovered_at: new Date().toISOString(),
            raw_extraction: discovered,
            comment_count: comments.length,
            total_fields: countFields(discovered),
            sale_price: vehicle.sale_price,
            overall_sentiment: sentiment,
            sentiment_score: sentimentScore,
          }, { onConflict: "vehicle_id" });

        if (insertError) {
          console.error("Insert error:", insertError);
          results.errors++;
        } else {
          results.discovered++;
          if (results.samples.length < 3) {
            results.samples.push({
              vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              price: vehicle.sale_price,
              comments: comments.length,
              sentiment,
              sentiment_score: sentimentScore,
              themes: discovered.discussion_themes?.slice(0, 3) || [],
            });
          }
        }
      } catch (e: any) {
        console.error("Discovery error:", e);
        results.errors++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

function countFields(obj: any, depth = 0): number {
  if (depth > 5) return 0;
  if (obj === null || obj === undefined) return 0;
  if (typeof obj !== "object") return 1;
  if (Array.isArray(obj)) {
    return obj.reduce((sum, item) => sum + countFields(item, depth + 1), 0);
  }
  return Object.values(obj).reduce((sum: number, val) => sum + countFields(val, depth + 1), 0);
}
