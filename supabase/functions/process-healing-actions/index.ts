/**
 * Process Healing Actions
 *
 * Processes pending extraction healing actions from extraction_healing_actions table.
 * Handles:
 * - retry_extraction: Re-run extractor on failed vehicles
 * - fallback_extractor: Switch to AI extractor as backup
 * - adjust_confidence: Lower confidence on affected data
 * - flag_for_review: Create admin notification
 * - queue_for_backfill: Add to backfill queue
 * - cross_validate: Compare against other sources
 * - notify_admin: Alert for manual intervention
 *
 * Called via cron every 30 minutes or manually.
 *
 * POST /functions/v1/process-healing-actions
 * Body: { batch_size?: number }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HealingAction {
  id: string;
  action_type: string;
  source: string | null;
  extractor_name: string | null;
  field_name: string | null;
  vehicle_ids: string[] | null;
  trigger_type: string;
  drift_alert_id: string | null;
}

interface HealingResult {
  success: boolean;
  vehiclesAffected?: number;
  fieldsCorrected?: number;
  successCount?: number;
  failureCount?: number;
  error?: string;
  details?: any;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size ?? 10;

    // Get pending healing actions
    const { data: actions, error } = await supabase
      .from("extraction_healing_actions")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (error) throw error;

    if (!actions || actions.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No pending healing actions",
        processed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Processing ${actions.length} healing actions`);
    const results: any[] = [];

    for (const action of actions as HealingAction[]) {
      try {
        // Mark as executing
        await supabase
          .from("extraction_healing_actions")
          .update({
            status: "executing",
            started_at: new Date().toISOString(),
          })
          .eq("id", action.id);

        let result: HealingResult;

        switch (action.action_type) {
          case "retry_extraction":
            result = await handleRetryExtraction(supabase, action, supabaseUrl, serviceKey);
            break;
          case "fallback_extractor":
            result = await handleFallbackExtractor(supabase, action, supabaseUrl, serviceKey);
            break;
          case "adjust_confidence":
            result = await handleAdjustConfidence(supabase, action);
            break;
          case "flag_for_review":
            result = await handleFlagForReview(supabase, action);
            break;
          case "queue_for_backfill":
            result = await handleQueueBackfill(supabase, action);
            break;
          case "cross_validate":
            result = await handleCrossValidate(supabase, action, supabaseUrl, serviceKey);
            break;
          case "notify_admin":
            result = await handleNotifyAdmin(supabase, action);
            break;
          case "invalidate_data":
            result = await handleInvalidateData(supabase, action);
            break;
          case "disable_extractor":
            result = await handleDisableExtractor(supabase, action);
            break;
          default:
            result = { success: false, error: `Unknown action type: ${action.action_type}` };
        }

        // Update action with results
        await supabase
          .from("extraction_healing_actions")
          .update({
            status: result.success ? "completed" : "failed",
            completed_at: new Date().toISOString(),
            vehicles_affected: result.vehiclesAffected ?? 0,
            fields_corrected: result.fieldsCorrected ?? 0,
            success_count: result.successCount ?? 0,
            failure_count: result.failureCount ?? 0,
            execution_log: result,
          })
          .eq("id", action.id);

        // If this was triggered by a drift alert, update the alert
        if (action.drift_alert_id && result.success) {
          await supabase
            .from("extraction_drift_alerts")
            .update({
              healing_action_id: action.id,
              status: "resolved",
              resolved_at: new Date().toISOString(),
              resolution_notes: `Auto-healed via ${action.action_type}`,
            })
            .eq("id", action.drift_alert_id);
        }

        results.push({
          actionId: action.id,
          actionType: action.action_type,
          ...result,
        });

        console.log(`Action ${action.id} (${action.action_type}): ${result.success ? "completed" : "failed"}`);

      } catch (err: any) {
        console.error(`Action ${action.id} error:`, err.message);

        await supabase
          .from("extraction_healing_actions")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            execution_log: { error: err.message, stack: err.stack },
          })
          .eq("id", action.id);

        results.push({
          actionId: action.id,
          actionType: action.action_type,
          success: false,
          error: err.message,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      succeeded: successCount,
      failed: failureCount,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("Error processing healing actions:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================
// HEALING ACTION HANDLERS
// ============================================

async function handleRetryExtraction(
  supabase: SupabaseClient,
  action: HealingAction,
  supabaseUrl: string,
  serviceKey: string
): Promise<HealingResult> {
  if (!action.vehicle_ids || action.vehicle_ids.length === 0) {
    return { success: false, error: "No vehicle IDs specified for retry" };
  }

  // Get vehicles with their listing URLs
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, listing_url")
    .in("id", action.vehicle_ids)
    .not("listing_url", "is", null);

  if (error) throw error;
  if (!vehicles || vehicles.length === 0) {
    return { success: false, error: "No vehicles with listing URLs found" };
  }

  let successCount = 0;
  let failureCount = 0;

  for (const vehicle of vehicles) {
    try {
      // Call scrape-vehicle function
      const response = await fetch(`${supabaseUrl}/functions/v1/scrape-vehicle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          url: vehicle.listing_url,
          vehicle_id: vehicle.id,
          force_refresh: true,
        }),
      });

      if (response.ok) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch {
      failureCount++;
    }
  }

  return {
    success: successCount > 0,
    vehiclesAffected: vehicles.length,
    successCount,
    failureCount,
  };
}

async function handleFallbackExtractor(
  supabase: SupabaseClient,
  action: HealingAction,
  supabaseUrl: string,
  serviceKey: string
): Promise<HealingResult> {
  if (!action.vehicle_ids || action.vehicle_ids.length === 0) {
    return { success: false, error: "No vehicle IDs specified for fallback" };
  }

  // Get vehicles with their listing URLs
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, listing_url")
    .in("id", action.vehicle_ids)
    .not("listing_url", "is", null);

  if (error) throw error;
  if (!vehicles || vehicles.length === 0) {
    return { success: false, error: "No vehicles with listing URLs found" };
  }

  let successCount = 0;
  let failureCount = 0;

  for (const vehicle of vehicles) {
    try {
      // Use AI extractor as fallback
      const response = await fetch(`${supabaseUrl}/functions/v1/extract-vehicle-data-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          url: vehicle.listing_url,
          vehicle_id: vehicle.id,
        }),
      });

      if (response.ok) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch {
      failureCount++;
    }
  }

  return {
    success: successCount > 0,
    vehiclesAffected: vehicles.length,
    successCount,
    failureCount,
  };
}

async function handleAdjustConfidence(
  supabase: SupabaseClient,
  action: HealingAction
): Promise<HealingResult> {
  // Lower confidence on affected extraction metadata
  // Target the specific field and extractor if specified
  let query = supabase
    .from("extraction_metadata")
    .update({
      confidence_score: 0.3,
      validation_status: "low_confidence",
      updated_at: new Date().toISOString(),
    });

  if (action.extractor_name) {
    query = query.eq("extraction_method", action.extractor_name);
  }
  if (action.field_name) {
    query = query.eq("field_name", action.field_name);
  }
  if (action.vehicle_ids && action.vehicle_ids.length > 0) {
    query = query.in("vehicle_id", action.vehicle_ids);
  }

  // Only affect recent extractions (last 24 hours)
  query = query.gte("extracted_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const { count, error } = await query;

  if (error) throw error;

  return {
    success: true,
    fieldsCorrected: count ?? 0,
  };
}

async function handleFlagForReview(
  supabase: SupabaseClient,
  action: HealingAction
): Promise<HealingResult> {
  // Create admin notification for manual review
  const { error } = await supabase
    .from("admin_notifications")
    .insert({
      notification_type: "system_alert",
      title: `Extraction Review Required: ${action.field_name || action.source || "Unknown"}`,
      message: `Automated healing flagged ${action.field_name || "fields"} from ${action.source || "unknown source"} for manual review due to persistent extraction issues. ${action.vehicle_ids?.length ?? 0} vehicles affected.`,
      priority: 4,
      action_required: "system_action",
      metadata: {
        healing_action_id: action.id,
        source: action.source,
        field: action.field_name,
        trigger: action.trigger_type,
        vehicle_count: action.vehicle_ids?.length ?? 0,
        vehicle_samples: action.vehicle_ids?.slice(0, 5),
      },
    });

  if (error) throw error;

  return {
    success: true,
    vehiclesAffected: action.vehicle_ids?.length ?? 0,
  };
}

async function handleQueueBackfill(
  supabase: SupabaseClient,
  action: HealingAction
): Promise<HealingResult> {
  if (!action.vehicle_ids || action.vehicle_ids.length === 0) {
    return { success: false, error: "No vehicle IDs specified for backfill" };
  }

  // Add to backfill queue
  const backfillItems = action.vehicle_ids.map((vehicleId: string) => ({
    vehicle_id: vehicleId,
    field_names: action.field_name ? [action.field_name] : [],
    reason: "healing_action",
    priority: 3,
    triggered_by: action.id,
    created_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("backfill_queue")
    .upsert(backfillItems, { onConflict: "vehicle_id" })
    .select();

  if (error) throw error;

  return {
    success: true,
    vehiclesAffected: data?.length ?? 0,
  };
}

async function handleCrossValidate(
  supabase: SupabaseClient,
  action: HealingAction,
  supabaseUrl: string,
  serviceKey: string
): Promise<HealingResult> {
  if (!action.vehicle_ids || action.vehicle_ids.length === 0) {
    return { success: false, error: "No vehicle IDs specified for cross-validation" };
  }

  let successCount = 0;
  let conflicts = 0;

  for (const vehicleId of action.vehicle_ids) {
    try {
      // Get all field extractions for this vehicle from different sources
      const { data: extractions } = await supabase
        .from("field_extraction_log")
        .select("source, field_name, extracted_value, confidence_score")
        .eq("vehicle_id", vehicleId)
        .eq("extraction_status", "extracted")
        .eq("field_name", action.field_name || "vin")
        .order("created_at", { ascending: false })
        .limit(10);

      if (extractions && extractions.length > 1) {
        // Compare values from different sources
        const valueMap = new Map<string, { source: string; confidence: number }>();

        for (const ext of extractions) {
          if (!valueMap.has(ext.extracted_value)) {
            valueMap.set(ext.extracted_value, {
              source: ext.source,
              confidence: ext.confidence_score,
            });
          }
        }

        // If multiple different values, log conflict
        if (valueMap.size > 1) {
          const values = Array.from(valueMap.entries());
          await supabase.from("cross_validation_log").insert({
            vehicle_id: vehicleId,
            field_name: action.field_name || "vin",
            primary_source: values[0][1].source,
            secondary_source: values[1][1].source,
            primary_value: values[0][0],
            secondary_value: values[1][0],
            match_status: "conflict",
            created_at: new Date().toISOString(),
          });
          conflicts++;
        }
      }
      successCount++;
    } catch {
      // Continue on error
    }
  }

  return {
    success: successCount > 0,
    vehiclesAffected: successCount,
    details: { conflicts },
  };
}

async function handleNotifyAdmin(
  supabase: SupabaseClient,
  action: HealingAction
): Promise<HealingResult> {
  const { error } = await supabase
    .from("admin_notifications")
    .insert({
      notification_type: "system_alert",
      title: `Extraction Issue: ${action.source || "Unknown"} - ${action.field_name || "Multiple fields"}`,
      message: `Automated monitoring detected issues with ${action.field_name || "extraction"} from ${action.source || "unknown source"}. ${action.vehicle_ids?.length ?? 0} vehicles affected. Trigger: ${action.trigger_type}`,
      priority: 3,
      action_required: "system_action",
      metadata: {
        healing_action_id: action.id,
        trigger_type: action.trigger_type,
        source: action.source,
        field: action.field_name,
        vehicle_count: action.vehicle_ids?.length ?? 0,
      },
    });

  if (error) throw error;

  return { success: true };
}

async function handleInvalidateData(
  supabase: SupabaseClient,
  action: HealingAction
): Promise<HealingResult> {
  if (!action.vehicle_ids || action.vehicle_ids.length === 0) {
    return { success: false, error: "No vehicle IDs specified for invalidation" };
  }

  // Mark extraction metadata as invalid
  const { count, error } = await supabase
    .from("extraction_metadata")
    .update({
      validation_status: "invalid",
      confidence_score: 0,
      updated_at: new Date().toISOString(),
    })
    .in("vehicle_id", action.vehicle_ids)
    .eq("field_name", action.field_name || "");

  if (error) throw error;

  return {
    success: true,
    fieldsCorrected: count ?? 0,
    vehiclesAffected: action.vehicle_ids.length,
  };
}

async function handleDisableExtractor(
  supabase: SupabaseClient,
  action: HealingAction
): Promise<HealingResult> {
  // Log the disable action (actual disabling would require more infrastructure)
  // For now, we just notify admins with high priority

  const { error } = await supabase
    .from("admin_notifications")
    .insert({
      notification_type: "system_alert",
      title: `CRITICAL: Extractor Disabled - ${action.extractor_name}`,
      message: `The ${action.extractor_name} extractor has been flagged for disabling due to repeated failures. Manual intervention required to re-enable.`,
      priority: 5, // Highest priority
      action_required: "system_action",
      metadata: {
        healing_action_id: action.id,
        extractor: action.extractor_name,
        source: action.source,
        field: action.field_name,
        reason: action.trigger_type,
      },
    });

  if (error) throw error;

  // Also update error_pattern_registry to mark patterns as needing review
  if (action.extractor_name) {
    await supabase
      .from("error_pattern_registry")
      .update({
        auto_heal_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .ilike("source_pattern", `%${action.extractor_name}%`);
  }

  return { success: true };
}
