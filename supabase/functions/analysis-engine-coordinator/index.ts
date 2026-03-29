/**
 * ANALYSIS ENGINE COORDINATOR
 *
 * Central orchestrator for the Analysis Engine widget system.
 * Evaluates trigger conditions, dispatches widget computations,
 * and manages the analysis_queue lifecycle.
 *
 * POST /functions/v1/analysis-engine-coordinator
 * {
 *   action: "sweep"                  — Cron: find stale/new vehicles, queue them
 *   action: "compute"                — Process queue items (claim + run widgets)
 *   action: "observation_trigger"    — Event: new observation arrived
 *   action: "evaluate_vehicle"       — On-demand: run all widgets for one vehicle
 *   action: "status"                 — Health check
 *   action: "dashboard"              — All active signals by severity
 *   action: "acknowledge"            — Mark signal as seen
 *   action: "dismiss"                — Snooze signal
 * }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function callWidgetFunction(
  name: string,
  body: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<{ ok: boolean; status: number; data: any }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// ─── Input hashing ───────────────────────────────────────────────────

async function hashInputs(inputs: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(inputs));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Severity helpers ────────────────────────────────────────────────

function determineSeverity(
  score: number | null,
  thresholds: { warning?: number; critical?: number } | null
): string {
  if (!thresholds || score === null) return "info";
  if (thresholds.critical !== undefined && score <= thresholds.critical)
    return "critical";
  if (thresholds.warning !== undefined && score <= thresholds.warning)
    return "warning";
  return "ok";
}

function compareSeverity(
  oldSeverity: string | null,
  newSeverity: string
): string {
  const order: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    ok: 3,
  };
  if (!oldSeverity) return "new";
  const oldN = order[oldSeverity] ?? 2;
  const newN = order[newSeverity] ?? 2;
  if (newN < oldN) return "degraded";
  if (newN > oldN) return "improved";
  return "unchanged";
}

// ─── Widget Computation ─────────────────────────────────────────────

interface WidgetConfig {
  slug: string;
  display_name: string;
  compute_mode: string;
  edge_function_name: string | null;
  compute_sql: string | null;
  severity_thresholds: { warning?: number; critical?: number } | null;
  stale_after_hours: number;
}

interface WidgetResult {
  score: number | null;
  label?: string;
  severity: string;
  value_json: Record<string, unknown>;
  reasons: string[];
  evidence?: Record<string, unknown>;
  confidence?: number;
  recommendations?: Array<{
    action: string;
    priority: number;
    rationale: string;
  }>;
  compute_time_ms: number;
}

// ─── Inline SQL result interpreters ─────────────────────────────────

function interpretInlineSqlResult(
  slug: string,
  data: any
): {
  score: number | null;
  label?: string;
  severity?: string;
  reasons: string[];
  confidence?: number;
  recommendations?: Array<{ action: string; priority: number; rationale: string }>;
} {
  switch (slug) {
    case "comp-freshness": {
      const compCount = data?.comp_count ?? 0;
      const newestDays = data?.newest_comp_age_days ?? 999;
      let score = 80;
      if (newestDays > 365) score = 20;
      else if (newestDays > 180) score = 40;
      else if (newestDays > 90) score = 60;
      else if (newestDays > 30) score = 75;
      if (compCount < 3) score = Math.min(score, 30);
      else if (compCount < 5) score = Math.min(score, 50);
      const reasons = [`${compCount} comps found, newest ${newestDays} days old`];
      const recommendations: any[] = [];
      if (newestDays > 180) recommendations.push({ action: "Seek fresh comparable sales data", priority: 1, rationale: `Newest comp is ${newestDays} days old — confidence decays significantly after 6 months.` });
      return { score, reasons, confidence: score > 60 ? 0.7 : 0.5, recommendations };
    }

    case "market-velocity": {
      const d30 = data?.windows?.["30d"] ?? {};
      const d90 = data?.windows?.["90d"] ?? {};
      const medianDom30 = d30?.median_dom ?? null;
      const medianDom90 = d90?.median_dom ?? null;
      let score = 50;
      let label = "stable";
      if (medianDom30 !== null && medianDom90 !== null && medianDom90 > 0) {
        const ratio = medianDom30 / medianDom90;
        if (ratio < 0.8) { score = 80; label = "accelerating"; }
        else if (ratio > 1.2) { score = 30; label = "decelerating"; }
        else { score = 60; label = "stable"; }
      }
      const volume30 = d30?.listing_count ?? 0;
      const reasons = [`Market velocity: ${label} — ${volume30} listings in 30d, median DOM ${medianDom30 ?? "N/A"}d`];
      return { score, label, reasons, confidence: volume30 > 10 ? 0.7 : 0.4 };
    }

    case "seasonal-pricing": {
      const currentMonth = data?.current_month ?? 0;
      const bestMonth = data?.best_month;
      const worstMonth = data?.worst_month;
      const currentData = data?.current_month_data;
      const overallMedian = data?.overall_median ?? 0;
      let score = 60;
      const reasons: string[] = [];
      if (currentData && overallMedian > 0) {
        const pctVsAvg = Math.round(((currentData.median_price - overallMedian) / overallMedian) * 100);
        if (pctVsAvg >= 5) { score = 80; reasons.push(`Current month is ${pctVsAvg}% above annual median — good time to sell`); }
        else if (pctVsAvg <= -5) { score = 35; reasons.push(`Current month is ${Math.abs(pctVsAvg)}% below annual median — consider waiting`); }
        else { score = 60; reasons.push(`Current month is near annual median (${pctVsAvg > 0 ? "+" : ""}${pctVsAvg}%)`); }
      } else {
        reasons.push("Insufficient seasonal data for this segment");
      }
      const recommendations: any[] = [];
      if (bestMonth && currentMonth !== bestMonth.sale_month) {
        const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        recommendations.push({ action: `Optimal listing month: ${monthNames[bestMonth.sale_month] ?? bestMonth.sale_month}`, priority: 2, rationale: `Best month median: $${Number(bestMonth.median_price).toLocaleString()} vs overall $${Number(overallMedian).toLocaleString()}.` });
      }
      return { score, reasons, confidence: (data?.sample_months ?? 0) >= 6 ? 0.7 : 0.4, recommendations };
    }

    case "auction-house-optimizer": {
      const platforms = data?.platforms ?? [];
      const bestSellThrough = data?.best_sell_through;
      const bestPrice = data?.best_price;
      let score = 60;
      const reasons: string[] = [];
      if (platforms.length === 0) {
        score = 50;
        reasons.push("No platform data available for this segment");
      } else {
        score = 70;
        reasons.push(`${platforms.length} platforms analyzed for this segment`);
        if (bestSellThrough) reasons.push(`Best sell-through: ${bestSellThrough.platform} at ${bestSellThrough.sell_through_pct}%`);
        if (bestPrice) reasons.push(`Highest median hammer: ${bestPrice.platform} at $${Number(bestPrice.median_hammer).toLocaleString()}`);
      }
      const recommendations: any[] = [];
      if (bestSellThrough && bestPrice && bestSellThrough.platform !== bestPrice.platform) {
        recommendations.push({ action: `List on ${bestSellThrough.platform} for fastest sale or ${bestPrice.platform} for highest price`, priority: 1, rationale: `${bestSellThrough.platform}: ${bestSellThrough.sell_through_pct}% sell-through. ${bestPrice.platform}: $${Number(bestPrice.median_hammer).toLocaleString()} median hammer.` });
      } else if (bestSellThrough) {
        recommendations.push({ action: `List on ${bestSellThrough.platform}`, priority: 1, rationale: `Best sell-through (${bestSellThrough.sell_through_pct}%) and price performance for this segment.` });
      }
      return { score, reasons, confidence: platforms.length >= 3 ? 0.75 : 0.5, recommendations };
    }

    case "geographic-arbitrage": {
      const regions = data?.regions ?? [];
      const spreadPct = data?.spread_pct ?? 0;
      const highest = data?.highest_region;
      const lowest = data?.lowest_region;
      let score = 60;
      const reasons: string[] = [];
      if (regions.length < 3) {
        score = 50;
        reasons.push("Insufficient regional data for arbitrage analysis");
      } else {
        if (spreadPct > 30) { score = 85; reasons.push(`${Math.round(spreadPct)}% price spread across ${regions.length} regions — strong arbitrage potential`); }
        else if (spreadPct > 15) { score = 70; reasons.push(`${Math.round(spreadPct)}% price spread — moderate arbitrage opportunity`); }
        else { score = 55; reasons.push(`Only ${Math.round(spreadPct)}% price spread — limited geographic arbitrage`); }
      }
      const recommendations: any[] = [];
      if (highest && lowest && spreadPct > 15) {
        const diff = Number(highest.median_price) - Number(lowest.median_price);
        recommendations.push({ action: `Buy in ${lowest.region}, sell in ${highest.region}`, priority: 1, rationale: `$${diff.toLocaleString()} price differential. ${lowest.region}: $${Number(lowest.median_price).toLocaleString()} vs ${highest.region}: $${Number(highest.median_price).toLocaleString()}.` });
      }
      return { score, reasons, confidence: regions.length >= 5 ? 0.7 : 0.4, recommendations };
    }

    case "data-quality": {
      const fieldsFilled = data?.fields_filled ?? 0;
      const fieldsTotal = data?.fields_total ?? 16;
      const fillPct = data?.field_fill_pct ?? 0;
      const imageCount = data?.image_count ?? 0;
      const hasDescription = data?.has_description ?? false;
      const hasVin = data?.has_vin ?? false;
      const hasPrice = data?.has_price ?? false;

      const score = Math.round(fillPct);
      const reasons: string[] = [`${fieldsFilled}/${fieldsTotal} fields populated (${fillPct}%)`];
      if (imageCount === 0) reasons.push("No images uploaded");
      else reasons.push(`${imageCount} images`);
      if (!hasDescription) reasons.push("Missing description");
      if (!hasVin) reasons.push("Missing VIN");
      if (!hasPrice) reasons.push("Missing sale price");

      let severity: string | undefined;
      if (score <= 20) severity = "critical";
      else if (score <= 40) severity = "warning";
      else if (score <= 65) severity = "info";
      else severity = "ok";

      const label = `Data Quality: ${score >= 75 ? "Strong" : score >= 50 ? "Adequate" : score >= 30 ? "Sparse" : "Minimal"}`;
      const recommendations: any[] = [];
      if (!hasVin) recommendations.push({ action: "Add VIN to vehicle record", priority: 1, rationale: "VIN enables decode, identity verification, and history lookup." });
      if (!hasDescription) recommendations.push({ action: "Add vehicle description", priority: 2, rationale: "Descriptions improve search visibility and buyer confidence." });
      if (imageCount < 10) recommendations.push({ action: "Upload more photos", priority: 2, rationale: `Only ${imageCount} images — aim for 20+ covering all angles.` });
      return { score, label, severity, reasons, confidence: 0.95, recommendations };
    }

    case "photo-coverage": {
      const imageCount = data?.image_count ?? 0;
      const categoryBreakdown = data?.category_breakdown ?? {};
      const distinctCategories = data?.distinct_categories ?? 0;
      const score = data?.score ?? 0;

      const reasons: string[] = [`${imageCount} total images`];
      if (distinctCategories > 0) {
        reasons.push(`${distinctCategories} photo categories covered`);
      }
      if (imageCount === 0) reasons.push("No photos — critical gap");

      let severity: string | undefined;
      if (score <= 10) severity = "critical";
      else if (score <= 30) severity = "warning";
      else if (score <= 60) severity = "info";
      else severity = "ok";

      const label = `Photo Coverage: ${imageCount === 0 ? "None" : imageCount < 5 ? "Minimal" : imageCount < 15 ? "Partial" : imageCount < 30 ? "Good" : "Comprehensive"}`;
      const recommendations: any[] = [];
      if (imageCount < 5) recommendations.push({ action: "Upload exterior and interior photos", priority: 1, rationale: "Minimum 5 photos needed for basic coverage." });
      if (imageCount >= 5 && imageCount < 20) recommendations.push({ action: "Add engine bay, undercarriage, and detail photos", priority: 2, rationale: "20+ photos with full zone coverage builds buyer confidence." });
      return { score, label, severity, reasons, confidence: 0.95, recommendations };
    }

    case "identity-confidence": {
      const hasFullVin = data?.has_full_vin ?? false;
      const hasYear = data?.has_year ?? false;
      const hasMake = data?.has_make ?? false;
      const hasModel = data?.has_model ?? false;
      const vinConfidence = data?.vin_confidence;
      const eventCount = data?.event_count ?? 0;
      const score = data?.score ?? 15;

      const reasons: string[] = [];
      if (hasFullVin) reasons.push("Full 17-digit VIN present");
      else if (data?.vin) reasons.push("Partial VIN present");
      else reasons.push("No VIN on record");
      if (vinConfidence !== null && vinConfidence !== undefined) reasons.push(`VIN confidence: ${Math.round(vinConfidence * 100)}%`);
      if (!hasYear || !hasMake || !hasModel) {
        const missing = [!hasYear && "year", !hasMake && "make", !hasModel && "model"].filter(Boolean);
        reasons.push(`Missing identity fields: ${missing.join(", ")}`);
      } else {
        reasons.push("Year/Make/Model complete");
      }
      if (eventCount > 0) reasons.push(`${eventCount} cross-platform events`);

      let severity: string | undefined;
      if (score <= 25) severity = "critical";
      else if (score <= 50) severity = "warning";
      else if (score <= 75) severity = "info";
      else severity = "ok";

      const label = `Identity: ${score >= 80 ? "Verified" : score >= 60 ? "Partial" : score >= 35 ? "Incomplete" : "Unverified"}`;
      const recommendations: any[] = [];
      if (!hasFullVin) recommendations.push({ action: "Add or verify VIN", priority: 1, rationale: "Full VIN is required for decode, history reports, and identity verification." });
      if (!hasMake || !hasModel) recommendations.push({ action: "Complete year/make/model fields", priority: 1, rationale: "Core identity fields enable market comparison and search." });
      return { score, label, severity, reasons, confidence: 0.9, recommendations };
    }

    case "price-position": {
      const salePrice = data?.sale_price ? Number(data.sale_price) : null;
      const nukeEstimate = data?.nuke_estimate ? Number(data.nuke_estimate) : null;
      const divergencePct = data?.divergence_pct ? Number(data.divergence_pct) : null;
      const priceStatus = data?.price_status ?? "unknown";
      const score = data?.score ?? 30;

      const reasons: string[] = [];
      if (priceStatus === "both_available" && divergencePct !== null) {
        const direction = divergencePct > 0 ? "above" : "below";
        reasons.push(`Sale price $${salePrice?.toLocaleString()} is ${Math.abs(divergencePct)}% ${direction} estimate $${nukeEstimate?.toLocaleString()}`);
      } else if (priceStatus === "no_sale_price") {
        reasons.push("No sale price recorded");
      } else if (priceStatus === "no_estimate") {
        reasons.push(`Sale price: $${salePrice?.toLocaleString()} — no Nuke estimate computed yet`);
      }

      let severity: string | undefined;
      if (score <= 20) severity = "critical";
      else if (score <= 40) severity = "warning";
      else if (score <= 60) severity = "info";
      else severity = "ok";

      const label = `Price: ${priceStatus === "both_available" ? (Math.abs(divergencePct ?? 0) <= 15 ? "Well-positioned" : "Divergent") : priceStatus === "no_sale_price" ? "No sale data" : "Estimate needed"}`;
      const recommendations: any[] = [];
      if (priceStatus === "no_estimate") recommendations.push({ action: "Run valuation computation", priority: 2, rationale: "Nuke estimate enables price positioning analysis." });
      if (priceStatus === "no_sale_price") recommendations.push({ action: "Record sale price", priority: 2, rationale: "Sale price enables market position analysis." });
      if (divergencePct !== null && Math.abs(divergencePct) > 30) recommendations.push({ action: "Review pricing — significant divergence detected", priority: 1, rationale: `${Math.abs(divergencePct)}% gap between sale price and estimate warrants investigation.` });
      return { score, label, severity, reasons, confidence: priceStatus === "both_available" ? 0.85 : 0.5, recommendations };
    }

    case "build-progress": {
      const sessionCount = data?.session_count ?? 0;
      const totalHours = data?.total_hours ?? 0;
      const totalPartsCost = data?.total_parts_cost ?? 0;
      const totalLaborCost = data?.total_labor_cost ?? 0;
      const workOrderCount = data?.work_order_count ?? 0;
      const estimatedPct = data?.estimated_pct;
      const daysSinceLastSession = data?.days_since_last_session;
      const score = data?.score ?? 10;

      const reasons: string[] = [];
      if (sessionCount === 0 && workOrderCount === 0) {
        reasons.push("No work sessions or work orders recorded");
      } else {
        if (sessionCount > 0) reasons.push(`${sessionCount} work sessions, ${totalHours}h total labor`);
        if (workOrderCount > 0) reasons.push(`${workOrderCount} work orders`);
        if (totalPartsCost > 0) reasons.push(`$${Number(totalPartsCost).toLocaleString()} in parts`);
        if (estimatedPct !== null && estimatedPct !== undefined) reasons.push(`Estimated ${Math.round(estimatedPct)}% complete`);
        if (daysSinceLastSession !== null && daysSinceLastSession !== undefined) {
          if (daysSinceLastSession > 60) reasons.push(`Stalled — ${daysSinceLastSession} days since last session`);
          else if (daysSinceLastSession > 14) reasons.push(`${daysSinceLastSession} days since last session`);
        }
      }

      let severity: string | undefined;
      if (score <= 15) severity = "critical";
      else if (score <= 35) severity = "warning";
      else if (score <= 60) severity = "info";
      else severity = "ok";

      const label = `Build: ${sessionCount === 0 && workOrderCount === 0 ? "No work tracked" : estimatedPct !== null && estimatedPct >= 90 ? "Near complete" : estimatedPct !== null ? `${Math.round(estimatedPct)}% estimated` : "In progress"}`;
      const recommendations: any[] = [];
      if (sessionCount === 0 && workOrderCount === 0) recommendations.push({ action: "Log work sessions to track build progress", priority: 2, rationale: "Work tracking enables progress monitoring and cost analysis." });
      if (daysSinceLastSession !== null && daysSinceLastSession > 30) recommendations.push({ action: "Schedule next work session", priority: 2, rationale: `Build has been inactive for ${daysSinceLastSession} days.` });
      return { score, label, severity, reasons, confidence: sessionCount > 0 ? 0.8 : 0.5, recommendations };
    }

    default:
      return { score: data?.score ?? null, reasons: data?.reasons ?? [], confidence: data?.confidence };
  }
}

async function computeWidget(
  supabase: any,
  vehicleId: string,
  widget: WidgetConfig
): Promise<WidgetResult> {
  const startMs = Date.now();

  if (widget.compute_mode === "edge_function" && widget.edge_function_name) {
    // Call the widget edge function
    try {
      const result = await callWidgetFunction(widget.edge_function_name, {
        vehicle_id: vehicleId,
      });

      if (!result.ok || !result.data) {
        return {
          score: null,
          severity: "info",
          value_json: { error: `Widget function returned ${result.status}` },
          reasons: [`Widget ${widget.slug} computation failed`],
          compute_time_ms: Date.now() - startMs,
        };
      }

      const d = result.data;
      return {
        score: d.score ?? null,
        label: d.label,
        severity:
          d.severity ??
          determineSeverity(d.score, widget.severity_thresholds),
        value_json: d.details ?? d.value_json ?? {},
        reasons: d.reasons ?? (d.headline ? [d.headline] : []),
        evidence: d.evidence,
        confidence: d.confidence,
        recommendations: d.recommendations,
        compute_time_ms: Date.now() - startMs,
      };
    } catch (err: any) {
      return {
        score: null,
        severity: "info",
        value_json: { error: err.message },
        reasons: [`Widget ${widget.slug} failed: ${err.message}`],
        compute_time_ms: Date.now() - startMs,
      };
    }
  }

  if (widget.compute_mode === "inline_sql" && widget.compute_sql) {
    // Execute SQL directly via execute_recovery_sql RPC
    try {
      const sql = widget.compute_sql
        .replace(/\$1/g, `'${vehicleId}'`)
        .replace(/\\\$VEHICLE_ID/g, `'${vehicleId}'`)
        .replace(/\$VEHICLE_ID/g, `'${vehicleId}'`);
      const { data, error } = await supabase.rpc("execute_readonly_query", {
        p_sql: sql,
      });

      if (error) {
        return {
          score: null,
          severity: "info",
          value_json: { error: error.message },
          reasons: [`SQL execution failed for ${widget.slug}`],
          compute_time_ms: Date.now() - startMs,
        };
      }

      // execute_readonly_query returns jsonb directly; SQL uses `result` column alias
      const raw = typeof data === "string" ? JSON.parse(data) : data;
      const parsed = raw?.result ?? raw ?? {};

      // Interpret the SQL result into a widget score
      const interpreted = interpretInlineSqlResult(widget.slug, parsed);
      return {
        score: interpreted.score,
        label: interpreted.label,
        severity: interpreted.severity ?? determineSeverity(interpreted.score, widget.severity_thresholds),
        value_json: parsed,
        reasons: interpreted.reasons,
        confidence: interpreted.confidence,
        recommendations: interpreted.recommendations,
        compute_time_ms: Date.now() - startMs,
      };
    } catch (err: any) {
      return {
        score: null,
        severity: "info",
        value_json: { error: err.message },
        reasons: [`SQL failed for ${widget.slug}: ${err.message}`],
        compute_time_ms: Date.now() - startMs,
      };
    }
  }

  // Widget not ready (no function or SQL configured)
  return {
    score: null,
    severity: "info",
    value_json: { status: "widget_not_configured" },
    reasons: [`Widget ${widget.slug} has no compute logic configured yet`],
    compute_time_ms: Date.now() - startMs,
  };
}

// ─── Upsert Signal ──────────────────────────────────────────────────

async function upsertSignal(
  supabase: any,
  vehicleId: string,
  widget: WidgetConfig,
  result: WidgetResult
): Promise<{ isNew: boolean; changed: boolean }> {
  // Check existing signal
  const { data: existing } = await supabase
    .from("analysis_signals")
    .select("id, score, severity, input_hash, changed_at")
    .eq("vehicle_id", vehicleId)
    .eq("widget_slug", widget.slug)
    .maybeSingle();

  const changeDirection = existing
    ? compareSeverity(existing.severity, result.severity)
    : "new";

  const staleAt = new Date(
    Date.now() + widget.stale_after_hours * 3600000
  ).toISOString();

  const signalData = {
    vehicle_id: vehicleId,
    widget_slug: widget.slug,
    score: result.score,
    label: result.label ?? null,
    severity: result.severity,
    value_json: result.value_json,
    reasons: result.reasons,
    evidence: result.evidence ?? null,
    confidence: result.confidence ?? null,
    recommendations: result.recommendations ?? [],
    previous_score: existing?.score ?? null,
    previous_severity: existing?.severity ?? null,
    changed_at:
      changeDirection !== "unchanged"
        ? new Date().toISOString()
        : existing?.changed_at ?? new Date().toISOString(),
    change_direction: changeDirection,
    computed_at: new Date().toISOString(),
    stale_at: staleAt,
    compute_time_ms: result.compute_time_ms,
  };

  const { data: upserted, error } = await supabase
    .from("analysis_signals")
    .upsert(signalData, {
      onConflict: "vehicle_id,widget_slug",
    })
    .select("id")
    .single();

  if (error) {
    console.error(`Failed to upsert signal ${widget.slug}:`, error.message);
    return { isNew: false, changed: false };
  }

  // Write history if severity changed
  if (changeDirection !== "unchanged" && upserted?.id) {
    await supabase.from("analysis_signal_history").insert({
      signal_id: upserted.id,
      vehicle_id: vehicleId,
      widget_slug: widget.slug,
      score: result.score,
      severity: result.severity,
      label: result.label ?? null,
      reasons: result.reasons,
      computed_at: new Date().toISOString(),
    });
  }

  return {
    isNew: !existing,
    changed: changeDirection === "degraded" || changeDirection === "improved",
  };
}

// ─── Backfill: ARS-scored vehicles with no analysis signals ──────────

async function handleBackfillAuctions(
  supabase: any,
  batchSize: number
): Promise<unknown> {
  const limit = Math.min(batchSize, 100);

  // Find vehicles with auction_readiness scores but zero analysis_signals rows.
  // Use auction_readiness table directly, then filter out those already in analysis_signals.
  const { data: arsVehicles, error: arsErr } = await supabase
    .from("auction_readiness")
    .select("vehicle_id")
    .order("composite_score", { ascending: false })
    .limit(limit * 3); // over-fetch since we filter below

  if (arsErr || !arsVehicles?.length) {
    return { error: arsErr?.message ?? "no_ars_vehicles", queued: 0 };
  }

  // Check which of these already have signals
  const vehicleIds = arsVehicles.map((r: any) => r.vehicle_id);
  const { data: existingSignals } = await supabase
    .from("analysis_signals")
    .select("vehicle_id")
    .in("vehicle_id", vehicleIds.slice(0, 200));

  const hasSignals = new Set((existingSignals ?? []).map((r: any) => r.vehicle_id));
  const rows = vehicleIds.filter((id: string) => !hasSignals.has(id)).slice(0, limit);

  let queued = 0;
  for (const vid of rows) {
    if (!vid) continue;
    const { error } = await supabase.from("analysis_queue").upsert(
      {
        vehicle_id: vid,
        trigger_source: "backfill_auctions",
        trigger_reasons: ["ars_scored_no_signals"],
        status: "pending",
        priority: 30, // Lower than sweep (50) and observation (70)
      },
      { onConflict: "vehicle_id", ignoreDuplicates: true }
    );
    if (!error) queued++;
  }

  // Now process the queue
  const processResult = await processQueue(supabase, batchSize);

  return {
    candidates_found: rows.length,
    queued,
    ...processResult,
  };
}

// ─── Actions ─────────────────────────────────────────────────────────

async function handleSweep(
  supabase: any,
  batchSize: number
): Promise<unknown> {
  const now = new Date().toISOString();

  // Find vehicles with stale signals
  const { data: staleVehicles } = await supabase
    .from("analysis_signals")
    .select("vehicle_id")
    .lt("stale_at", now)
    .limit(batchSize);

  // Find vehicles with active deals but no signals
  // Use a left join approach via Supabase client
  const { data: unanalyzedDeals } = await supabase
    .from("deal_jackets")
    .select("vehicle_id")
    .is("sold_date", null)
    .not("vehicle_id", "is", null)
    .limit(batchSize);

  const vehicleIds = new Set<string>();

  if (staleVehicles) {
    for (const row of staleVehicles) {
      vehicleIds.add(row.vehicle_id);
    }
  }

  if (unanalyzedDeals && Array.isArray(unanalyzedDeals)) {
    for (const row of unanalyzedDeals) {
      vehicleIds.add(row.vehicle_id);
    }
  }

  // Queue them
  let queued = 0;
  for (const vehicleId of vehicleIds) {
    const { error } = await supabase.from("analysis_queue").upsert(
      {
        vehicle_id: vehicleId,
        trigger_source: "cron_sweep",
        trigger_reasons: ["stale_or_missing_signals"],
        status: "pending",
        priority: 50,
      },
      {
        onConflict: "vehicle_id",
        ignoreDuplicates: true,
      }
    );
    if (!error) queued++;
  }

  // Now process the queue
  const processResult = await processQueue(supabase, batchSize);

  return {
    stale_found: staleVehicles?.length ?? 0,
    unanalyzed_deals: Array.isArray(unanalyzedDeals)
      ? unanalyzedDeals.length
      : 0,
    queued,
    ...processResult,
  };
}

async function processQueue(
  supabase: any,
  batchSize: number
): Promise<unknown> {
  // Claim batch
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_analysis_queue_batch",
    {
      p_batch_size: batchSize,
      p_worker_id: "coordinator-" + Date.now(),
    }
  );

  if (claimError || !claimed?.length) {
    return { claimed: 0, processed: 0, errors: claimError?.message ?? null };
  }

  // Load all enabled widgets
  const { data: widgets } = await supabase
    .from("analysis_widgets")
    .select(
      "slug, display_name, compute_mode, edge_function_name, compute_sql, severity_thresholds, stale_after_hours"
    )
    .eq("is_enabled", true);

  if (!widgets?.length) {
    return { claimed: claimed.length, processed: 0, error: "no_widgets" };
  }

  const results: Array<{
    vehicle_id: string;
    widgets_computed: number;
    widgets_failed: number;
    duration_ms: number;
  }> = [];

  for (const queueItem of claimed) {
    const startMs = Date.now();
    let computed = 0;
    let failed = 0;

    // Determine which widgets to run
    const targetWidgets = queueItem.widget_slugs?.length
      ? widgets.filter((w: WidgetConfig) =>
          queueItem.widget_slugs.includes(w.slug)
        )
      : widgets;

    for (const widget of targetWidgets) {
      // Skip widgets without compute logic
      if (
        widget.compute_mode === "edge_function" &&
        !widget.edge_function_name
      ) {
        continue;
      }
      if (widget.compute_mode === "inline_sql" && !widget.compute_sql) {
        continue;
      }

      try {
        const widgetResult = await computeWidget(
          supabase,
          queueItem.vehicle_id,
          widget
        );

        if (widgetResult.value_json?.status === "widget_not_configured") {
          continue; // Skip unconfigured widgets silently
        }

        await upsertSignal(
          supabase,
          queueItem.vehicle_id,
          widget,
          widgetResult
        );
        computed++;
      } catch (err: any) {
        console.error(
          `Widget ${widget.slug} failed for ${queueItem.vehicle_id}:`,
          err.message
        );
        failed++;
      }
    }

    // Mark queue item complete
    await supabase
      .from("analysis_queue")
      .update({
        status: failed > 0 && computed === 0 ? "failed" : "complete",
        widgets_computed: computed,
        widgets_failed: failed,
        compute_time_ms: Date.now() - startMs,
        completed_at: new Date().toISOString(),
      })
      .eq("id", queueItem.id);

    results.push({
      vehicle_id: queueItem.vehicle_id,
      widgets_computed: computed,
      widgets_failed: failed,
      duration_ms: Date.now() - startMs,
    });
  }

  return {
    claimed: claimed.length,
    processed: results.length,
    total_computed: results.reduce((s, r) => s + r.widgets_computed, 0),
    total_failed: results.reduce((s, r) => s + r.widgets_failed, 0),
    results,
  };
}

async function handleObservationTrigger(
  supabase: any,
  vehicleId: string,
  observationKind: string
): Promise<unknown> {
  // Find widgets that care about this observation kind
  const { data: widgets } = await supabase
    .from("analysis_widgets")
    .select("slug")
    .eq("is_enabled", true)
    .contains("trigger_on_observation_kinds", [observationKind]);

  if (!widgets?.length) {
    return { queued: false, reason: "no_widgets_for_kind", kind: observationKind };
  }

  const widgetSlugs = widgets.map((w: { slug: string }) => w.slug);

  // Queue (upsert with debounce)
  const { error } = await supabase.from("analysis_queue").upsert(
    {
      vehicle_id: vehicleId,
      trigger_source: "observation",
      trigger_reasons: [`observation_kind:${observationKind}`],
      widget_slugs: widgetSlugs,
      status: "pending",
      priority: 70, // Higher priority than cron sweep
    },
    {
      onConflict: "vehicle_id",
      ignoreDuplicates: false,
    }
  );

  return {
    queued: !error,
    vehicle_id: vehicleId,
    observation_kind: observationKind,
    widgets_triggered: widgetSlugs,
    error: error?.message,
  };
}

async function handleEvaluateVehicle(
  supabase: any,
  vehicleId: string,
  widgetSlugs?: string[]
): Promise<unknown> {
  // Load widgets
  let query = supabase
    .from("analysis_widgets")
    .select(
      "slug, display_name, compute_mode, edge_function_name, compute_sql, severity_thresholds, stale_after_hours"
    )
    .eq("is_enabled", true);

  if (widgetSlugs?.length) {
    query = query.in("slug", widgetSlugs);
  }

  const { data: widgets } = await query;
  if (!widgets?.length) {
    return { error: "no_widgets_found" };
  }

  const startMs = Date.now();
  const signalResults: Array<{
    widget: string;
    score: number | null;
    severity: string;
    headline: string;
    is_new: boolean;
    changed: boolean;
    compute_time_ms: number;
  }> = [];

  for (const widget of widgets) {
    // Skip widgets without compute logic
    if (
      widget.compute_mode === "edge_function" &&
      !widget.edge_function_name
    ) {
      continue;
    }
    if (widget.compute_mode === "inline_sql" && !widget.compute_sql) {
      continue;
    }

    const result = await computeWidget(supabase, vehicleId, widget);

    if (result.value_json?.status === "widget_not_configured") {
      continue;
    }

    const { isNew, changed } = await upsertSignal(
      supabase,
      vehicleId,
      widget,
      result
    );

    signalResults.push({
      widget: widget.slug,
      score: result.score,
      severity: result.severity,
      headline: result.reasons?.[0] ?? "",
      is_new: isNew,
      changed,
      compute_time_ms: result.compute_time_ms,
    });
  }

  return {
    vehicle_id: vehicleId,
    widgets_evaluated: signalResults.length,
    total_time_ms: Date.now() - startMs,
    signals: signalResults,
  };
}

async function handleStatus(supabase: any): Promise<unknown> {
  // Widget registry stats
  const { data: allWidgets } = await supabase
    .from("analysis_widgets")
    .select("slug, is_enabled, compute_mode, edge_function_name, compute_sql");

  const widgetStats = {
    enabled_widgets: 0,
    disabled_widgets: 0,
    configured_edge: 0,
    configured_sql: 0,
    unconfigured: 0,
  };
  for (const w of allWidgets ?? []) {
    if (w.is_enabled) widgetStats.enabled_widgets++;
    else widgetStats.disabled_widgets++;
    if (w.compute_mode === "edge_function" && w.edge_function_name)
      widgetStats.configured_edge++;
    if (w.compute_mode === "inline_sql" && w.compute_sql)
      widgetStats.configured_sql++;
    if (w.compute_mode === "edge_function" && !w.edge_function_name)
      widgetStats.unconfigured++;
  }

  // Signal counts by severity
  const signalStats: Record<string, number> = {
    total_signals: 0,
    critical_count: 0,
    warning_count: 0,
    ok_count: 0,
    info_count: 0,
  };
  for (const sev of ["critical", "warning", "ok", "info"]) {
    const { count } = await supabase
      .from("analysis_signals")
      .select("*", { count: "exact", head: true })
      .eq("severity", sev);
    signalStats[`${sev}_count`] = count ?? 0;
    signalStats.total_signals += count ?? 0;
  }

  // Vehicles with signals
  const { count: vehicleCount } = await supabase
    .from("analysis_signals")
    .select("vehicle_id", { count: "exact", head: true });
  signalStats.vehicles_with_signals = vehicleCount ?? 0;

  // Queue stats
  const queueStats: Record<string, number> = {};
  for (const s of ["pending", "processing", "complete", "failed"]) {
    const { count } = await supabase
      .from("analysis_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", s);
    queueStats[s] = count ?? 0;
  }

  return {
    widgets: widgetStats,
    signals: signalStats,
    queue: queueStats,
    timestamp: new Date().toISOString(),
  };
}

async function handleDashboard(
  supabase: any,
  filters?: { vehicle_id?: string; category?: string; severity?: string }
): Promise<unknown> {
  let query = supabase
    .from("analysis_signals")
    .select(
      `
      id,
      vehicle_id,
      widget_slug,
      score,
      severity,
      label,
      reasons,
      recommendations,
      confidence,
      change_direction,
      changed_at,
      computed_at,
      stale_at,
      acknowledged_at,
      dismissed_until
    `
    )
    .order("severity", { ascending: true }) // critical first
    .order("computed_at", { ascending: false });

  if (filters?.vehicle_id) {
    query = query.eq("vehicle_id", filters.vehicle_id);
  }
  if (filters?.severity) {
    query = query.eq("severity", filters.severity);
  }

  // Filter out dismissed
  query = query.or(
    "dismissed_until.is.null,dismissed_until.lt." + new Date().toISOString()
  );

  const { data, error } = await query.limit(100);

  if (error) {
    return { error: error.message };
  }

  // Group by severity for summary
  const summary = {
    critical: 0,
    warning: 0,
    ok: 0,
    info: 0,
  };
  for (const signal of data ?? []) {
    const sev = signal.severity as keyof typeof summary;
    if (sev in summary) summary[sev]++;
  }

  return {
    summary,
    total: data?.length ?? 0,
    signals: data ?? [],
  };
}

async function handleAcknowledge(
  supabase: any,
  signalId: string,
  userId?: string
): Promise<unknown> {
  const { error } = await supabase
    .from("analysis_signals")
    .update({
      acknowledged_by: userId ?? null,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", signalId);

  return { success: !error, error: error?.message };
}

async function handleDismiss(
  supabase: any,
  signalId: string,
  dismissHours: number,
  userId?: string
): Promise<unknown> {
  const dismissUntil = new Date(
    Date.now() + dismissHours * 3600000
  ).toISOString();

  const { error } = await supabase
    .from("analysis_signals")
    .update({
      acknowledged_by: userId ?? null,
      acknowledged_at: new Date().toISOString(),
      dismissed_until: dismissUntil,
    })
    .eq("id", signalId);

  return {
    success: !error,
    dismissed_until: dismissUntil,
    error: error?.message,
  };
}

// ─── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "status";
    const supabase = getSupabase();

    switch (action) {
      case "sweep": {
        const batchSize = Math.min(body.batch_size ?? 20, 100);
        const result = await handleSweep(supabase, batchSize);
        return json(200, { action: "sweep", ...result });
      }

      case "compute": {
        const batchSize = Math.min(body.batch_size ?? 20, 100);
        const result = await processQueue(supabase, batchSize);
        return json(200, { action: "compute", ...result });
      }

      case "observation_trigger": {
        if (!body.vehicle_id || !body.observation_kind) {
          return json(400, {
            error: "vehicle_id and observation_kind required",
          });
        }
        const result = await handleObservationTrigger(
          supabase,
          body.vehicle_id,
          body.observation_kind
        );
        return json(200, { action: "observation_trigger", ...result });
      }

      case "evaluate_vehicle": {
        if (!body.vehicle_id) {
          return json(400, { error: "vehicle_id required" });
        }
        const result = await handleEvaluateVehicle(
          supabase,
          body.vehicle_id,
          body.widget_slugs
        );
        return json(200, { action: "evaluate_vehicle", ...result });
      }

      case "status": {
        const result = await handleStatus(supabase);
        return json(200, { action: "status", ...result });
      }

      case "dashboard": {
        const result = await handleDashboard(supabase, {
          vehicle_id: body.vehicle_id,
          category: body.category,
          severity: body.severity,
        });
        return json(200, { action: "dashboard", ...result });
      }

      case "acknowledge": {
        if (!body.signal_id) {
          return json(400, { error: "signal_id required" });
        }
        const result = await handleAcknowledge(
          supabase,
          body.signal_id,
          body.user_id
        );
        return json(200, { action: "acknowledge", ...result });
      }

      case "dismiss": {
        if (!body.signal_id) {
          return json(400, { error: "signal_id required" });
        }
        const result = await handleDismiss(
          supabase,
          body.signal_id,
          body.dismiss_hours ?? 72,
          body.user_id
        );
        return json(200, { action: "dismiss", ...result });
      }

      case "backfill_auctions": {
        const batchSize = Math.min(body.batch_size ?? 50, 100);
        const result = await handleBackfillAuctions(supabase, batchSize);
        return json(200, { action: "backfill_auctions", ...result });
      }

      default:
        return json(400, {
          error: `Unknown action: ${action}`,
          valid_actions: [
            "sweep",
            "compute",
            "observation_trigger",
            "evaluate_vehicle",
            "status",
            "dashboard",
            "acknowledge",
            "dismiss",
            "backfill_auctions",
          ],
        });
    }
  } catch (err: any) {
    console.error("Analysis engine error:", err);
    return json(500, { error: err.message });
  }
});
