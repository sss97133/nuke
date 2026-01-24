/**
 * MIGRATE TO OBSERVATIONS
 *
 * Migrates existing auction_comments to the new vehicle_observations table.
 * Runs in batches to avoid timeouts. Self-continuing like backfill-comments.
 *
 * POST /functions/v1/migrate-to-observations
 * {
 *   "batch_size": 1000,
 *   "source_table": "auction_comments",  // or "bat_listings", etc.
 *   "max_batches": 100
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batch_size || 1000, 5000);
    const sourceTable = body.source_table || "auction_comments";
    const maxBatches = body.max_batches || 100;
    const batchNumber = body.batch_number || 1;

    if (batchNumber > maxBatches) {
      return new Response(JSON.stringify({
        success: true,
        message: `Reached max batches (${maxBatches})`,
        batch_number: batchNumber
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`=== MIGRATION BATCH ${batchNumber} (${sourceTable}) ===`);

    // Get BaT source ID
    const { data: batSource } = await supabase
      .from("observation_sources")
      .select("id")
      .eq("slug", "bat")
      .single();

    if (!batSource) {
      throw new Error("BaT source not found in observation_sources. Run the schema migration first.");
    }

    if (sourceTable === "auction_comments") {
      // Get comments that haven't been migrated yet
      // We track migration by checking if an observation with matching source_identifier exists
      const { data: comments, error: fetchError } = await supabase
        .from("auction_comments")
        .select(`
          id,
          vehicle_id,
          comment_text,
          posted_at,
          author_username,
          comment_type,
          sentiment,
          sentiment_score,
          has_question,
          has_media,
          bid_amount,
          is_seller
        `)
        .not("vehicle_id", "is", null)
        .not("comment_text", "is", null)
        .order("posted_at", { ascending: true })
        .limit(batchSize);

      if (fetchError) throw fetchError;

      if (!comments?.length) {
        return new Response(JSON.stringify({
          success: true,
          message: "No more comments to migrate",
          batch_number: batchNumber,
          migrated: 0
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Check which comments already have observations
      const commentIds = comments.map(c => `comment-${c.id}`);
      const { data: existing } = await supabase
        .from("vehicle_observations")
        .select("source_identifier")
        .in("source_identifier", commentIds);

      const existingIds = new Set((existing || []).map(e => e.source_identifier));

      // Filter to comments that need migration
      const toMigrate = comments.filter(c => !existingIds.has(`comment-${c.id}`));

      if (!toMigrate.length) {
        // All in this batch exist, continue to next batch
        console.log(`All ${comments.length} comments already migrated, continuing...`);
      } else {
        // Build observation records
        const observations = await Promise.all(toMigrate.map(async (c) => {
          const contentHash = await hashContent(JSON.stringify({
            source: "bat",
            kind: c.bid_amount ? "bid" : "comment",
            identifier: `comment-${c.id}`,
            text: c.comment_text
          }));

          // Determine kind
          let kind = "comment";
          if (c.bid_amount) kind = "bid";

          // Map existing sentiment to confidence
          let confidenceScore = 0.85; // BaT has high base trust
          if (c.sentiment) confidenceScore += 0.05;

          return {
            vehicle_id: c.vehicle_id,
            vehicle_match_confidence: 1.0, // Direct link from original table
            observed_at: c.posted_at,
            source_id: batSource.id,
            source_identifier: `comment-${c.id}`,
            kind,
            content_text: c.comment_text,
            content_hash: contentHash,
            structured_data: {
              author_username: c.author_username,
              comment_type: c.comment_type,
              has_question: c.has_question,
              has_media: c.has_media,
              is_seller: c.is_seller,
              bid_amount: c.bid_amount,
              // Preserve existing sentiment analysis
              legacy_sentiment: c.sentiment,
              legacy_sentiment_score: c.sentiment_score
            },
            confidence: "high",
            confidence_score: confidenceScore,
            is_processed: !!c.sentiment, // Mark as processed if already had sentiment
            extraction_metadata: {
              migrated_from: "auction_comments",
              migration_batch: batchNumber,
              original_id: c.id
            }
          };
        }));

        // Insert in chunks to avoid payload limits
        const chunkSize = 100;
        let inserted = 0;
        for (let i = 0; i < observations.length; i += chunkSize) {
          const chunk = observations.slice(i, i + chunkSize);
          const { error: insertError } = await supabase
            .from("vehicle_observations")
            .upsert(chunk, { onConflict: "source_id,source_identifier,kind,content_hash" });

          if (insertError) {
            console.error(`Insert error for chunk ${i}:`, insertError);
          } else {
            inserted += chunk.length;
          }
        }

        console.log(`Migrated ${inserted}/${toMigrate.length} comments`);
      }

      // Self-continue
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      fetch(`${supabaseUrl}/functions/v1/migrate-to-observations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`
        },
        body: JSON.stringify({
          batch_size: batchSize,
          source_table: sourceTable,
          max_batches: maxBatches,
          batch_number: batchNumber + 1
        })
      }).catch(e => console.error("Failed to trigger next batch:", e));

      await new Promise(resolve => setTimeout(resolve, 100));

      return new Response(JSON.stringify({
        success: true,
        batch_number: batchNumber,
        comments_in_batch: comments.length,
        migrated: toMigrate.length,
        already_existed: comments.length - toMigrate.length,
        continuing: true
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      error: `Unknown source_table: ${sourceTable}`,
      supported: ["auction_comments"]
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
