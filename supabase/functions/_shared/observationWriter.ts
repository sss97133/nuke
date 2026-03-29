/**
 * _shared/observationWriter.ts — Observation + Gap-Fill Bridge
 *
 * Wraps ingest-observation (vehicle_observations) + Tetris gap-fill
 * (batUpsertWithProvenance) in one call. Extractors can adopt the
 * observation system incrementally while still back-filling the
 * vehicles table for backward compatibility.
 *
 * Usage:
 *   import { writeObservation, writeObservationBatch } from "../_shared/observationWriter.ts";
 *
 *   const result = await writeObservation(supabase, {
 *     vehicleId: "uuid",
 *     source: { platform: "bat", url: "https://...", trustScore: 0.85 },
 *     fields: { year: 1967, make: "Porsche", model: "911S" },
 *     observationKind: "listing",
 *     extractionMethod: "html_parse",
 *   });
 *
 * Version: 1.0.0
 */

import {
  batchUpsertWithProvenance,
  type ProvenanceMetadata,
} from "./batUpsertWithProvenance.ts";

const WRITER_VERSION = "observation-writer:1.0.0";

// ─── Types ──────────────────────────────────────────────────────

export interface ObservationSource {
  platform: string;       // observation_sources.slug
  url: string;            // source URL
  trustScore?: number;    // override for source base_trust_score (0-1)
  sourceIdentifier?: string; // platform-specific ID (e.g., comment ID)
}

export interface ObservationInput {
  vehicleId: string;
  source: ObservationSource;
  fields: Record<string, any>;       // extracted key-value pairs
  observationKind?: string;           // observation_kind enum; default "specification"
  rawData?: any;                      // optional raw extraction payload
  extractionMethod?: string;          // "html_parse" | "regex" | "ai" | etc.
  observedAt?: string;                // ISO timestamp; defaults to now
  contentText?: string;               // optional free-text content
  agentTier?: string;                 // LLM provenance
  agentModel?: string;
  agentCostCents?: number;
  agentDurationMs?: number;
}

export interface WriteResult {
  observationId?: string;
  duplicate?: boolean;
  gapFilled: string[];
  confirmed: string[];
  conflicted: string[];
  evidenceIds: string[];
  errors: string[];
}

export interface BatchResult {
  results: WriteResult[];
  totals: {
    observations: number;
    duplicates: number;
    gapFills: number;
    confirmations: number;
    conflicts: number;
    evidenceRows: number;
    errors: number;
  };
}

// Fields managed by compute pipelines — never gap-fill these
let _computedFields: Set<string> | null = null;

async function getComputedFields(supabase: any): Promise<Set<string>> {
  if (_computedFields) return _computedFields;
  try {
    const { data } = await supabase
      .from("pipeline_registry")
      .select("column_name")
      .eq("table_name", "vehicles")
      .eq("do_not_write_directly", true);
    _computedFields = new Set((data || []).map((r: any) => r.column_name));
  } catch {
    _computedFields = new Set();
  }
  return _computedFields;
}

// ─── Source Resolution ──────────────────────────────────────────

interface ResolvedSource {
  id: string;
  baseTrustScore: number;
  supportedObservations: string[];
}

const _sourceCache = new Map<string, ResolvedSource>();

async function resolveSource(supabase: any, slug: string): Promise<ResolvedSource | null> {
  if (_sourceCache.has(slug)) return _sourceCache.get(slug)!;
  const { data, error } = await supabase
    .from("observation_sources")
    .select("id, base_trust_score, supported_observations")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  const resolved: ResolvedSource = {
    id: data.id,
    baseTrustScore: data.base_trust_score,
    supportedObservations: data.supported_observations || [],
  };
  _sourceCache.set(slug, resolved);
  return resolved;
}

// ─── Content Hash ───────────────────────────────────────────────

async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Core: Write Single Observation ─────────────────────────────

