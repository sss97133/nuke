/**
 * INGEST OBSERVATION
 *
 * Unified intake for all vehicle observations from any source.
 * This is the single entry point - all extractors write through here.
 *
 * Features:
 * - Deduplication via content_hash
 * - Automatic confidence scoring
 * - Vehicle resolution (match observation to vehicle)
 * - Source validation
 *
 * POST /functions/v1/ingest-observation
 * {
 *   "source_slug": "bat",
 *   "kind": "comment",
 *   "observed_at": "2024-01-15T10:30:00Z",
 *   "source_url": "https://bringatrailer.com/listing/...",
 *   "source_identifier": "comment-123456",
 *   "content_text": "Beautiful car...",
 *   "structured_data": { ... },
 *   "vehicle_id": "uuid" | null,
 *   "vehicle_hints": { "vin": "...", "plate": "...", "year": 1967, "make": "Porsche" }
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingUrl, normalizeVin } from "../_shared/urlNormalization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  /** LLM provenance — which model produced this observation */
  agent_tier?: string;
  agent_model?: string;
  agent_cost_cents?: number;
  agent_duration_ms?: number;
  extraction_method?: string;
  raw_source_ref?: string;
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const input: ObservationInput = await req.json();

    // Validate required fields
    if (!input.source_slug || !input.kind || !input.observed_at) {
      return new Response(JSON.stringify({
        error: "Missing required fields: source_slug, kind, observed_at"
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Look up source
    const { data: source, error: sourceError } = await supabase
      .from("observation_sources")
      .select("id, base_trust_score, supported_observations")
      .eq("slug", input.source_slug)
      .maybeSingle();

    if (sourceError || !source) {
      return new Response(JSON.stringify({
        error: `Unknown source: ${input.source_slug}`,
        hint: "Register source in observation_sources table first"
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate observation kind is supported by source
    if (!source.supported_observations?.includes(input.kind)) {
      return new Response(JSON.stringify({
        error: `Source ${input.source_slug} does not support observation kind: ${input.kind}`,
        supported: source.supported_observations
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Compute content hash for deduplication
    const contentForHash = JSON.stringify({
      source: input.source_slug,
      kind: input.kind,
      identifier: input.source_identifier,
      text: input.content_text,
      data: input.structured_data
    });
    const contentHash = await hashContent(contentForHash);

    // Check for duplicate
    const { data: existing } = await supabase
      .from("vehicle_observations")
      .select("id")
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        success: true,
        duplicate: true,
        observation_id: existing.id,
        message: "Observation already exists"
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve vehicle if not provided
    let vehicleId = input.vehicle_id;
    let vehicleMatchConfidence = 1.0;
    let vehicleMatchSignals: Record<string, unknown> = {};

    if (!vehicleId && input.vehicle_hints) {
      const hints = input.vehicle_hints;

      // Try VIN match first (highest confidence)
      if (hints.vin) {
        const cleanVin = normalizeVin(hints.vin);
        if (cleanVin) {
          const { data: vinMatch } = await supabase
            .from("vehicles")
            .select("id")
            .eq("vin", cleanVin)
            .maybeSingle();

          if (vinMatch) {
            vehicleId = vinMatch.id;
            vehicleMatchConfidence = 0.99;
            vehicleMatchSignals = { vin_match: true, normalized_vin: cleanVin };
          }
        }
      }

      // Try URL match — first normalized, then exact (for listings we've seen before)
      if (!vehicleId && hints.url) {
        const normUrl = normalizeListingUrl(hints.url);

        // Try canonical listing ID match against vehicles.listing_url
        if (normUrl?.canonicalListingId) {
          // Extract the platform-specific ID pattern to match against existing URLs
          const { data: urlMatches } = await supabase
            .from("vehicles")
            .select("id, listing_url")
            .ilike("listing_url", `%${normUrl.canonicalListingId.split(":")[1]}%`)
            .not("status", "in", "(merged,deleted)")
            .limit(5);

          if (urlMatches?.length === 1) {
            vehicleId = urlMatches[0].id;
            vehicleMatchConfidence = 0.95;
            vehicleMatchSignals = { normalized_url_match: true, canonical_id: normUrl.canonicalListingId };
          } else if (urlMatches && urlMatches.length > 1) {
            // Multiple matches — pick the one with exact normalized match
            for (const m of urlMatches) {
              const mNorm = normalizeListingUrl(m.listing_url);
              if (mNorm?.canonicalListingId === normUrl.canonicalListingId) {
                vehicleId = m.id;
                vehicleMatchConfidence = 0.95;
                vehicleMatchSignals = { normalized_url_match: true, canonical_id: normUrl.canonicalListingId };
                break;
              }
            }
          }
        }

        // Fall back to exact URL match in vehicle_events
        if (!vehicleId) {
          const { data: urlMatch } = await supabase
            .from("vehicle_events")
            .select("vehicle_id")
            .eq("source_url", hints.url)
            .not("vehicle_id", "is", null)
            .maybeSingle();

          if (urlMatch?.vehicle_id) {
            vehicleId = urlMatch.vehicle_id;
            vehicleMatchConfidence = 0.95;
            vehicleMatchSignals = { exact_url_match: true };
          }
        }

        // Also try normalized URL match in vehicle_events
        if (!vehicleId && normUrl?.normalized && normUrl.normalized !== hints.url) {
          const { data: normUrlMatch } = await supabase
            .from("vehicle_events")
            .select("vehicle_id")
            .eq("source_url", normUrl.normalized)
            .not("vehicle_id", "is", null)
            .maybeSingle();

          if (normUrlMatch?.vehicle_id) {
            vehicleId = normUrlMatch.vehicle_id;
            vehicleMatchConfidence = 0.90;
            vehicleMatchSignals = { normalized_event_url_match: true };
          }
        }
      }

      // Try year/make/model fuzzy match (lower confidence)
      if (!vehicleId && hints.year && hints.make) {
        const { data: fuzzyMatches } = await supabase
          .from("vehicles")
          .select("id")
          .eq("year", hints.year)
          .ilike("make", `%${hints.make}%`)
          .limit(5);

        if (fuzzyMatches?.length === 1) {
          vehicleId = fuzzyMatches[0].id;
          vehicleMatchConfidence = 0.60;
          vehicleMatchSignals = { fuzzy_match: true, year: hints.year, make: hints.make };
        } else if (fuzzyMatches?.length > 1) {
          // Multiple matches - leave unresolved for manual review
          vehicleMatchSignals = {
            multiple_candidates: true,
            count: fuzzyMatches.length,
            hints
          };
        }
      }
    }

    // Compute confidence score
    const confidenceFactors: Record<string, number> = {};
    if (vehicleMatchConfidence >= 0.95) confidenceFactors.vehicle_match = 0.1;
    if (input.source_url) confidenceFactors.has_source_url = 0.05;
    if (input.content_text && input.content_text.length > 100) confidenceFactors.substantial_content = 0.05;

    const confidenceScore = Math.min(1.0,
      (source.base_trust_score || 0.5) +
      Object.values(confidenceFactors).reduce((a, b) => a + b, 0)
    );

    // Determine confidence level from score
    let confidenceLevel = "medium";
    if (confidenceScore >= 0.95) confidenceLevel = "verified";
    else if (confidenceScore >= 0.85) confidenceLevel = "high";
    else if (confidenceScore < 0.4) confidenceLevel = "low";

    // Insert observation
    const { data: observation, error: insertError } = await supabase
      .from("vehicle_observations")
      .insert({
        vehicle_id: vehicleId,
        vehicle_match_confidence: vehicleId ? vehicleMatchConfidence : null,
        vehicle_match_signals: Object.keys(vehicleMatchSignals).length > 0 ? vehicleMatchSignals : null,
        observed_at: input.observed_at,
        source_id: source.id,
        source_url: input.source_url,
        source_identifier: input.source_identifier,
        kind: input.kind,
        content_text: input.content_text,
        content_hash: contentHash,
        structured_data: input.structured_data || {},
        confidence: confidenceLevel,
        confidence_score: confidenceScore,
        confidence_factors: confidenceFactors,
        observer_raw: input.observer_raw,
        extractor_id: input.extractor_id,
        extraction_metadata: input.extraction_metadata,
        // LLM provenance fields
        agent_tier: input.agent_tier || null,
        agent_model: input.agent_model || null,
        agent_cost_cents: input.agent_cost_cents || null,
        agent_duration_ms: input.agent_duration_ms || null,
        extraction_method: input.extraction_method || null,
        raw_source_ref: input.raw_source_ref || null
      })
      .select()
      .maybeSingle();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({
        error: "Failed to insert observation",
        details: insertError.message
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fire-and-forget: trigger analysis engine for this vehicle+observation kind
    if (vehicleId && input.kind) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      fetch(`${supabaseUrl}/functions/v1/analysis-engine-coordinator`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
        body: JSON.stringify({ action: "observation_trigger", vehicle_id: vehicleId, observation_kind: input.kind }),
      }).catch(() => {}); // intentionally fire-and-forget
    }

    return new Response(JSON.stringify({
      success: true,
      observation_id: observation.id,
      vehicle_id: vehicleId,
      vehicle_resolved: !!vehicleId,
      vehicle_match_confidence: vehicleMatchConfidence,
      confidence_score: confidenceScore,
      duplicate: false
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({
      error: e.message
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
