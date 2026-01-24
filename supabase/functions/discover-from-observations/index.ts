/**
 * DISCOVER FROM OBSERVATIONS
 *
 * Source-agnostic AI discovery. Analyzes observations from ANY source
 * to extract sentiment, themes, and structured data.
 *
 * Unlike discover-comment-data (BaT-specific), this works on:
 * - Auction comments (BaT, C&B, etc.)
 * - Forum posts (Rennlist, Pelican Parts)
 * - Social media mentions
 * - Any text observation
 *
 * POST /functions/v1/discover-from-observations
 * {
 *   "vehicle_id": "uuid",
 *   "kinds": ["comment", "social_mention"],  // optional filter
 *   "min_confidence": 0.5,                   // optional filter
 *   "discovery_types": ["sentiment", "themes", "market_signals"]
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DiscoveryInput {
  vehicle_id: string;
  kinds?: string[];
  min_confidence?: number;
  discovery_types?: string[];
  max_observations?: number;
}

const SENTIMENT_PROMPT = `Analyze the sentiment and themes in these observations about a vehicle.

Observations (from various sources like auctions, forums, social media):
<observations>
{{OBSERVATIONS}}
</observations>

Extract:
1. Overall sentiment (positive/negative/mixed/neutral)
2. Sentiment score (-1.0 to 1.0)
3. Key themes mentioned (e.g., "condition concerns", "price discussion", "authenticity", "restoration quality")
4. Notable quotes that capture the sentiment
5. Red flags or concerns raised
6. Positive highlights mentioned

Respond in JSON:
{
  "overall_sentiment": "positive|negative|mixed|neutral",
  "sentiment_score": 0.0,
  "themes": [{"theme": "...", "frequency": 0, "sentiment": "..."}],
  "notable_quotes": ["..."],
  "red_flags": ["..."],
  "highlights": ["..."],
  "confidence": 0.0
}`;

const MARKET_SIGNALS_PROMPT = `Analyze these observations for market signals about this vehicle.

Observations:
<observations>
{{OBSERVATIONS}}
</observations>

Extract market intelligence:
1. Price expectations mentioned
2. Comparisons to similar vehicles
3. Market trend indicators (rising/falling interest)
4. Buyer/seller sentiment
5. Value factors mentioned (rarity, condition, provenance)

Respond in JSON:
{
  "price_mentions": [{"amount": 0, "context": "...", "source_type": "..."}],
  "comparisons": [{"vehicle": "...", "relationship": "...", "price_diff": "..."}],
  "market_trend": "rising|stable|falling|unclear",
  "demand_indicators": ["..."],
  "value_factors": [{"factor": "...", "impact": "positive|negative", "weight": 0.0}],
  "confidence": 0.0
}`;

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

    if (!input.vehicle_id) {
      return new Response(JSON.stringify({ error: "vehicle_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Build query for observations
    let query = supabase
      .from("vehicle_observations")
      .select(`
        id,
        kind,
        observed_at,
        content_text,
        structured_data,
        confidence_score,
        source:observation_sources(display_name, category)
      `)
      .eq("vehicle_id", input.vehicle_id)
      .eq("is_superseded", false)
      .not("content_text", "is", null)
      .order("observed_at", { ascending: false });

    if (input.kinds?.length) {
      query = query.in("kind", input.kinds);
    }

    if (input.min_confidence) {
      query = query.gte("confidence_score", input.min_confidence);
    }

    query = query.limit(input.max_observations || 200);

    const { data: observations, error: obsError } = await query;

    if (obsError) {
      throw new Error(`Failed to fetch observations: ${obsError.message}`);
    }

    if (!observations?.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "No observations found for this vehicle",
        discoveries: []
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Format observations for prompts
    const formattedObs = observations.map((o: any) => {
      const source = o.source?.display_name || "Unknown";
      const category = o.source?.category || "unknown";
      const date = new Date(o.observed_at).toLocaleDateString();
      return `[${source} (${category}) - ${date}]: ${o.content_text}`;
    }).join("\n\n");

    const discoveryTypes = input.discovery_types || ["sentiment"];
    const discoveries: any[] = [];
    const observationIds = observations.map((o: any) => o.id);
    const sourceCategories = [...new Set(observations.map((o: any) => o.source?.category).filter(Boolean))];

    // Run sentiment discovery
    if (discoveryTypes.includes("sentiment")) {
      const prompt = SENTIMENT_PROMPT.replace("{{OBSERVATIONS}}", formattedObs);

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }]
      });

      const content = response.content[0];
      if (content.type === "text") {
        try {
          // Extract JSON from response
          const jsonMatch = content.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const sentimentData = JSON.parse(jsonMatch[0]);

            // Store discovery
            const { data: discovery } = await supabase
              .from("observation_discoveries")
              .insert({
                vehicle_id: input.vehicle_id,
                observation_ids: observationIds,
                observation_count: observations.length,
                source_categories: sourceCategories,
                date_range_start: observations[observations.length - 1]?.observed_at,
                date_range_end: observations[0]?.observed_at,
                discovery_type: "sentiment",
                raw_extraction: sentimentData,
                confidence_score: sentimentData.confidence || 0.7,
                model_used: "claude-sonnet-4-20250514",
                prompt_version: "v1"
              })
              .select()
              .single();

            discoveries.push({
              type: "sentiment",
              data: sentimentData,
              discovery_id: discovery?.id
            });
          }
        } catch (e) {
          console.error("Failed to parse sentiment response:", e);
        }
      }
    }

    // Run market signals discovery
    if (discoveryTypes.includes("market_signals")) {
      const prompt = MARKET_SIGNALS_PROMPT.replace("{{OBSERVATIONS}}", formattedObs);

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }]
      });

      const content = response.content[0];
      if (content.type === "text") {
        try {
          const jsonMatch = content.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const marketData = JSON.parse(jsonMatch[0]);

            const { data: discovery } = await supabase
              .from("observation_discoveries")
              .insert({
                vehicle_id: input.vehicle_id,
                observation_ids: observationIds,
                observation_count: observations.length,
                source_categories: sourceCategories,
                date_range_start: observations[observations.length - 1]?.observed_at,
                date_range_end: observations[0]?.observed_at,
                discovery_type: "market_signals",
                raw_extraction: marketData,
                confidence_score: marketData.confidence || 0.6,
                model_used: "claude-sonnet-4-20250514",
                prompt_version: "v1"
              })
              .select()
              .single();

            discoveries.push({
              type: "market_signals",
              data: marketData,
              discovery_id: discovery?.id
            });
          }
        } catch (e) {
          console.error("Failed to parse market signals response:", e);
        }
      }
    }

    // Mark observations as processed
    await supabase
      .from("vehicle_observations")
      .update({ is_processed: true })
      .in("id", observationIds);

    return new Response(JSON.stringify({
      success: true,
      vehicle_id: input.vehicle_id,
      observations_analyzed: observations.length,
      source_categories: sourceCategories,
      discoveries
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
