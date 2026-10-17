// Revision queue helpers for intake writers (import_queue revision_* columns, migration 20261015120000_revision_queue.sql).
//   recordRevision   a lot that did not land whole is recorded with what is missing, why and the next action, instead of a bare 'failed'
//   reviseRetained   claims reparse_retained items and re-runs the current parser on the retained capture (no Firecrawl, no fetch)
// A failed write here never stops the run: it is logged and returned as text.

type Client = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: any; error?: { message: string } | null }> };

export interface RevisionInput {
  url: string;
  missing: string[];
  reason: string;
  next: string;
  raisedBy: string;
  snapshotId?: string | null;
  detail?: Record<string, unknown>;
  vehicleId?: string | null;
}

export async function recordRevision(supabase: Client, r: RevisionInput): Promise<string | null> {
  const { error } = await supabase.rpc("record_revision_item", {
    p_url: r.url, p_missing: r.missing, p_reason: r.reason, p_next_action: r.next, p_raised_by: r.raisedBy,
    p_snapshot_id: r.snapshotId ?? null, p_detail: r.detail ?? {}, p_vehicle_id: r.vehicleId ?? null,
  });
  if (error) { console.error(`record_revision_item failed: ${error.message}`); return error.message; }
  return null;
}

/** Map a failure message to the queue's reason and next action. */
export function classifyFailure(msg: string): { reason: string; next: string } {
  if (/\b(403|429)\b|rate limit/i.test(msg)) return { reason: /429|rate limit/i.test(msg) ? "rate_limited" : "blocked", next: "wait" };
  if (/\b402\b|credit|billing/i.test(msg)) return { reason: "billing", next: "wait" };
  if (/timed? ?out|timeout|aborted/i.test(msg)) return { reason: "timeout", next: "retry" };
  if (/duplicate key|unique constraint/i.test(msg)) return { reason: "duplicate_key", next: "relink" };
  if (/quality gate/i.test(msg)) return { reason: "quality_gate", next: "reparse_retained" };
  if (/insufficient html|no html|missing required|could not extract|parse/i.test(msg)) return { reason: "parser_gap", next: "reparse_retained" };
  if (/not.found|404|410/i.test(msg)) return { reason: "not_found", next: "none" };
  return { reason: "other", next: "retry" };
}

export interface ReviseResult { ok: boolean; whole?: boolean; nonVehicle?: boolean; noCapture?: boolean; detail?: Record<string, unknown> }

export async function reviseRetained(
  supabase: Client,
  opts: { sourceName: string; worker: string; limit: number; reparse: (item: { id: string; listing_url: string; snapshot_id: string | null; vehicle_id: string | null }) => Promise<ReviseResult> },
) {
  const { data: items, error } = await supabase.rpc("claim_revision_items", {
    p_source_slug: opts.sourceName, p_worker: opts.worker, p_limit: Math.min(Math.max(opts.limit, 1), 25), p_actions: ["reparse_retained"],
  });
  if (error) return { success: false, error: error.message };
  const out = { claimed: (items ?? []).length, landed_whole: 0, non_vehicle: 0, released: 0, no_capture: 0, errors: [] as string[] };
  for (const it of items ?? []) {
    let res: ReviseResult;
    try { res = await opts.reparse(it); } catch (e) { res = { ok: false, detail: { error: String((e as Error)?.message ?? e).slice(0, 300) } }; }
    if (res.ok && res.whole) {
      await supabase.rpc("resolve_revision_item", { p_id: it.id, p_outcome: "landed_whole", p_detail: res.detail ?? {} }); out.landed_whole++;
    } else if (res.nonVehicle) {
      await supabase.rpc("resolve_revision_item", { p_id: it.id, p_outcome: "non_vehicle", p_detail: res.detail ?? {} }); out.non_vehicle++;
    } else if (res.noCapture) {
      // Nothing retained to re-read: the lot needs a fetch (a paid one for Cars & Bids), which this worker never does.
      await supabase.rpc("release_revision_item", { p_id: it.id, p_next_action: "refetch", p_retry_after: "7 days", p_detail: { reparse: "no_retained_capture" } }); out.no_capture++;
    } else {
      await supabase.rpc("release_revision_item", { p_id: it.id, p_next_action: "wait", p_retry_after: "24 hours", p_detail: res.detail ?? {} }); out.released++;
      if (out.errors.length < 5) out.errors.push(`${it.listing_url}: ${JSON.stringify(res.detail ?? {}).slice(0, 160)}`);
    }
  }
  return { success: true, ...out };
}