export async function writeObservation(
  supabase: any,
  params: ObservationInput,
): Promise<WriteResult> {
  const errors: string[] = [];
  const result: WriteResult = {
    gapFilled: [],
    confirmed: [],
    conflicted: [],
    evidenceIds: [],
    errors,
  };

  const {
    vehicleId,
    source,
    fields,
    observationKind = "specification",
    rawData,
    extractionMethod = "unknown",
    observedAt,
    contentText,
    agentTier,
    agentModel,
    agentCostCents,
    agentDurationMs,
  } = params;

  if (!vehicleId || !source.platform || !source.url) {
    errors.push("vehicleId, source.platform, and source.url are required");
    return result;
  }

  // --- 1. Write observation (independent of gap-fill) ---
  const observationPromise = writeObservationRow(supabase, {
    vehicleId,
    source,
    fields,
    observationKind,
    rawData,
    extractionMethod,
    observedAt,
    contentText,
    agentTier,
    agentModel,
    agentCostCents,
    agentDurationMs,
  }).catch((e: any) => {
    errors.push(`observation: ${e?.message || e}`);
    return null;
  });

  // --- 2. Gap-fill vehicles table (independent of observation) ---
  const gapFillPromise = gapFillVehicle(supabase, vehicleId, source, fields, extractionMethod)
    .catch((e: any) => {
      errors.push(`gap-fill: ${e?.message || e}`);
      return null;
    });

  // --- 3. Write field_evidence rows (independent) ---
  const evidencePromise = writeFieldEvidence(supabase, vehicleId, source, fields, extractionMethod)
    .catch((e: any) => {
      errors.push(`field-evidence: ${e?.message || e}`);
      return [];
    });

  // Await all three in parallel — failures are isolated
  const [obsResult, gapResult, evidenceResult] = await Promise.all([
    observationPromise,
    gapFillPromise,
    evidencePromise,
  ]);

  // Merge results
  if (obsResult) {
    result.observationId = obsResult.observationId;
    result.duplicate = obsResult.duplicate;
  }

  if (gapResult) {
    result.gapFilled = gapResult.gapFilled;
    result.confirmed = gapResult.confirmed;
    result.conflicted = gapResult.conflicted;
  }

  if (evidenceResult) {
    result.evidenceIds = evidenceResult;
  }

  return result;
}

// ─── Core: Batch Write ──────────────────────────────────────────

export async function writeObservationBatch(
  supabase: any,
  observations: ObservationInput[],
): Promise<BatchResult> {
  const results: WriteResult[] = [];
  const totals = {
    observations: 0,
    duplicates: 0,
    gapFills: 0,
    confirmations: 0,
    conflicts: 0,
    evidenceRows: 0,
    errors: 0,
  };

  // Process sequentially to avoid overwhelming the DB with parallel writes.
  // Each individual writeObservation already parallelizes its 3 sub-operations.
  for (const obs of observations) {
    const r = await writeObservation(supabase, obs);
    results.push(r);

    if (r.observationId) totals.observations++;
    if (r.duplicate) totals.duplicates++;
    totals.gapFills += r.gapFilled.length;
    totals.confirmations += r.confirmed.length;
    totals.conflicts += r.conflicted.length;
    totals.evidenceRows += r.evidenceIds.length;
    totals.errors += r.errors.length;
  }

  return { results, totals };
}

// ─── Internal: Observation Row ──────────────────────────────────

