/**
 * API v1 - Agent Metrics & Heartbeat
 *
 * GET  → Self-service quality dashboard (auth required, agent key)
 * POST → Heartbeat (update last_seen_at, get status notifications)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const auth = await authenticateRequest(req, supabase, { endpoint: 'agent-metrics' });
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error || "Authentication required" }),
        { status: auth.status || 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentId = auth.agentId;
    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "This endpoint is for registered agents only. Use an agent API key." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET — Quality dashboard
    if (req.method === "GET") {
      // Fetch agent registration
      const { data: agent, error: agentError } = await supabase
        .from("agent_registrations")
        .select("id, name, trust_tier, status, capabilities, registered_at, last_seen_at")
        .eq("id", agentId)
        .single();

      if (agentError || !agent) {
        return new Response(
          JSON.stringify({ error: "Agent not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch quality metrics
      const { data: metrics } = await supabase
        .from("agent_quality_metrics")
        .select("*")
        .eq("agent_id", agentId)
        .single();

      // Compute promotion progress
      let promotionProgress = null;
      if (agent.trust_tier === 1 && metrics) {
        const acceptanceRate = metrics.total_submitted > 0
          ? metrics.total_accepted / metrics.total_submitted
          : 0;
        promotionProgress = {
          target_tier: 2,
          accepted: metrics.total_accepted,
          required_accepted: 50,
          acceptance_rate: Math.round(acceptanceRate * 1000) / 10, // 1 decimal %
          required_rate: 80,
          circuit_breaker_trips: metrics.circuit_breaker_trips,
          required_trips: 0,
          progress_pct: Math.min(100, Math.round((metrics.total_accepted / 50) * 100)),
          status: metrics.total_accepted >= 50 && acceptanceRate >= 0.80 && metrics.circuit_breaker_trips === 0
            ? 'eligible' : 'in_progress',
        };
      } else if (agent.trust_tier === 2 && metrics) {
        const acceptanceRate = metrics.total_submitted > 0
          ? metrics.total_accepted / metrics.total_submitted
          : 0;
        promotionProgress = {
          target_tier: 3,
          accepted: metrics.total_accepted,
          required_accepted: 500,
          acceptance_rate: Math.round(acceptanceRate * 1000) / 10,
          required_rate: 95,
          note: "Tier 3 requires manual review",
          progress_pct: Math.min(100, Math.round((metrics.total_accepted / 500) * 100)),
        };
      }

      // Recent outcomes (last 20 from rolling window)
      const recentOutcomes = (metrics?.rolling_window || []).slice(-20).reverse();

      // Update last_seen_at
      await supabase
        .from("agent_registrations")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", agentId);

      return new Response(
        JSON.stringify({
          agent: {
            id: agent.id,
            name: agent.name,
            trust_tier: agent.trust_tier,
            status: agent.status,
            capabilities: agent.capabilities,
            registered_at: agent.registered_at,
            last_seen_at: agent.last_seen_at,
          },
          quality: metrics ? {
            total_submitted: metrics.total_submitted,
            total_accepted: metrics.total_accepted,
            total_rejected: metrics.total_rejected,
            total_duplicates: metrics.total_duplicates,
            total_errors: metrics.total_errors,
            acceptance_rate: metrics.total_submitted > 0
              ? Math.round((metrics.total_accepted / metrics.total_submitted) * 1000) / 10
              : 0,
            recent_error_rate: Math.round((metrics.recent_error_rate || 0) * 1000) / 10,
            circuit_breaker: {
              state: metrics.circuit_breaker_state,
              trips: metrics.circuit_breaker_trips,
              opened_at: metrics.circuit_breaker_opened_at,
            },
            by_kind: metrics.submissions_by_kind || {},
            first_submission_at: metrics.first_submission_at,
            last_submission_at: metrics.last_submission_at,
          } : null,
          recent_outcomes: recentOutcomes,
          promotion: promotionProgress,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json", ...auth.headers } }
      );
    }

    // POST — Heartbeat
    if (req.method === "POST") {
      // Update last_seen_at
      await supabase
        .from("agent_registrations")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", agentId);

      // Fetch current status for notifications
      const { data: agent } = await supabase
        .from("agent_registrations")
        .select("trust_tier, status")
        .eq("id", agentId)
        .single();

      const { data: metrics } = await supabase
        .from("agent_quality_metrics")
        .select("circuit_breaker_state, circuit_breaker_trips, recent_error_rate")
        .eq("agent_id", agentId)
        .single();

      // Build notifications
      const notifications: string[] = [];
      if (agent?.status === 'suspended') notifications.push('Your agent is suspended. Contact support.');
      if (agent?.status === 'disabled') notifications.push('Your agent has been disabled.');
      if (agent?.status === 'pending_review') notifications.push('Your agent is pending manual review for Tier 3 promotion.');
      if (metrics?.circuit_breaker_state === 'open') notifications.push('Circuit breaker is OPEN. Your API key is temporarily disabled. Auto-recovery in 1 hour.');
      if (metrics?.circuit_breaker_state === 'half_open') notifications.push('Circuit breaker is HALF-OPEN. Operating at reduced rate (10/hr). Submit clean data to restore full rate.');

      return new Response(
        JSON.stringify({
          status: 'ok',
          trust_tier: agent?.trust_tier,
          agent_status: agent?.status,
          circuit_breaker: metrics?.circuit_breaker_state || 'closed',
          notifications,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json", ...auth.headers } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[agent-metrics] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
