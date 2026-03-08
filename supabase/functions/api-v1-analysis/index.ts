/**
 * API v1 - Analysis Engine Endpoint
 *
 * Returns analysis signals for a vehicle — proactive deal health, pricing risk,
 * market timing, and presentation gaps surfaced before they become problems.
 *
 * Authentication: Bearer token (Supabase JWT) or API key (nk_live_...)
 *
 * GET  /api-v1-analysis?vehicle_id=<uuid>         — all signals for a vehicle
 * GET  /api-v1-analysis?vehicle_id=<uuid>&widget=<slug> — single widget signal
 * POST /api-v1-analysis  { action: "refresh", vehicle_id }  — trigger recompute
 * POST /api-v1-analysis  { action: "acknowledge", signal_id } — acknowledge signal
 * POST /api-v1-analysis  { action: "dismiss", signal_id, hours } — dismiss for N hours
 * GET  /api-v1-analysis/history?vehicle_id=<uuid>&widget=<slug> — signal history
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// authenticateRequest imported from _shared/apiKeyAuth.ts

// ── Severity label mapping ───────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  ok: 2,
  info: 3,
};

function overallHealth(signals: any[]): {
  score: number;
  label: string;
  worst_signal: string | null;
} {
  if (!signals.length) return { score: 100, label: "unknown", worst_signal: null };

  const avgScore = Math.round(
    signals.reduce((s: number, sig: any) => s + (sig.score ?? 50), 0) / signals.length
  );

  let worstSeverity = "info";
  let worstSlug: string | null = null;

  for (const sig of signals) {
    const sev = sig.severity ?? "info";
    if ((SEVERITY_ORDER[sev] ?? 3) < (SEVERITY_ORDER[worstSeverity] ?? 3)) {
      worstSeverity = sev;
      worstSlug = sig.widget_slug;
    }
  }

  return { score: avgScore, label: worstSeverity, worst_signal: worstSlug };
}

// ── Main handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const auth = await authenticateRequest(req, supabase, { endpoint: 'analysis' });
    if (auth.error || !auth.userId) {
      return json(auth.status || 401, { error: auth.error || "Authentication required" });
    }
    const userId = auth.userId;

    const url = new URL(req.url);

    // ── POST actions ──────────────────────────────────────────────────

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action;

      if (action === "refresh") {
        if (!body.vehicle_id) return json(400, { error: "vehicle_id required" });

        // Fire to coordinator
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/analysis-engine-coordinator`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              action: "evaluate_vehicle",
              vehicle_id: body.vehicle_id,
            }),
          }
        );

        const result = await resp.json();
        return json(200, { data: result });
      }

      if (action === "acknowledge") {
        if (!body.signal_id) return json(400, { error: "signal_id required" });

        const { error } = await supabase
          .from("analysis_signals")
          .update({ acknowledged_at: new Date().toISOString() })
          .eq("id", body.signal_id);

        if (error) return json(500, { error: error.message });
        return json(200, { data: { acknowledged: true } });
      }

      if (action === "dismiss") {
        if (!body.signal_id) return json(400, { error: "signal_id required" });
        const hours = body.hours || 24;
        const dismissUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();

        const { error } = await supabase
          .from("analysis_signals")
          .update({ dismissed_until: dismissUntil })
          .eq("id", body.signal_id);

        if (error) return json(500, { error: error.message });
        return json(200, { data: { dismissed_until: dismissUntil } });
      }

      return json(400, { error: `Unknown action: ${action}` });
    }

    // ── GET signals ───────────────────────────────────────────────────

    if (req.method === "GET") {
      const vehicleId = url.searchParams.get("vehicle_id");
      const widgetSlug = url.searchParams.get("widget");
      const isHistory = url.pathname.endsWith("/history");

      if (!vehicleId) {
        return json(400, { error: "vehicle_id query parameter required" });
      }

      // History endpoint
      if (isHistory) {
        if (!widgetSlug) return json(400, { error: "widget query parameter required for history" });

        const { data: history, error } = await supabase
          .from("analysis_signal_history")
          .select("id, widget_slug, score, severity, headline, confidence, change_direction, created_at")
          .eq("vehicle_id", vehicleId)
          .eq("widget_slug", widgetSlug)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) return json(500, { error: error.message });

        return json(200, {
          data: {
            vehicle_id: vehicleId,
            widget: widgetSlug,
            history: history ?? [],
            count: history?.length ?? 0,
          },
        });
      }

      // Single widget signal
      if (widgetSlug) {
        const { data: signal, error } = await supabase
          .from("analysis_signals")
          .select("*")
          .eq("vehicle_id", vehicleId)
          .eq("widget_slug", widgetSlug)
          .maybeSingle();

        if (error) return json(500, { error: error.message });
        if (!signal) return json(404, { error: `No signal for widget '${widgetSlug}'` });

        return json(200, {
          data: formatSignal(signal),
        });
      }

      // All signals for vehicle
      const { data: signals, error } = await supabase
        .from("analysis_signals")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .order("score", { ascending: true });

      if (error) return json(500, { error: error.message });

      const formatted = (signals ?? []).map(formatSignal);
      const health = overallHealth(signals ?? []);

      // Get widget metadata for display names
      const slugs = (signals ?? []).map((s: any) => s.widget_slug);
      const { data: widgets } = await supabase
        .from("analysis_widgets")
        .select("slug, display_name, category")
        .in("slug", slugs.length > 0 ? slugs : ["__none__"]);

      const widgetMap = new Map(
        (widgets ?? []).map((w: any) => [w.slug, w])
      );

      for (const sig of formatted) {
        const w = widgetMap.get(sig.widget);
        if (w) {
          sig.widget_name = w.display_name;
          sig.category = w.category;
        }
      }

      return json(200, {
        data: {
          vehicle_id: vehicleId,
          health,
          signal_count: formatted.length,
          signals: formatted,
        },
      });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err: any) {
    console.error("[api-v1-analysis] Error:", err);
    return json(500, { error: err.message });
  }
});

// ── Format signal for API response ──────────────────────────────────────

function formatSignal(sig: any) {
  return {
    id: sig.id,
    vehicle_id: sig.vehicle_id,
    widget: sig.widget_slug,
    score: sig.score,
    severity: sig.severity,
    headline: sig.headline,
    details: sig.details,
    reasons: sig.reasons,
    confidence: sig.confidence,
    recommendations: sig.recommendations,
    previous_score: sig.previous_score,
    change_direction: sig.change_direction,
    acknowledged_at: sig.acknowledged_at,
    dismissed_until: sig.dismissed_until,
    computed_at: sig.computed_at,
    stale_at: sig.stale_at,
    updated_at: sig.updated_at,
  };
}
