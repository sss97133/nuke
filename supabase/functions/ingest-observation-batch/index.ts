/**
 * INGEST OBSERVATION BATCH
 *
 * Canonical batch intake. Explicit cached_image_property_projection_v1 mode
 * admits up to 3,000 service-authenticated projections in one atomic database
 * transaction, with immutable-parent validation and stored witness receipts.
 * Other observations retain the existing sequential ingest-observation path
 * for vehicle resolution, source validation, dedup and confidence scoring.
 *
 * POST /functions/v1/ingest-observation-batch
 * {
 *   "observations": [ { ...ObservationInput }, ... ],
 *   "options": {
 *     "stop_on_error": false,    // default: continue on individual failures
 *     "gap_fill": false,         // also gap-fill vehicles table via observationWriter
 *     "write_evidence": false    // also write field_evidence rows
 *   }
 * }
 *
 * Max batch size: 200 observations per request.
 * Each observation uses the same schema as ingest-observation.
 *
 * Returns:
 * {
 *   "success": false,
 *   "total": 50,
 *   "ingested": 45,
 *   "duplicates": 3,
 *   "failed": 2,
 *   "results": [ { index, success, observation_id, duplicate, error? }, ... ]
 * }
 */

import { corsHeaders } from "../_shared/cors.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWriteAuth, authenticateWriter } from "../_shared/writeGuard.ts";
import { BatchAdmissionError, CACHED_PROPERTY_MODE, readBatchBody, ingestCachedProperties } from "./cachedProperties.ts";

const MAX_BATCH_SIZE = 200;

interface ObservationInput {
  source_slug: string;
  kind: string;
  observed_at: string;
  source_url?: string;
  source_identifier?: string;
  content_text?: string;
  structured_data?: Record<string, unknown>;
  vehicle_id?: string;
  vehicle_hints?: {
    vin?: string;
    plate?: string;
    year?: number;
    make?: string;
    model?: string;
    url?: string;
  };
  observer_raw?: Record<string, unknown>;
  extractor_id?: string;
  extraction_metadata?: Record<string, unknown>;
  agent_tier?: string;
  agent_model?: string;
  agent_cost_cents?: number;
  agent_duration_ms?: number;
  extraction_method?: string;
  raw_source_ref?: string;
}

interface BatchOptions {
  stop_on_error?: boolean;
  gap_fill?: boolean;
  write_evidence?: boolean;
}

interface BatchRequest {
  observations: ObservationInput[];
  options?: BatchOptions;
}

interface ItemResult {
  index: number;
  success: boolean;
  observation_id?: string;
  vehicle_id?: string;
  vehicle_resolved?: boolean;
  duplicate?: boolean;
  gap_filled?: string[];
  error?: string;
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await readBatchBody(req);

    if (body.mode !== undefined) {
      if (body.mode !== CACHED_PROPERTY_MODE || Object.keys(body).some(k => !["mode", "observations"].includes(k))) {
        throw new BatchAdmissionError("unsupported_batch_mode_or_options");
      }
      const writer = await authenticateWriter(req);
      if (!writer.ok || writer.caller.kind !== "service_role") {
        return new Response(JSON.stringify({ success: false, error: "cached_batch_requires_service_role" }), { status: 403, headers });
      }
      const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false, autoRefreshToken: false } });
      return new Response(JSON.stringify(await ingestCachedProperties(db, body.observations)), { headers });
    }

    if (!body.observations || !Array.isArray(body.observations)) {
      return new Response(JSON.stringify({
        error: "Request body must contain an 'observations' array",
      }), { status: 400, headers });
    }

    if (body.observations.length === 0) {
      return new Response(JSON.stringify({
        success: true, total: 0, ingested: 0, duplicates: 0, failed: 0, results: [],
      }), { headers });
    }

    if (body.observations.length > MAX_BATCH_SIZE) {
      return new Response(JSON.stringify({
        error: `Batch size ${body.observations.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
      }), { status: 400, headers });
    }

    // Generic batches forward using a service key. Never let a signed-in
    // caller enter protected sale admission through that delegated credential.
    if (body.observations.some((obs: ObservationInput & { mode?: unknown }) => obs?.mode === "source_sale_qualification")) {
      return new Response(JSON.stringify({ error: "Protected sale qualification requires direct service-only intake" }),
        { status: 403, headers });
    }

    const opts = body.options || {};
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Create supabase client for gap-fill/evidence operations
    const supabase = (opts.gap_fill || opts.write_evidence)
      ? createClient(supabaseUrl, serviceKey)
      : null;

    const results: ItemResult[] = [];
    let ingested = 0;
    let duplicates = 0;
    let failed = 0;

    for (let i = 0; i < body.observations.length; i++) {
      const obs = body.observations[i];

      try {
        // Call ingest-observation via internal HTTP
        const resp = await fetch(`${supabaseUrl}/functions/v1/ingest-observation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify(obs),
        });

        const data = await resp.json();

        if (!resp.ok || data.success !== true || typeof data.observation_id !== "string") {
          failed++;
          results.push({
            index: i,
            success: false,
            error: data.error || `HTTP ${resp.status}`,
          });
          if (opts.stop_on_error) break;
          continue;
        }

        const itemResult: ItemResult = {
          index: i,
          success: true,
          observation_id: data.observation_id,
          vehicle_id: data.vehicle_id,
          vehicle_resolved: data.vehicle_resolved,
          duplicate: data.duplicate || false,
        };

        if (data.duplicate) {
          duplicates++;
        } else {
          ingested++;
        }

        // Optional gap-fill + evidence via observationWriter
        if (supabase && data.vehicle_id && obs.structured_data && !data.duplicate) {
          try {
            const writeResult = await writeObservation(supabase, {
              vehicleId: data.vehicle_id,
              source: {
                platform: obs.source_slug,
                url: obs.source_url || "",
                sourceIdentifier: obs.source_identifier,
              },
              fields: obs.structured_data as Record<string, any>,
              observationKind: obs.kind,
              extractionMethod: obs.extraction_method || "batch_ingest",
              observedAt: obs.observed_at,
              contentText: obs.content_text,
              agentTier: obs.agent_tier,
              agentModel: obs.agent_model,
              agentCostCents: obs.agent_cost_cents,
              agentDurationMs: obs.agent_duration_ms,
            });

            // The observation was already written by ingest-observation above,
            // so we only care about the gap-fill and evidence results
            if (opts.gap_fill) {
              itemResult.gap_filled = writeResult.gapFilled;
            }
            if (writeResult.errors.length > 0) {
              console.warn(`[batch] observationWriter errors for index ${i}:`, writeResult.errors);
            }
          } catch (e: any) {
            // Don't fail the whole item — observation was already ingested
            console.warn(`[batch] gap-fill/evidence failed for index ${i}: ${e?.message}`);
          }
        }

        results.push(itemResult);
      } catch (e: any) {
        failed++;
        results.push({
          index: i,
          success: false,
          error: e?.message || "Unknown error",
        });
        if (opts.stop_on_error) break;
      }
    }

    return new Response(JSON.stringify({
      success: failed === 0 && results.length === body.observations.length,
      total: body.observations.length,
      ingested,
      duplicates,
      failed,
      results,
    }), { headers });

  } catch (e: any) {
    if (e instanceof BatchAdmissionError) {
      return new Response(JSON.stringify({ success: false, error: e.code }), { status: e.status, headers });
    }
    console.error("[ingest-observation-batch] Request failed");
    return new Response(JSON.stringify({
      success: false, error: "batch_request_failed",
    }), { status: 500, headers });
  }
});
