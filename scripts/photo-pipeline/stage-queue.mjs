// stage-queue.mjs — the readers' side of the per-image stage ledger (image_stage_work / image_stage_receipts).
//
// A reader asks the database what to read (claim_image_stage_work) instead of keeping its own worklist, and says what
// happened to each photo (record_image_stage_receipt). The receipt closes the work item. Outcomes are typed so that a
// photo whose bytes are gone is not re-selected forever, a reader that timed out is retried later, and a subscription
// that ran out of quota stops the batch instead of failing every remaining photo:
//
//   succeeded      the orchestrator accepted the reading
//   policy_skip    the orchestrator decided the photo is not read (duplicate, non-automotive, junk URL)
//   blocked_input  the photo cannot be fetched (4xx): nothing to retry until the input changes
//   failed         the reading was refused as invalid
//   unavailable    a transient fault (reader timeout, 5xx, network): retry after a pause
//   rate_limited   the reader's compute is exhausted: retry later, and stop this batch
//
// Pure functions plus two thin RPC wrappers; no model, no file system.

export const STAGE = 'classifier';

/** True when the stage ledger is deployed and the reconciler is switched on (platform_config image_stage_reconciler.enabled). */
export async function stageQueueEnabled(rest) {
  try {
    const rows = await rest(`platform_config?select=config_value&config_key=eq.image_stage_reconciler`);
    return rows?.[0]?.config_value?.enabled === true;
  } catch {
    return false;
  }
}

/** Claim up to `limit` photos for a stage. Returns [] when nothing is due or the provider breaker is closed. */
export async function claimStageWork(rpc, { stage = STAGE, limit = 20, leaseSeconds = 900, userId = null } = {}) {
  const rows = await rpc('claim_image_stage_work', { p_stage: stage, p_limit: Math.min(Math.max(limit, 1), 25), p_lease_seconds: leaseSeconds, p_user_id: userId });
  return Array.isArray(rows) ? rows : [];
}

const USAGE_LIMIT = /usage limit|limit reached|rate.?limit|quota|429|overloaded/i;

/**
 * The receipt for one frame.
 *   { download: {status} }                       the image fetch failed with that HTTP status (0 = network)
 *   { reader: {error} }                          `claude -p` failed, timed out, or printed no JSON
 *   { orchestrator: {http, success, skipped, classifier_ok, error_class}, image_type }   the orchestrator answered
 */
export function receiptForResult(result, { reader, promptVersion } = {}) {
  const detail = { reader: reader ?? null, prompt_version: promptVersion ?? null };
  if (result.download) {
    const s = Number(result.download.status) || 0;
    if (s >= 400 && s < 500 && s !== 408 && s !== 425 && s !== 429) {
      return { outcome: 'blocked_input', error_class: 'image_http_error', http_status: s, detail };
    }
    return { outcome: 'unavailable', error_class: s ? 'image_http_error' : 'image_download_error', http_status: s || null, retry_after_seconds: 900, detail };
  }
  if (result.reader) {
    const msg = String(result.reader.error ?? '');
    if (USAGE_LIMIT.test(msg)) return { outcome: 'rate_limited', error_class: 'reader_usage_limit', retry_after_seconds: 3600, stop: true, detail };
    const cls = /timed out/i.test(msg) ? 'reader_timeout' : /no JSON|Unexpected token|JSON/i.test(msg) ? 'reader_output_invalid' : 'reader_exited';
    return { outcome: 'unavailable', error_class: cls, retry_after_seconds: 1800, detail };
  }
  const o = result.orchestrator ?? {};
  const d = { ...detail, image_type: result.image_type ?? null, orchestrator_http: o.http ?? null };
  if (o.http === 200 && o.skipped) return { outcome: 'policy_skip', detail: { ...d, skipped: String(o.skipped) } };
  if (o.http === 200 && o.success !== false) return { outcome: 'succeeded', detail: d };
  if (o.classifier_ok === false || /^classifier_response_/.test(String(o.error_class ?? ''))) {
    return { outcome: 'failed', error_class: String(o.error_class || 'classifier_response_invalid'), http_status: o.http ?? null, detail: d };
  }
  if (o.http === 429) return { outcome: 'rate_limited', error_class: 'orchestrator_rate_limited', http_status: 429, retry_after_seconds: 900, detail: d };
  return { outcome: 'unavailable', error_class: String(o.error_class || 'orchestrator_http_error'), http_status: o.http ?? null, retry_after_seconds: 900, detail: d };
}

/** Write the receipt (closes the open work item). Never throws: a reader must not lose a batch to its bookkeeping. */
export async function recordStageReceipt(rpc, { imageId, stage = STAGE, version, receipt }) {
  try {
    const id = await rpc('record_image_stage_receipt', {
      p_image_id: imageId, p_stage: stage, p_producer_version: version, p_outcome: receipt.outcome,
      p_error_class: receipt.error_class ?? null, p_http_status: receipt.http_status ?? null,
      p_retry_after_seconds: receipt.retry_after_seconds ?? null, p_input_fingerprint: null, p_detail: receipt.detail ?? {},
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}
