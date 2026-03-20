/**
 * Review Agent Submissions — Cron (every 10 minutes)
 *
 * Processes pending staged submissions from Tier 1 agents:
 * 1. Dedup check (content_hash in vehicle_observations)
 * 2. Vehicle resolution (VIN → URL → fuzzy YMM)
 * 3. Schema validation
 * 4. Accept → promote to vehicle_observations
 * 5. Reject → mark with reason
 * 6. Expire old staging rows (>30 days)
 * 7. Circuit breaker recovery (re-enable agents after 1hr cooldown)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_KINDS = [
  'listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record',
  'ownership', 'specification', 'provenance', 'valuation', 'condition',
  'media', 'social_mention', 'expert_opinion',
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify this is called by cron or service role
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const altServiceKey = Deno.env.get("SERVICE_ROLE_KEY") || "";
    if (!token || (token !== serviceKey && token !== altServiceKey)) {
      return new Response(JSON.stringify({ error: "Unauthorized — service role key required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stats = {
      processed: 0,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      expired: 0,
      circuit_recoveries: 0,
    };

    // --- 1. Process pending submissions (LIMIT 100 per run) ---
    const { data: pending, error: fetchError } = await supabase
      .from("agent_submissions_staging")
      .select("*")
      .eq("review_status", "pending")
      .order("submitted_at", { ascending: true })
      .limit(100);

    if (fetchError) {
      console.error("[review] Failed to fetch pending:", fetchError);
      throw fetchError;
    }

    for (const row of (pending || [])) {
      stats.processed++;

      try {
        // 1a. Dedup: check content_hash in vehicle_observations
        if (row.content_hash) {
          const { data: existingObs } = await supabase
            .from("vehicle_observations")
            .select("id")
            .eq("content_hash", row.content_hash)
            .limit(1)
            .maybeSingle();

          if (existingObs) {
            // Duplicate — reject
            await supabase
              .from("agent_submissions_staging")
              .update({
                review_status: "rejected",
                reviewed_at: new Date().toISOString(),
                reviewed_by: "auto",
                review_reason: "Duplicate: content_hash already exists in vehicle_observations",
              })
              .eq("id", row.id);

            await supabase.rpc("record_agent_submission", {
              p_agent_id: row.agent_id,
              p_outcome: "duplicate",
              p_kind: row.kind,
            });

            stats.duplicates++;
            continue;
          }

          // Also check within staging itself (earlier accepted)
          const { data: existingStaged } = await supabase
            .from("agent_submissions_staging")
            .select("id")
            .eq("content_hash", row.content_hash)
            .eq("review_status", "accepted")
            .limit(1)
            .maybeSingle();

          if (existingStaged) {
            await supabase
              .from("agent_submissions_staging")
              .update({
                review_status: "rejected",
                reviewed_at: new Date().toISOString(),
                reviewed_by: "auto",
                review_reason: "Duplicate: content_hash already accepted in staging",
              })
              .eq("id", row.id);

            await supabase.rpc("record_agent_submission", {
              p_agent_id: row.agent_id,
              p_outcome: "duplicate",
              p_kind: row.kind,
            });

            stats.duplicates++;
            continue;
          }
        }

        // 1b. Vehicle resolution
        let vehicleId = row.vehicle_id;
        const hints = row.vehicle_hints || {};

        if (!vehicleId && hints.vin) {
          const { data: v } = await supabase
            .from("vehicles")
            .select("id")
            .eq("vin", hints.vin.toString().trim().toUpperCase())
            .maybeSingle();
          if (v) vehicleId = v.id;
        }

        if (!vehicleId && hints.year && hints.make && hints.model) {
          const { data: v } = await supabase
            .from("vehicles")
            .select("id")
            .eq("year", hints.year)
            .ilike("make", hints.make)
            .ilike("model", hints.model)
            .limit(1)
            .maybeSingle();
          if (v) vehicleId = v.id;
        }

        if (!vehicleId && hints.url) {
          const { data: v } = await supabase
            .from("vehicle_events")
            .select("vehicle_id")
            .eq("source_url", hints.url)
            .limit(1)
            .maybeSingle();
          if (v) vehicleId = v.vehicle_id;
        }

        // If still no vehicle, reject (can't place the observation)
        if (!vehicleId) {
          await supabase
            .from("agent_submissions_staging")
            .update({
              review_status: "rejected",
              reviewed_at: new Date().toISOString(),
              reviewed_by: "auto",
              review_reason: "Vehicle not found: could not resolve vehicle_id from hints",
            })
            .eq("id", row.id);

          await supabase.rpc("record_agent_submission", {
            p_agent_id: row.agent_id,
            p_outcome: "rejected",
            p_kind: row.kind,
          });

          stats.rejected++;
          continue;
        }

        // 1c. Schema validation
        if (!VALID_KINDS.includes(row.kind)) {
          await supabase
            .from("agent_submissions_staging")
            .update({
              review_status: "rejected",
              reviewed_at: new Date().toISOString(),
              reviewed_by: "auto",
              review_reason: `Invalid observation kind: ${row.kind}`,
            })
            .eq("id", row.id);

          await supabase.rpc("record_agent_submission", {
            p_agent_id: row.agent_id,
            p_outcome: "rejected",
            p_kind: row.kind,
          });

          stats.rejected++;
          continue;
        }

        if (!row.structured_data || Object.keys(row.structured_data).length === 0) {
          await supabase
            .from("agent_submissions_staging")
            .update({
              review_status: "rejected",
              reviewed_at: new Date().toISOString(),
              reviewed_by: "auto",
              review_reason: "Empty structured_data",
            })
            .eq("id", row.id);

          await supabase.rpc("record_agent_submission", {
            p_agent_id: row.agent_id,
            p_outcome: "rejected",
            p_kind: row.kind,
          });

          stats.rejected++;
          continue;
        }

        // 1d. Accept: promote to vehicle_observations
        const { data: promoted, error: promoteError } = await supabase
          .from("vehicle_observations")
          .insert({
            vehicle_id: vehicleId,
            source_id: row.source_id,
            observed_at: row.observed_at,
            kind: row.kind,
            content_text: row.content_text,
            content_hash: row.content_hash,
            structured_data: row.structured_data,
            confidence_score: row.confidence_score,
            extraction_metadata: {
              ...(row.extraction_metadata || {}),
              promoted_from_staging: row.id,
              promoted_at: new Date().toISOString(),
            },
            source_url: row.source_url,
            source_identifier: row.source_identifier,
          })
          .select("id")
          .single();

        if (promoteError) {
          console.error(`[review] Failed to promote ${row.id}:`, promoteError);
          await supabase
            .from("agent_submissions_staging")
            .update({
              review_status: "rejected",
              reviewed_at: new Date().toISOString(),
              reviewed_by: "auto",
              review_reason: `Promotion failed: ${promoteError.message}`,
            })
            .eq("id", row.id);

          await supabase.rpc("record_agent_submission", {
            p_agent_id: row.agent_id,
            p_outcome: "error",
            p_kind: row.kind,
          });

          stats.rejected++;
          continue;
        }

        // Mark staging row as accepted
        await supabase
          .from("agent_submissions_staging")
          .update({
            review_status: "accepted",
            reviewed_at: new Date().toISOString(),
            reviewed_by: "auto",
            review_reason: "Auto-accepted: passed all validation",
            promoted_observation_id: promoted.id,
            vehicle_id: vehicleId,
          })
          .eq("id", row.id);

        await supabase.rpc("record_agent_submission", {
          p_agent_id: row.agent_id,
          p_outcome: "accepted",
          p_kind: row.kind,
        });

        stats.accepted++;

      } catch (err) {
        console.error(`[review] Error processing submission ${row.id}:`, err);
      }
    }

    // --- 2. Expire old staging rows (>30 days) ---
    const { data: expired, error: expireError } = await supabase
      .from("agent_submissions_staging")
      .update({
        review_status: "expired",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "auto",
        review_reason: "Expired: exceeded 30-day staging window",
      })
      .eq("review_status", "pending")
      .lt("expires_at", new Date().toISOString())
      .select("id, agent_id, kind");

    if (!expireError && expired) {
      stats.expired = expired.length;
      for (const row of expired) {
        await supabase.rpc("record_agent_submission", {
          p_agent_id: row.agent_id,
          p_outcome: "rejected",
          p_kind: row.kind,
        });
      }
    }

    // --- 3. Circuit breaker recovery ---
    // Agents with open circuit breaker for >1hr → set half_open, re-enable key at reduced rate
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: tripped } = await supabase
      .from("agent_quality_metrics")
      .select("agent_id, circuit_breaker_opened_at")
      .eq("circuit_breaker_state", "open")
      .lt("circuit_breaker_opened_at", oneHourAgo);

    for (const agent of (tripped || [])) {
      // Set half_open
      await supabase
        .from("agent_quality_metrics")
        .update({
          circuit_breaker_state: "half_open",
          updated_at: new Date().toISOString(),
        })
        .eq("agent_id", agent.agent_id);

      // Re-enable API key at reduced rate (10/hr for half_open)
      await supabase
        .from("api_keys")
        .update({
          is_active: true,
          rate_limit_per_hour: 10,
          rate_limit_remaining: 10,
        })
        .eq("agent_registration_id", agent.agent_id);

      // Audit log
      await supabase
        .from("agent_audit_log")
        .insert({
          agent_id: agent.agent_id,
          action: "circuit_recover",
          detail: { state: "half_open", reduced_rate: 10 },
        });

      stats.circuit_recoveries++;
    }

    // Half_open agents that have 10+ good recent submissions → close breaker
    const { data: halfOpen } = await supabase
      .from("agent_quality_metrics")
      .select("agent_id, rolling_window")
      .eq("circuit_breaker_state", "half_open");

    for (const agent of (halfOpen || [])) {
      const window = agent.rolling_window || [];
      // Check last 10 entries
      const recent = window.slice(-10);
      const recentErrors = recent.filter((e: any) => ['rejected', 'error'].includes(e.outcome)).length;

      if (recent.length >= 10 && recentErrors === 0) {
        // Get the agent's tier to restore proper rate limit
        const { data: reg } = await supabase
          .from("agent_registrations")
          .select("trust_tier")
          .eq("id", agent.agent_id)
          .single();

        const tierRates: Record<number, number> = { 1: 100, 2: 1000, 3: 5000 };
        const rate = tierRates[reg?.trust_tier ?? 1] || 100;

        await supabase
          .from("agent_quality_metrics")
          .update({
            circuit_breaker_state: "closed",
            updated_at: new Date().toISOString(),
          })
          .eq("agent_id", agent.agent_id);

        await supabase
          .from("api_keys")
          .update({
            rate_limit_per_hour: rate,
            rate_limit_remaining: rate,
          })
          .eq("agent_registration_id", agent.agent_id);

        await supabase
          .from("agent_audit_log")
          .insert({
            agent_id: agent.agent_id,
            action: "circuit_close",
            detail: { restored_rate: rate },
          });
      }
    }

    console.log(`[review-agent-submissions] Done:`, stats);

    return new Response(
      JSON.stringify({ success: true, stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[review-agent-submissions] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
