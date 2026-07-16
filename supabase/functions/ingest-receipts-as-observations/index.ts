/**
 * INGEST RECEIPTS AS OBSERVATIONS (WS-3)
 *
 * Bridge: receipts table (2,420 rows of OCR'd receipts) → vehicle_observations
 * via the canonical ingest-observation single-write-path.
 *
 * Per `.claude/rules/extraction.md`: ALL data flows through ingest-observation.
 * This function does NOT direct-insert into vehicle_observations — it POSTs
 * each receipt to ingest-observation and records the returned observation_id
 * back on the receipts row.
 *
 * Per `.claude/rules/agent-trust-invariants.md`: testimony is permanent.
 * We only ADD `submitted_observation_id` / `submitted_at` columns to receipts;
 * we never delete a receipt or overwrite its content.
 *
 * Kind selection (observation_kind enum has no `expense`):
 *   - work_record  → receipts with line items mentioning parts, labor, services
 *   - specification → insurance/registration/title docs (vehicle identity attestations)
 *   - comment      → catch-all for ambiguous receipts (still attached to vehicle)
 *
 * POST /functions/v1/ingest-receipts-as-observations
 *   { batch_size: 200, dry_run: false, vehicle_id?: "uuid", receipt_id?: "uuid" }
 *
 * Returns:
 *   { processed, skipped, errors, kind_breakdown, sample_observation_ids }
 *
 * Registered in TOOLS.md under "External Agent Write API".
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface ReceiptRow {
  id: string;
  vehicle_id: string;
  vendor_name: string | null;
  vendor_address: string | null;
  transaction_date: string | null;
  receipt_date: string | null;
  purchase_date: string | null;
  upload_date: string | null;
  total: number | null;
  total_amount: number | null;
  subtotal: number | null;
  tax: number | null;
  tax_amount: number | null;
  currency: string | null;
  invoice_number: string | null;
  payment_method: string | null;
  card_last4: string | null;
  part_number: string | null;
  file_name: string | null;
  file_url: string | null;
  raw_extraction: Record<string, unknown> | null;
  raw_json: Record<string, unknown> | null;
  submitted_observation_id: string | null;
}

interface BridgeRequest {
  batch_size?: number;
  dry_run?: boolean;
  vehicle_id?: string;
  receipt_id?: string;
}

interface BridgeResponse {
  processed: number;
  skipped: number;
  errors: number;
  duplicates: number;
  kind_breakdown: Record<string, number>;
  remaining_pending: number;
  sample_observation_ids: string[];
  error_samples: Array<{ receipt_id: string; reason: string }>;
}

// ─── Kind classification ────────────────────────────────────────

const PARTS_KEYWORDS = [
  "part", "parts", "filter", "oil", "brake", "tire", "battery",
  "spark plug", "hose", "belt", "gasket", "bearing", "seal",
  "wheel", "axle", "transmission", "engine", "alternator",
  "starter", "fuel", "exhaust", "muffler", "catalytic", "radiator",
  "coolant", "shock", "strut", "pad", "rotor", "caliper", "bushing",
  "ball joint", "tie rod", "wire", "harness", "connector", "fitting",
  "bolt", "nut", "screw", "washer", "clip", "pump", "valve", "sensor",
];

const LABOR_KEYWORDS = [
  "labor", "service", "install", "repair", "diagnose", "diagnostic",
  "tune up", "tune-up", "alignment", "rotate", "balance", "mount",
  "inspection", "smog", "emissions", "hours", "shop fee",
];

const DOC_KEYWORDS = [
  "insurance", "policy", "premium", "coverage", "registration",
  "title", "dmv", "license plate", "smog cert", "tag",
];

const VENDOR_PARTS_HINTS = [
  "autozone", "napa", "o'reilly", "advance auto", "summit racing",
  "rock auto", "rockauto", "pep boys", "carquest", "jegs",
];

const VENDOR_DOC_HINTS = [
  "bristol west", "geico", "progressive", "state farm", "allstate",
  "farmers insurance", "dmv", "department of motor",
];

function classifyKind(r: ReceiptRow): "work_record" | "specification" | "comment" {
  const haystack = [
    r.vendor_name ?? "",
    JSON.stringify(r.raw_extraction ?? r.raw_json ?? {}),
  ].join(" ").toLowerCase();

  // Doc-type first (insurance/registration even if vendor sells parts)
  if (DOC_KEYWORDS.some(k => haystack.includes(k))) return "specification";
  if (VENDOR_DOC_HINTS.some(v => (r.vendor_name ?? "").toLowerCase().includes(v))) {
    return "specification";
  }

  // Parts/labor receipts
  if (VENDOR_PARTS_HINTS.some(v => (r.vendor_name ?? "").toLowerCase().includes(v))) {
    return "work_record";
  }
  if (PARTS_KEYWORDS.some(k => haystack.includes(k))) return "work_record";
  if (LABOR_KEYWORDS.some(k => haystack.includes(k))) return "work_record";

  // Default: still a vehicle-attributed receipt — surface as comment so it
  // shows on the timeline rather than being silently dropped.
  return "comment";
}

// ─── Payload assembly ──────────────────────────────────────────

function pickDate(r: ReceiptRow): string {
  // Prefer transaction_date (when the money moved), fall back through dates.
  const candidate =
    r.transaction_date ?? r.receipt_date ?? r.purchase_date ?? r.upload_date;
  if (candidate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      return `${candidate}T12:00:00Z`;
    }
    return candidate;
  }
  return new Date().toISOString();
}

function summarizeReceipt(r: ReceiptRow): string {
  const parts: string[] = [];
  if (r.vendor_name) parts.push(r.vendor_name);
  const total = r.total ?? r.total_amount;
  if (total != null) parts.push(`$${Number(total).toFixed(2)}${r.currency ? ` ${r.currency}` : ""}`);
  const date = r.transaction_date ?? r.receipt_date ?? r.purchase_date;
  if (date) parts.push(date);

  const raw = (r.raw_extraction ?? r.raw_json ?? {}) as Record<string, any>;
  const dataV2 = raw?.data_v2 as Record<string, any> | undefined;
  const data = raw?.data as Record<string, any> | undefined;
  const purpose = dataV2?.business_purpose ?? data?.notes;
  if (purpose && typeof purpose === "string") parts.push(purpose);

  return parts.join(" — ");
}

function buildStructuredData(r: ReceiptRow): Record<string, unknown> {
  const raw = (r.raw_extraction ?? r.raw_json ?? {}) as Record<string, any>;
  const dataV2 = raw?.data_v2 as Record<string, any> | undefined;
  const data = raw?.data as Record<string, any> | undefined;

  return {
    receipt_id: r.id,
    merchant: r.vendor_name,
    merchant_address: r.vendor_address,
    transaction_date: r.transaction_date,
    total: r.total ?? r.total_amount,
    subtotal: r.subtotal,
    tax: r.tax ?? r.tax_amount,
    currency: r.currency ?? "USD",
    invoice_number: r.invoice_number,
    payment_method: r.payment_method,
    card_last4: r.card_last4,
    part_number: r.part_number,
    line_items: dataV2?.line_items ?? data?.line_items ?? [],
    receipt_type: dataV2?.receipt_type ?? data?.receipt_type ?? null,
    vehicle_hint: dataV2?.vehicle_hint ?? data?.vehicle_hint ?? null,
    business_purpose: dataV2?.business_purpose ?? null,
    file_name: r.file_name,
    file_url: r.file_url,
    extraction_method: dataV2?._method ?? raw?.engine ?? null,
    extracted_at: dataV2?._extracted_at ?? raw?.extracted_at ?? null,
    extraction_model: dataV2?._model ?? null,
  };
}

// ─── Main handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  const body: BridgeRequest = await req.json().catch(() => ({}));
  const batchSize = Math.min(Math.max(body.batch_size ?? 200, 1), 500);
  const dryRun = body.dry_run ?? false;

  // Fetch a batch of unsubmitted receipts with vehicle attribution.
  let query = supabase
    .from("receipts")
    .select(
      [
        "id", "vehicle_id", "vendor_name", "vendor_address",
        "transaction_date", "receipt_date", "purchase_date", "upload_date",
        "total", "total_amount", "subtotal", "tax", "tax_amount",
        "currency", "invoice_number", "payment_method", "card_last4",
        "part_number", "file_name", "file_url",
        "raw_extraction", "raw_json", "submitted_observation_id",
      ].join(",")
    )
    .is("submitted_observation_id", null)
    .not("vehicle_id", "is", null)
    .limit(batchSize);

  if (body.receipt_id) query = query.eq("id", body.receipt_id);
  if (body.vehicle_id) query = query.eq("vehicle_id", body.vehicle_id);

  const { data: receipts, error: fetchError } = await query;
  if (fetchError) {
    return new Response(JSON.stringify({ error: "fetch_failed", details: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const result: BridgeResponse = {
    processed: 0,
    skipped: 0,
    errors: 0,
    duplicates: 0,
    kind_breakdown: {},
    remaining_pending: 0,
    sample_observation_ids: [],
    error_samples: [],
  };

  for (const r of (receipts ?? []) as ReceiptRow[]) {
    try {
      const kind = classifyKind(r);
      const observedAt = pickDate(r);
      const summary = summarizeReceipt(r);
      const structured = buildStructuredData(r);

      result.kind_breakdown[kind] = (result.kind_breakdown[kind] ?? 0) + 1;

      if (dryRun) {
        result.processed++;
        continue;
      }

      const ingestRes = await fetch(`${supabaseUrl}/functions/v1/ingest-observation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          source_slug: "receipt-scan",
          kind,
          observed_at: observedAt,
          vehicle_id: r.vehicle_id, // already attributed
          source_identifier: `receipt:${r.id}`,
          source_url: r.file_url ?? undefined,
          content_text: summary,
          structured_data: structured,
          extraction_method: "receipt-ocr-bridge",
          raw_source_ref: `receipts.${r.id}`,
          extraction_metadata: {
            bridge: "ingest-receipts-as-observations",
            bridge_version: "1.0.0",
          },
        }),
      });

      const ingestJson = await ingestRes.json().catch(() => ({}));
      if (!ingestRes.ok || !ingestJson.success) {
        result.errors++;
        if (result.error_samples.length < 5) {
          result.error_samples.push({
            receipt_id: r.id,
            reason: ingestJson.error ?? `HTTP ${ingestRes.status}`,
          });
        }
        continue;
      }

      const observationId = ingestJson.observation_id as string;

      // Mark the receipt as submitted (idempotent re-runs are safe).
      const { error: markErr } = await supabase
        .from("receipts")
        .update({
          submitted_observation_id: observationId,
          submitted_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      if (markErr) {
        result.errors++;
        if (result.error_samples.length < 5) {
          result.error_samples.push({ receipt_id: r.id, reason: `mark_failed: ${markErr.message}` });
        }
        continue;
      }

      if (ingestJson.duplicate) result.duplicates++;
      result.processed++;
      if (result.sample_observation_ids.length < 5) {
        result.sample_observation_ids.push(observationId);
      }
    } catch (e: any) {
      result.errors++;
      if (result.error_samples.length < 5) {
        result.error_samples.push({ receipt_id: r.id, reason: e.message ?? String(e) });
      }
    }
  }

  // Tail check — how many still pending after this batch
  const { count: remaining } = await supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .is("submitted_observation_id", null)
    .not("vehicle_id", "is", null);
  result.remaining_pending = remaining ?? 0;

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
