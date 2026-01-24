/**
 * UPDATE LIVE SENTIMENT
 *
 * Processes the sentiment_update_queue to incrementally update
 * live sentiment scores for vehicles with new observations.
 *
 * Designed for real-time updates during active auctions.
 * Uses a lightweight sentiment model for speed.
 *
 * POST /functions/v1/update-live-sentiment
 * {
 *   "batch_size": 10,
 *   "priority_only": false  // Only process high-priority (active auctions)
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QUICK_SENTIMENT_PROMPT = `Analyze the sentiment of these recent vehicle observations. Be concise.

Observations:
<observations>
{{OBSERVATIONS}}
</observations>

Return JSON only:
{
  "sentiment_score": 0.0,  // -1.0 (very negative) to 1.0 (very positive)
  "trend": "improving|stable|declining",
  "key_concern": "string or null",
  "key_positive": "string or null"
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
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batch_size || 10, 50);
    const priorityOnly = body.priority_only === true;

    // Get queued vehicles
    let query = supabase
      .from("sentiment_update_queue")
      .select("id, vehicle_id, priority")
      .is("processed_at", null)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (priorityOnly) {
      query = query.gte("priority", 5);
    }

    const { data: queue, error: queueError } = await query;

    if (queueError) {
      throw new Error(`Queue fetch error: ${queueError.message}`);
    }

    if (!queue?.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "No vehicles in sentiment queue",
        processed: 0
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = {
      processed: 0,
      updated: 0,
      errors: 0
    };

    for (const item of queue) {
      try {
        // Get recent observations for this vehicle (last 50)
        const { data: observations, error: obsError } = await supabase
          .from("vehicle_observations")
          .select(`
            kind,
            observed_at,
            content_text,
            source:observation_sources(display_name)
          `)
          .eq("vehicle_id", item.vehicle_id)
          .eq("kind", "comment")
          .not("content_text", "is", null)
          .order("observed_at", { ascending: false })
          .limit(50);

        if (obsError) {
          console.error(`Obs fetch error for ${item.vehicle_id}:`, obsError.message);
        }

        console.log(`Vehicle ${item.vehicle_id}: found ${observations?.length || 0} observations`);

        if (!observations?.length) {
          // Mark as processed even if no observations
          await supabase
            .from("sentiment_update_queue")
            .update({ processed_at: new Date().toISOString() })
            .eq("id", item.id);
          results.processed++;
          continue;
        }

        // Format for prompt
        const formattedObs = observations
          .slice(0, 20) // Use most recent 20 for speed
          .map((o: any) => {
            const source = o.source?.display_name || "Unknown";
            return `[${source}]: ${o.content_text?.substring(0, 300)}`;
          })
          .join("\n");

        const prompt = QUICK_SENTIMENT_PROMPT.replace("{{OBSERVATIONS}}", formattedObs);

        // Use Haiku for speed
        const response = await anthropic.messages.create({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }]
        });

        const content = response.content[0];
        if (content.type === "text") {
          console.log(`AI response for ${item.vehicle_id}:`, content.text.substring(0, 200));
          const jsonMatch = content.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const sentiment = JSON.parse(jsonMatch[0]);
            console.log(`Parsed sentiment:`, sentiment);

            // Update live metrics
            const { error: upsertError } = await supabase
              .from("vehicle_live_metrics")
              .upsert({
                vehicle_id: item.vehicle_id,
                sentiment_score: sentiment.sentiment_score,
                sentiment_updated_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }, { onConflict: "vehicle_id" });

            if (upsertError) {
              console.error(`Upsert error for ${item.vehicle_id}:`, upsertError.message);
            } else {
              console.log(`Updated sentiment for ${item.vehicle_id}: ${sentiment.sentiment_score}`);
              results.updated++;
            }
          } else {
            console.log(`No JSON found in response for ${item.vehicle_id}`);
          }
        }

        // Mark as processed
        await supabase
          .from("sentiment_update_queue")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", item.id);

        results.processed++;
      } catch (e: any) {
        console.error(`Error processing ${item.vehicle_id}:`, e.message);
        results.errors++;
        results.processed++;

        // Still mark as processed to avoid infinite retry
        await supabase
          .from("sentiment_update_queue")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", item.id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      queue_size: queue.length
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
