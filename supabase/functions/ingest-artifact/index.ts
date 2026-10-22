/**
 * INGEST ARTIFACT — Universal Artifact Dispatcher
 *
 * Phase 1 of the all-nighter (2026-04-26). Single entry point for any
 * unstructured input that should land on the vehicle profile timeline.
 *
 * Skylar's thesis: "Dump unstructured and receive structured — like giving
 * you all my GitHub data but disorganized." This dispatcher is the
 * convergence point that makes that real.
 *
 * Contract doc: docs/library/technical/engineering-manual/16-artifact-dispatcher.md
 *
 * Architecture:
 *
 *   ingest-artifact (this fn)
 *      ├── kind=photo        → photo-pipeline-orchestrator
 *      ├── kind=video_frame  → ingest-video-frame
 *      ├── kind=receipt      → record artifact + emit work_record observation (Phase 2 plugs deeper extraction)
 *      ├── kind=bank_tx      → record + work_record observation [stubbed for Phase 2]
 *      ├── kind=card_tx      → record + work_record observation [stubbed for Phase 2]
 *      ├── kind=work_order   → emit work_record observation
 *      └── kind=document     → emit provenance observation
 *
 *   Every kind ALWAYS goes through ingest-observation. No direct writes
 *   to vehicle_observations from this function. Phase 0 owns the
 *   vehicle_observations triggers — we don't touch them.
 *
 * Resumability: every dispatch is logged to artifact_dispatch_log keyed
 * on (content_sha256, kind). Re-submitting the same artifact returns
 * the prior result (status='duplicate').
 *
 * POST /functions/v1/ingest-artifact
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireWriteAuth, authenticateWriter } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { handleReceiptIntake, RECEIPT_MODE } from "./receiptIntake.ts";

// ============================================================
// Types — the ArtifactInput discriminated union
// ============================================================

type ArtifactKind =
  | "photo"
  | "video_frame"
  | "receipt"
  | "bank_tx"
  | "card_tx"
  | "work_order"
  | "document";

interface VehicleHints {
  vin?: string;
  plate?: string;
  year?: number;
  make?: string;
  model?: string;
  url?: string;
  handle?: string;        // e.g. BaT seller handle
  cluster_id?: string;    // emergent_vehicle_clusters.id
  vehicle_id?: string;    // already-known canonical id (skip resolution)
}

interface BaseArtifact {
  source_slug: string;        // must exist in observation_sources
  submitted_at: string;       // ISO timestamp
  submitted_by?: string;      // script / agent / user identifier
  content_sha256?: string;    // for dedup; required for byte-bearing kinds
  vehicle_hints?: VehicleHints;
  notes?: string;             // free-form note from submitter
}

interface PhotoArtifact extends BaseArtifact {
  kind: "photo";
  // Either bytes (base64) or a resolvable URL.
  image_b64?: string;
  image_url?: string;
  storage_path?: string;
  exif?: Record<string, unknown>;
  taken_at?: string;          // overrides exif if set
  latitude?: number;
  longitude?: number;
}

interface VideoFrameArtifact extends BaseArtifact {
  kind: "video_frame";
  content_sha256: string;     // required
  source_clip: string;
  frame_offset_s: number;
  wall_clock_utc: string;
  resolution?: string;
  fps?: number;
  image_url?: string;
  storage_path?: string;
  file_bytes?: number;
  inherited_lat?: number;
  inherited_lon?: number;
  inherited_from?: string;
  attributed_via?: string;
  youtube_url?: string;
  youtube_video_id?: string;
}

interface ReceiptArtifact extends BaseArtifact {
  kind: "receipt";
  // image-side
  image_b64?: string;
  image_url?: string;
  storage_path?: string;
  // pre-parsed JSON side (e.g. macOS Vision OCR pass)
  parsed?: {
    vendor?: string;
    merchant_name?: string;
    transaction_date?: string;
    total?: number;
    subtotal?: number;
    tax?: number;
    line_items?: Array<{
      description: string;
      quantity?: number;
      unit_price?: number;
      total_price?: number;
      part_number?: string;
    }>;
    receipt_type?: string;
    payment_method?: string;
    card_last_four?: string;
    raw_text?: string;
  };
}

interface BankTxArtifact extends BaseArtifact {
  kind: "bank_tx";
  date: string;               // ISO date
  amount: number;             // signed
  description: string;
  account: string;            // account identifier (e.g. AFCU last4)
  balance_after?: number;
  raw?: Record<string, unknown>;
}

interface CardTxArtifact extends BaseArtifact {
  kind: "card_tx";
  date: string;
  amount: number;
  merchant: string;
  last4: string;
  category?: string;
  raw?: Record<string, unknown>;
}

interface WorkOrderArtifact extends BaseArtifact {
  kind: "work_order";
  vehicle_hint: VehicleHints; // required for work orders
  date: string;
  vendor?: string;
  description?: string;
  line_items?: Array<{
    description: string;
    quantity?: number;
    unit_price?: number;
    total_price?: number;
    type?: "labor" | "part" | "material" | "fee";
    part_number?: string;
  }>;
  total?: number;
  raw?: Record<string, unknown>;
}

interface DocumentArtifact extends BaseArtifact {
  kind: "document";
  document_type?: string;     // 'title' | 'build_sheet' | 'manual_page' | etc.
  image_b64?: string;
  image_url?: string;
  storage_path?: string;
  text?: string;              // pre-extracted text
}

type ArtifactInput =
  | PhotoArtifact
  | VideoFrameArtifact
  | ReceiptArtifact
  | BankTxArtifact
  | CardTxArtifact
  | WorkOrderArtifact
  | DocumentArtifact;

interface DispatchResult {
  ok: boolean;
  artifact_id: string | null;
  status: string;
  observations_created: string[];
  image_id?: string | null;
  confidence_summary?: Record<string, unknown>;
  warnings: string[];
  error?: string;
  duplicate?: boolean;
}

// ============================================================
// Setup
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = projectSecretKey() ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ============================================================
// Helpers
// ============================================================

async function sha256OfBase64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256OfText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callEdgeFunction(name: string, body: unknown): Promise<{ ok: boolean; data: any; status: number; }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await resp.json();
  } catch (_) {
    data = null;
  }
  return { ok: resp.ok, data, status: resp.status };
}

async function validateSource(slug: string): Promise<{ ok: boolean; err?: string }> {
  const { data, error } = await supabase
    .from("observation_sources")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) return { ok: false, err: `source lookup failed: ${error.message}` };
  if (!data) return { ok: false, err: `unknown source: ${slug} (register in observation_sources first)` };
  return { ok: true };
}

async function logDispatch(row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabase
    .from("artifact_dispatch_log")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    console.warn(`[ingest-artifact] dispatch log insert failed: ${error?.message}`);
    return null;
  }
  return data.id as string;
}

async function findDuplicate(content_sha256: string | null | undefined, kind: string): Promise<any | null> {
  if (!content_sha256) return null;
  const { data } = await supabase
    .from("artifact_dispatch_log")
    .select("id, status, observation_ids, image_id, handler")
    .eq("content_sha256", content_sha256)
    .eq("kind", kind)
    .maybeSingle();
  return data ?? null;
}

async function updateDispatch(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("artifact_dispatch_log")
    .update(patch)
    .eq("id", id);
  if (error) {
    console.warn(`[ingest-artifact] dispatch log update failed: ${error.message}`);
  }
}

// ============================================================
// Kind handlers
// ============================================================

async function handlePhoto(a: PhotoArtifact, dispatchId: string, warnings: string[]): Promise<DispatchResult> {
  // Resolve a content hash if missing
  let sha = a.content_sha256;
  if (!sha && a.image_b64) {
    sha = await sha256OfBase64(a.image_b64);
  }

  // The orchestrator expects an image already in vehicle_images. The
  // contract for the dispatcher is: given raw image input, route it to
  // the orchestrator which will (a) insert vehicle_images if needed and
  // (b) write image_observations + ingest-observation. We pass through.
  const payload: Record<string, unknown> = {
    image_url: a.image_url,
    storage_path: a.storage_path,
    file_hash: sha,
    source: a.source_slug,
    submitted_by: a.submitted_by,
    exif_data: a.exif ?? null,
    taken_at: a.taken_at ?? null,
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
    vehicle_hints: a.vehicle_hints ?? null,
  };

  // photo-pipeline-orchestrator accepts either a known image_id or
  // raw inputs. The orchestrator owns dedup against vehicle_images.
  const { ok, data, status } = await callEdgeFunction("photo-pipeline-orchestrator", payload);

  if (!ok) {
    warnings.push(`photo-pipeline-orchestrator returned ${status}`);
    return {
      ok: false,
      artifact_id: dispatchId,
      status: "error",
      observations_created: [],
      warnings,
      error: data?.error ?? `orchestrator HTTP ${status}`,
    };
  }

  const observationIds: string[] = [];
  if (data?.observation_id) observationIds.push(data.observation_id);
  if (Array.isArray(data?.observations_created)) {
    observationIds.push(...data.observations_created);
  }

  return {
    ok: true,
    artifact_id: dispatchId,
    status: "complete",
    observations_created: observationIds,
    image_id: data?.image_id ?? null,
    confidence_summary: { source: "photo-pipeline-orchestrator", classification: data?.classification ?? null },
    warnings,
  };
}

async function handleVideoFrame(a: VideoFrameArtifact, dispatchId: string, warnings: string[]): Promise<DispatchResult> {
  // Direct passthrough to ingest-video-frame, which handles vehicle_images +
  // image_observations idempotently. We then ALSO emit a kind='media'
  // vehicle_observations row via ingest-observation so the timeline
  // picks it up.
  const frameResp = await callEdgeFunction("ingest-video-frame", {
    content_sha256: a.content_sha256,
    source: a.source_slug,
    image_url: a.image_url,
    storage_path: a.storage_path,
    file_bytes: a.file_bytes,
    source_clip: a.source_clip,
    frame_offset_s: a.frame_offset_s,
    wall_clock_utc: a.wall_clock_utc,
    resolution: a.resolution,
    fps: a.fps,
    youtube_url: a.youtube_url,
    youtube_video_id: a.youtube_video_id,
    inherited_lat: a.inherited_lat,
    inherited_lon: a.inherited_lon,
    inherited_from: a.inherited_from,
    attributed_via: a.attributed_via,
    vehicle_id: a.vehicle_hints?.vehicle_id,
  });

  if (!frameResp.ok) {
    warnings.push(`ingest-video-frame returned ${frameResp.status}`);
    return {
      ok: false,
      artifact_id: dispatchId,
      status: "error",
      observations_created: [],
      warnings,
      error: frameResp.data?.error ?? `video-frame HTTP ${frameResp.status}`,
    };
  }

  const observationIds: string[] = [];

  // Emit timeline observation only if attributed (we have a vehicle_id)
  if (a.vehicle_hints?.vehicle_id) {
    const obsResp = await callEdgeFunction("ingest-observation", {
      source_slug: a.source_slug,
      kind: "media",
      observed_at: a.wall_clock_utc,
      source_url: a.youtube_url ?? a.image_url,
      source_identifier: `video-frame:${a.content_sha256}`,
      content_text: a.notes ?? `Video frame ${a.source_clip} @ ${a.frame_offset_s}s`,
      structured_data: {
        artifact_kind: "video_frame",
        source_clip: a.source_clip,
        frame_offset_s: a.frame_offset_s,
        image_id: frameResp.data?.image_id,
        image_observation_id: frameResp.data?.image_observation_id,
        attributed_via: a.attributed_via,
      },
      vehicle_id: a.vehicle_hints.vehicle_id,
      vehicle_hints: a.vehicle_hints,
      raw_source_ref: a.content_sha256,
    });
    if (obsResp.ok && obsResp.data?.observation_id) {
      observationIds.push(obsResp.data.observation_id);
    } else if (!obsResp.ok) {
      warnings.push(`ingest-observation returned ${obsResp.status} for video_frame`);
    }
  } else {
    warnings.push("video_frame ingested without vehicle attribution; timeline observation deferred to attribution pass");
  }

  return {
    ok: true,
    artifact_id: dispatchId,
    status: "complete",
    observations_created: observationIds,
    image_id: frameResp.data?.image_id ?? null,
    confidence_summary: {
      idempotent_skip: !!frameResp.data?.idempotent_skip,
      attributed: !!a.vehicle_hints?.vehicle_id,
    },
    warnings,
  };
}

async function handleReceipt(a: ReceiptArtifact, dispatchId: string, warnings: string[]): Promise<DispatchResult> {
  // Phase 1 contract: dispatcher records the artifact and emits a
  // placeholder vehicle_observations row of kind='work_record' with the
  // pre-parsed data (if any) in structured_data. Phase 2 will plug
  // deeper attribution (vendor → vehicle, line items → parts intelligence).
  //
  // Integration point for Phase 2:
  //   - The receipt's parsed payload is in artifact_dispatch_log.artifact_payload
  //   - The dispatch log's id is the stable handle Phase 2 attribution can write back against
  //   - Phase 2 should NOT bypass ingest-observation when emitting attributions

  const observedAt = a.parsed?.transaction_date ?? a.submitted_at;
  const merchant = a.parsed?.vendor ?? a.parsed?.merchant_name ?? "unknown_vendor";
  const total = a.parsed?.total;

  const obsResp = await callEdgeFunction("ingest-observation", {
    source_slug: a.source_slug,
    kind: "work_record",
    observed_at: observedAt,
    source_url: a.image_url,
    source_identifier: a.content_sha256 ? `receipt:${a.content_sha256}` : `receipt:dispatch:${dispatchId}`,
    content_text: a.parsed?.raw_text ?? a.notes ?? `Receipt from ${merchant}${total != null ? ` for $${total}` : ""}`,
    structured_data: {
      artifact_kind: "receipt",
      vendor: merchant,
      transaction_date: a.parsed?.transaction_date,
      total: total,
      subtotal: a.parsed?.subtotal,
      tax: a.parsed?.tax,
      line_items: a.parsed?.line_items ?? [],
      payment_method: a.parsed?.payment_method,
      card_last_four: a.parsed?.card_last_four,
      receipt_type: a.parsed?.receipt_type,
      dispatch_id: dispatchId,           // Phase 2 hook: attribution writes back via this
      phase2_pending: true,              // signals downstream that attribution is open
    },
    vehicle_hints: a.vehicle_hints ?? {},
    raw_source_ref: a.content_sha256,
    extraction_method: "ingest-artifact:receipt",
  });

  const observationIds: string[] = [];
  if (obsResp.ok && obsResp.data?.observation_id) {
    observationIds.push(obsResp.data.observation_id);
  } else if (!obsResp.ok) {
    warnings.push(`receipt observation: ingest-observation returned ${obsResp.status}: ${obsResp.data?.error ?? "unknown"}`);
  }

  return {
    ok: obsResp.ok,
    artifact_id: dispatchId,
    status: obsResp.ok ? "complete" : "error",
    observations_created: observationIds,
    confidence_summary: {
      vendor: merchant,
      total: total,
      vehicle_resolved: !!obsResp.data?.vehicle_resolved,
      phase2_pending: true,
    },
    warnings,
  };
}

async function handleBankOrCardTx(
  a: BankTxArtifact | CardTxArtifact,
  dispatchId: string,
  warnings: string[],
): Promise<DispatchResult> {
  // Phase 1: stub. We record the artifact and emit a single work_record
  // observation with structured_data carrying the tx. Phase 2 will plug
  // a real handler that does merchant resolution, vehicle attribution
  // via co-occurrence with receipts/work orders, and personal-vs-business
  // categorization.

  const isCard = a.kind === "card_tx";
  const merchant = isCard ? (a as CardTxArtifact).merchant : (a as BankTxArtifact).description;

  const obsResp = await callEdgeFunction("ingest-observation", {
    source_slug: a.source_slug,
    kind: "work_record",
    observed_at: a.date,
    source_identifier: a.content_sha256
      ? `${a.kind}:${a.content_sha256}`
      : `${a.kind}:dispatch:${dispatchId}`,
    content_text: `${isCard ? "Card" : "Bank"} tx: ${merchant} ${a.amount < 0 ? "" : "+"}${a.amount}`,
    structured_data: {
      artifact_kind: a.kind,
      date: a.date,
      amount: a.amount,
      merchant,
      account: isCard ? `card:${(a as CardTxArtifact).last4}` : (a as BankTxArtifact).account,
      raw: a.raw ?? null,
      dispatch_id: dispatchId,
      phase2_pending: true,
    },
    vehicle_hints: a.vehicle_hints ?? {},
    raw_source_ref: a.content_sha256,
    extraction_method: `ingest-artifact:${a.kind}`,
  });

  const observationIds: string[] = [];
  if (obsResp.ok && obsResp.data?.observation_id) observationIds.push(obsResp.data.observation_id);

  warnings.push(`${a.kind} handler is Phase-2 pending (kind_handler_pending). Observation emitted as placeholder.`);

  return {
    ok: obsResp.ok,
    artifact_id: dispatchId,
    status: obsResp.ok ? "kind_handler_pending" : "error",
    observations_created: observationIds,
    confidence_summary: {
      kind_handler_pending: true,
      merchant,
      amount: a.amount,
    },
    warnings,
  };
}

async function handleWorkOrder(a: WorkOrderArtifact, dispatchId: string, warnings: string[]): Promise<DispatchResult> {
  const obsResp = await callEdgeFunction("ingest-observation", {
    source_slug: a.source_slug,
    kind: "work_record",
    observed_at: a.date,
    source_identifier: a.content_sha256
      ? `work_order:${a.content_sha256}`
      : `work_order:dispatch:${dispatchId}`,
    content_text: a.description ?? `Work order from ${a.vendor ?? "unknown"} on ${a.date}`,
    structured_data: {
      artifact_kind: "work_order",
      vendor: a.vendor,
      date: a.date,
      total: a.total,
      line_items: a.line_items ?? [],
      raw: a.raw ?? null,
      dispatch_id: dispatchId,
    },
    vehicle_hints: a.vehicle_hint,
    raw_source_ref: a.content_sha256,
    extraction_method: "ingest-artifact:work_order",
  });

  const observationIds: string[] = [];
  if (obsResp.ok && obsResp.data?.observation_id) observationIds.push(obsResp.data.observation_id);
  else if (!obsResp.ok) warnings.push(`work_order observation: ingest-observation returned ${obsResp.status}`);

  return {
    ok: obsResp.ok,
    artifact_id: dispatchId,
    status: obsResp.ok ? "complete" : "error",
    observations_created: observationIds,
    confidence_summary: {
      vehicle_resolved: !!obsResp.data?.vehicle_resolved,
      vendor: a.vendor,
      total: a.total,
    },
    warnings,
  };
}

async function handleDocument(a: DocumentArtifact, dispatchId: string, warnings: string[]): Promise<DispatchResult> {
  const docType = a.document_type ?? "document";
  // 'document' is not an observation_kind enum value; map to provenance
  // (titles, build sheets, manuals are provenance/specification claims).
  // The kind is determined by what the document attests to. Default to
  // 'provenance' for ownership-bearing docs, 'specification' for build
  // sheets/manuals.
  const kind = (docType === "manual_page" || docType === "build_sheet" || docType === "spec_sheet")
    ? "specification"
    : "provenance";

  const obsResp = await callEdgeFunction("ingest-observation", {
    source_slug: a.source_slug,
    kind,
    observed_at: a.submitted_at,
    source_url: a.image_url,
    source_identifier: a.content_sha256
      ? `document:${a.content_sha256}`
      : `document:dispatch:${dispatchId}`,
    content_text: a.text ?? a.notes ?? `Document (${docType})`,
    structured_data: {
      artifact_kind: "document",
      document_type: docType,
      storage_path: a.storage_path,
      image_url: a.image_url,
      dispatch_id: dispatchId,
    },
    vehicle_hints: a.vehicle_hints ?? {},
    raw_source_ref: a.content_sha256,
    extraction_method: "ingest-artifact:document",
  });

  const observationIds: string[] = [];
  if (obsResp.ok && obsResp.data?.observation_id) observationIds.push(obsResp.data.observation_id);
  else if (!obsResp.ok) warnings.push(`document observation: ingest-observation returned ${obsResp.status}`);

  return {
    ok: obsResp.ok,
    artifact_id: dispatchId,
    status: obsResp.ok ? "complete" : "error",
    observations_created: observationIds,
    confidence_summary: { document_type: docType, kind },
    warnings,
  };
}

// ============================================================
// Server
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...corsHeaders,
      "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type,x-api-key" } });
  }
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 15 * 1024 * 1024) return jsonResponse({ error: "Request too large" }, 413);

  const warnings: string[] = [];
  let parsed: ArtifactInput;
  try {
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 15 * 1024 * 1024) {
          await reader.cancel();
          return jsonResponse({ error: "Request too large" }, 413);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected an object" }, 400);
  } catch (e: any) {
    return jsonResponse({ ok: false, error: `invalid JSON: ${e.message}` } as DispatchResult, 400);
  }

  if ((parsed as unknown as Record<string, unknown>).mode === RECEIPT_MODE) {
    return handleReceiptIntake(req, parsed as unknown as Record<string, unknown>, supabase);
  }
  // Recovered legacy dispatcher uses privileged downstream calls. It is an
  // internal transport, not an alternate way around delegated receipt grants.
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  const writer = await authenticateWriter(req);
  if (!writer.ok || writer.caller.kind !== "service_role") return jsonResponse({ error: "Legacy dispatch requires internal service authentication" }, 403);

  // Common validation
  if (!parsed.source_slug || !parsed.kind || !parsed.submitted_at) {
    return jsonResponse({
      ok: false,
      artifact_id: null,
      status: "error",
      observations_created: [],
      warnings: [],
      error: "Missing required fields: source_slug, submitted_at, kind",
    } as DispatchResult, 400);
  }

  const sourceCheck = await validateSource(parsed.source_slug);
  if (!sourceCheck.ok) {
    return jsonResponse({
      ok: false,
      artifact_id: null,
      status: "error",
      observations_created: [],
      warnings: [],
      error: sourceCheck.err,
    } as DispatchResult, 400);
  }

  // Compute or accept content_sha256
  let sha = parsed.content_sha256;
  if (!sha) {
    if (parsed.kind === "photo" && (parsed as PhotoArtifact).image_b64) {
      sha = await sha256OfBase64((parsed as PhotoArtifact).image_b64!);
    } else if (parsed.kind === "bank_tx" || parsed.kind === "card_tx") {
      // Synthetic hash for tx rows — date+amount+merchant+account
      const a = parsed as BankTxArtifact | CardTxArtifact;
      const merchant = a.kind === "card_tx" ? (a as CardTxArtifact).merchant : (a as BankTxArtifact).description;
      const account = a.kind === "card_tx" ? (a as CardTxArtifact).last4 : (a as BankTxArtifact).account;
      sha = await sha256OfText(`${a.kind}|${a.date}|${a.amount}|${merchant}|${account}`);
    } else if (parsed.kind === "receipt" && (parsed as ReceiptArtifact).image_b64) {
      sha = await sha256OfBase64((parsed as ReceiptArtifact).image_b64!);
    }
  }

  // Idempotency
  const existing = await findDuplicate(sha, parsed.kind);
  if (existing) {
    return jsonResponse({
      ok: true,
      artifact_id: existing.id,
      status: "duplicate",
      observations_created: existing.observation_ids ?? [],
      image_id: existing.image_id ?? null,
      duplicate: true,
      warnings: [`Artifact already dispatched (status=${existing.status}, handler=${existing.handler})`],
    } as DispatchResult);
  }

  // Build the redacted payload (no raw bytes)
  const payloadForLog = sanitizePayload(parsed);

  const dispatchId = await logDispatch({
    content_sha256: sha,
    kind: parsed.kind,
    source_slug: parsed.source_slug,
    submitted_at: parsed.submitted_at,
    submitted_by: parsed.submitted_by ?? null,
    status: "received",
    artifact_payload: payloadForLog,
  });

  if (!dispatchId) {
    return jsonResponse({
      ok: false,
      artifact_id: null,
      status: "error",
      observations_created: [],
      warnings,
      error: "failed to record dispatch (artifact_dispatch_log insert failed)",
    } as DispatchResult, 500);
  }

  // Route
  let result: DispatchResult;
  try {
    switch (parsed.kind) {
      case "photo":
        result = await handlePhoto(parsed as PhotoArtifact, dispatchId, warnings);
        break;
      case "video_frame":
        result = await handleVideoFrame(parsed as VideoFrameArtifact, dispatchId, warnings);
        break;
      case "receipt":
        result = await handleReceipt(parsed as ReceiptArtifact, dispatchId, warnings);
        break;
      case "bank_tx":
      case "card_tx":
        result = await handleBankOrCardTx(parsed as BankTxArtifact | CardTxArtifact, dispatchId, warnings);
        break;
      case "work_order":
        result = await handleWorkOrder(parsed as WorkOrderArtifact, dispatchId, warnings);
        break;
      case "document":
        result = await handleDocument(parsed as DocumentArtifact, dispatchId, warnings);
        break;
      default:
        result = {
          ok: false,
          artifact_id: dispatchId,
          status: "error",
          observations_created: [],
          warnings,
          error: `Unknown artifact kind: ${(parsed as any).kind}`,
        };
    }
  } catch (e: any) {
    result = {
      ok: false,
      artifact_id: dispatchId,
      status: "error",
      observations_created: [],
      warnings,
      error: `handler threw: ${e.message ?? String(e)}`,
    };
  }

  // Persist outcome
  await updateDispatch(dispatchId, {
    handler: kindToHandler(parsed.kind),
    status: result.status,
    error_message: result.error ?? null,
    warnings: result.warnings,
    observation_ids: result.observations_created,
    image_id: result.image_id ?? null,
    routed_at: new Date().toISOString(),
    completed_at: (result.status === "complete" || result.status === "kind_handler_pending")
      ? new Date().toISOString()
      : null,
  });

  return jsonResponse(result, result.ok ? 200 : 500);
});

function kindToHandler(kind: string): string {
  switch (kind) {
    case "photo": return "photo-pipeline-orchestrator";
    case "video_frame": return "ingest-video-frame";
    case "receipt": return "ingest-artifact:receipt+ingest-observation";
    case "bank_tx":
    case "card_tx": return "ingest-artifact:tx-stub+ingest-observation";
    case "work_order": return "ingest-artifact:work_order+ingest-observation";
    case "document": return "ingest-artifact:document+ingest-observation";
    default: return "unknown";
  }
}

function sanitizePayload(input: ArtifactInput): Record<string, unknown> {
  // Drop raw bytes; keep everything else for audit
  const copy: Record<string, unknown> = { ...(input as any) };
  delete copy.image_b64;
  if (copy.parsed && typeof copy.parsed === "object") {
    const parsed = { ...(copy.parsed as Record<string, unknown>) };
    if (typeof parsed.raw_text === "string" && (parsed.raw_text as string).length > 4000) {
      parsed.raw_text = (parsed.raw_text as string).slice(0, 4000) + "...[truncated]";
    }
    copy.parsed = parsed;
  }
  return copy;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
