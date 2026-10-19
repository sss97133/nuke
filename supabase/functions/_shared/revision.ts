// Record a lot that did not land whole as a revision item (lane-depth's queue on import_queue, #1430), never as a failure.
// Non-fatal: a queue hiccup must not turn a landing into an error. Vocabulary is the queue's own (record_revision_item).
export type RevisionReason = 'parser_gap' | 'blocked' | 'rate_limited' | 'billing' | 'timeout' | 'lock_timeout' | 'duplicate_key'
  | 'quality_gate' | 'bad_data' | 'not_found' | 'thin_landing' | 'unlinked_capture' | 'other';
export type RevisionAction = 'reparse_retained' | 'refetch' | 'relink' | 'classify_non_vehicle' | 'retry' | 'wait' | 'none';

export async function recordRevision(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> },
  item: { url: string; missing: string[]; reason: RevisionReason; next_action: RevisionAction; raised_by: string; vehicle_id?: string | null; snapshot_id?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_revision_item', {
      p_url: item.url, p_missing: item.missing, p_reason: item.reason, p_next_action: item.next_action, p_raised_by: item.raised_by,
      p_snapshot_id: item.snapshot_id ?? null, p_detail: item.detail ?? {}, p_vehicle_id: item.vehicle_id ?? null,
    });
    if (error) console.warn(`[revision] ${item.url}: ${error.message}`);
  } catch (e) {
    console.warn(`[revision] ${item.url}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