async function writeObservationRow(
  supabase: any,
  params: {
    vehicleId: string;
    source: ObservationSource;
    fields: Record<string, any>;
    observationKind: string;
    rawData?: any;
    extractionMethod: string;
    observedAt?: string;
    contentText?: string;
    agentTier?: string;
    agentModel?: string;
    agentCostCents?: number;
    agentDurationMs?: number;
  },
): Promise<{ observationId: string; duplicate: boolean } | null> {
  const resolvedSource = await resolveSource(supabase, params.source.platform);
  if (!resolvedSource) {
    throw new Error(`Unknown source slug: ${params.source.platform}`);
  }

  // Validate observation kind is supported
  if (!resolvedSource.supportedObservations.includes(params.observationKind)) {
    // Gracefully skip — some sources haven't registered all kinds yet.
    // Log but don't throw to avoid blocking gap-fill.
    console.warn(
      `[observationWriter] Source ${params.source.platform} does not support kind "${params.observationKind}". ` +
      `Supported: ${resolvedSource.supportedObservations.join(", ")}. Skipping observation row.`
    );
    return null;
  }

  // Content hash for dedup
  const contentForHash = JSON.stringify({
    source: params.source.platform,
    kind: params.observationKind,
    identifier: params.source.sourceIdentifier,
    text: params.contentText,
    data: params.fields,
  });
  const contentHash = await hashContent(contentForHash);

  // Dedup check
  const { data: existing } = await supabase
    .from("vehicle_observations")
    .select("id")
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (existing) {
    return { observationId: existing.id, duplicate: true };
  }

  // Compute confidence
  const baseTrust = params.source.trustScore ?? resolvedSource.baseTrustScore ?? 0.5;
  const confidenceScore = Math.min(1.0, baseTrust + (params.contentText && params.contentText.length > 100 ? 0.05 : 0));
  const confidenceLevel =
    confidenceScore >= 0.95 ? "verified" :
    confidenceScore >= 0.85 ? "high" :
    confidenceScore >= 0.4 ? "medium" : "low";

  const { data: observation, error } = await supabase
    .from("vehicle_observations")
    .insert({
      vehicle_id: params.vehicleId,
      vehicle_match_confidence: 1.0, // caller provides vehicleId directly
      observed_at: params.observedAt || new Date().toISOString(),
      source_id: resolvedSource.id,
      source_url: params.source.url,
      source_identifier: params.source.sourceIdentifier,
      kind: params.observationKind,
      content_text: params.contentText,
      content_hash: contentHash,
      structured_data: params.fields,
      confidence: confidenceLevel,
      confidence_score: confidenceScore,
      extraction_method: params.extractionMethod,
      extraction_metadata: params.rawData ? { raw: params.rawData } : null,
      agent_tier: params.agentTier,
      agent_model: params.agentModel,
      agent_cost_cents: params.agentCostCents,
      agent_duration_ms: params.agentDurationMs,
      extracted_by: WRITER_VERSION,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Observation insert failed: ${error.message}`);
  }

  return { observationId: observation?.id, duplicate: false };
}

// ─── Internal: Gap-Fill via Tetris ──────────────────────────────

async function gapFillVehicle(
  supabase: any,
  vehicleId: string,
  source: ObservationSource,
  fields: Record<string, any>,
  extractionMethod: string,
): Promise<{ gapFilled: string[]; confirmed: string[]; conflicted: string[] }> {
  // Filter out computed fields
  const computedFields = await getComputedFields(supabase);
  const safeFields: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!computedFields.has(k)) {
      safeFields[k] = v;
    }
  }

  if (Object.keys(safeFields).length === 0) {
    return { gapFilled: [], confirmed: [], conflicted: [] };
  }

  // Fetch existing vehicle row for comparison
  const { data: existing, error: fetchError } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error(`Vehicle ${vehicleId} not found: ${fetchError?.message || "no data"}`);
  }

  const defaultMetadata: ProvenanceMetadata = {
    extraction_version: WRITER_VERSION,
    extraction_method: extractionMethod,
    source_url: source.url,
    confidence_score: source.trustScore ?? 0.7,
    source_signal: source.platform,
  };

  const { updatePayload, results, stats } = await batchUpsertWithProvenance(
    supabase,
    vehicleId,
    source.url,
    WRITER_VERSION,
    existing,
    safeFields,
    {}, // no per-field metadata overrides
    defaultMetadata,
  );

  // Apply gap-filled values to vehicles table
  if (Object.keys(updatePayload).length > 0) {
    const { error: updateError } = await supabase
      .from("vehicles")
      .update(updatePayload)
      .eq("id", vehicleId);

    if (updateError) {
      throw new Error(`Vehicle update failed: ${updateError.message}`);
    }
  }

  return {
    gapFilled: results.filter((r) => r.action === "gap_fill").map((r) => r.field),
    confirmed: results.filter((r) => r.action === "confirmation").map((r) => r.field),
    conflicted: results.filter((r) => r.action === "conflict").map((r) => r.field),
  };
}

// ─── Internal: Field Evidence ───────────────────────────────────

async function writeFieldEvidence(
  supabase: any,
  vehicleId: string,
  source: ObservationSource,
  fields: Record<string, any>,
  extractionMethod: string,
): Promise<string[]> {
  const rows = Object.entries(fields)
    .filter(([_, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([field, value]) => ({
      vehicle_id: vehicleId,
      field_name: field,
      proposed_value: String(value).trim(),
      source_type: source.platform,
      source_confidence: Math.round((source.trustScore ?? 0.7) * 100),
      extraction_context: `${extractionMethod} via ${WRITER_VERSION}`,
      supporting_signals: [{ url: source.url, method: extractionMethod }],
      status: "pending",
    }));

  if (rows.length === 0) return [];

  // Use upsert with onConflict to handle the unique constraint
  // (vehicle_id, field_name, source_type, proposed_value)
  const { data, error } = await supabase
    .from("field_evidence")
    .upsert(rows, { onConflict: "vehicle_id,field_name,source_type,proposed_value", ignoreDuplicates: true })
    .select("id");

  if (error) {
    throw new Error(`field_evidence upsert failed: ${error.message}`);
  }

  return (data || []).map((r: any) => r.id);
}
