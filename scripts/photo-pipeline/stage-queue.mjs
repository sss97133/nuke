// stage-queue.mjs — the readers' side of the per-image stage ledger (image_stage_work / image_stage_receipts).
//
// A reader asks the database what to read (claim_image_stage_work) instead of keeping its own worklist, and says what
// happened to each photo (record_image_stage_receipt). The receipt closes the work item. Outcomes are typed so that a
// photo whose bytes are gone is not re-selected forever, a reader that timed out is retried later, and a subscription
// that ran out of quota stops the batch instead of failing every remaining photo:
//
//   succeeded      the orchestrator accepted the reading
//   policy_skip    the orchestrator decided the photo is not read (duplicate, non-automotive, junk URL)
//   blocked_input  the photo cannot be fetched (4xx) or its bytes are not an image: nothing to retry until the URL changes
//   unavailable    a fault that another try can clear (reader timeout or invalid answer, 5xx, network): retry after a pause
//   rate_limited   the reader's compute is exhausted: retry later, and stop this batch
//
// 'failed' is in the ledger's vocabulary but no reader result maps to it: the ledger never retries a failed receipt, and
// nothing a reader sees is known to be permanent for the photo except missing or undecodable bytes (blocked_input).
//
// Pure functions plus two thin RPC wrappers; no model, no file system.

export const STAGE = 'classifier';
export const DEEP_STAGE = 'deep_reading';
export const KEYED_STAGE = 'keyed_values';
/** Holds a deep reading can recover from; they are receipts a gap rule reopens, never a policy_skip. */
export const TRANSIENT_HOLDS = ['gate_not_approved'];

/**
 * True when this owner's photos are handed out by the stage ledger: the reconciler is switched on (platform_config
 * image_stage_reconciler.enabled, read the way the SQL reads it) and the owner is in its user_ids (no user_ids key =
 * every user). False when the config row is absent (ledger not deployed). An error reading the config is thrown, not
 * answered with false: falling back to the status worklist on a blip would read photos the queue also holds.
 */
export async function stageQueueEnabled(rest, owner) {
  const rows = await rest(`platform_config?select=config_value&config_key=eq.image_stage_reconciler`);
  const cfg = Array.isArray(rows) ? rows[0]?.config_value : null;
  if (!cfg || !(cfg.enabled === true || cfg.enabled === 'true')) return false;
  return Array.isArray(cfg.user_ids) ? cfg.user_ids.includes(owner) : true;
}

/** Claim up to `limit` photos for a stage (at most 25 a call). Returns [] when nothing is due. */
export async function claimStageWork(rpc, { stage = STAGE, limit = 20, leaseSeconds = 900, userId = null } = {}) {
  const rows = await rpc('claim_image_stage_work', { p_stage: stage, p_limit: Math.min(Math.max(limit, 1), 25), p_lease_seconds: leaseSeconds, p_user_id: userId });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Claim up to `limit` photos for a stage over as many calls as it takes (the database hands out at most 25 a call).
 * A database that does not know the stage yet answers an empty list (claim_image_stage_work filters by stage), so a
 * stage that is not deployed is a quiet no-op here; an error is returned as `error`, never thrown, so a fault in one
 * stage cannot cost the fire its other stages.
 */
export async function claimStageWorkUpTo(rpc, { stage, limit, leaseSeconds, userId }) {
  const work = [];
  try {
    while (work.length < limit) {
      const want = Math.min(limit - work.length, 25);
      const rows = await claimStageWork(rpc, { stage, limit: want, leaseSeconds, userId });
      work.push(...rows);
      if (rows.length < want) break;   // a short answer: nothing more is due
    }
  } catch (e) {
    return { work, error: 'claim_failed', detail: String(e?.message || e).slice(0, 160) };
  }
  return { work, error: null };
}

// The subscription's own words for "no compute left" (Claude Code prints "You've hit your 5-hour limit · resets 3pm",
// "You're out of extra usage", earlier "Claude usage limit reached"), plus an API rate-limit or overload error. A bare
// number is not a signal: "JSON at position 429" and "(req 4291)" are not rate limits, and "Context limit reached" is
// about one photo's prompt, not the account.
export const USAGE_LIMIT = /usage limit|(?:hit|reached) your [\w' -]{0,24}limit|(?:5-hour|session|weekly|opus|sonnet) limit reached|out of (?:extra )?usage|rate[ _-]?limit|quota|overloaded|credit balance|(?:http|status|api error)[: ]+(?:429|529)\b/i;
const OUTPUT_INVALID = /no JSON|not valid JSON|in JSON at position|Unexpected (?:token|end)|is not valid JSON/i;
// the API cannot be reached from this machine: the next photo would fail the same way
const API_DOWN = /API Error: (?:5\d\d|Connection|connect|fetch failed|network|socket)|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i;

/** md5 of the image URL: the same value as md5(coalesce(image_url, '')) in image_stage_gaps, which re-offers a blocked photo only when it differs. */
export function inputFingerprint(imageUrl, md5) {
  return md5(String(imageUrl ?? ''));
}

/**
 * The receipt for one frame.
 *   { download: {status} }                       the image fetch failed with that HTTP status (0 = network or body read)
 *   { input: {} }                                the row has no http(s) URL to fetch
 *   { convert: {missingTool} }                   the bytes could not be turned into a JPEG (missingTool: the converter is not installed)
 *   { reader: {error, apiStatus, invalidOutput, missingTool} } `claude -p` failed, timed out, hit a limit, printed no usable JSON, or is not installed
 *   { orchestrator: {http, success, skipped, classification, classifier_ok, error_class}, image_type }   the orchestrator answered
 * `stop: true` means the fault is the batch's, not the photo's: the caller ends the batch.
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
  if (result.convert) {
    // no converter on this machine is the machine's fault, and every non-JPEG photo would fail the same way
    if (result.convert.missingTool) return { outcome: 'unavailable', error_class: 'reader_tool_missing', retry_after_seconds: 3600, stop: true, detail };
    return { outcome: 'blocked_input', error_class: 'image_unreadable', detail };
  }
  // nothing to fetch (the iOS app writes '' when the pixels stay on the phone)
  if (result.input) return { outcome: 'blocked_input', error_class: 'image_url_missing', detail };
  if (result.reader) {
    if (result.reader.missingTool) return { outcome: 'unavailable', error_class: 'reader_tool_missing', retry_after_seconds: 3600, stop: true, detail };
    const msg = String(result.reader.error ?? '');
    const api = Number(result.reader.apiStatus) || 0;
    if (/timed out/i.test(msg)) return { outcome: 'unavailable', error_class: 'reader_timeout', retry_after_seconds: 1800, detail };
    if (result.reader.invalidOutput || OUTPUT_INVALID.test(msg)) return { outcome: 'unavailable', error_class: 'reader_output_invalid', retry_after_seconds: 1800, detail };
    if (api === 429 || api === 529 || USAGE_LIMIT.test(msg)) return { outcome: 'rate_limited', error_class: 'reader_usage_limit', http_status: api || null, retry_after_seconds: 3600, stop: true, detail };
    // a login that stopped working fails every photo the same way
    if (api === 401 || api === 403) return { outcome: 'unavailable', error_class: 'reader_unauthorized', http_status: api, retry_after_seconds: 3600, stop: true, detail };
    if (api >= 500 || API_DOWN.test(msg)) return { outcome: 'unavailable', error_class: 'reader_api_unreachable', http_status: api || null, retry_after_seconds: 1800, stop: true, detail };
    return { outcome: 'unavailable', error_class: 'reader_exited', http_status: api || null, retry_after_seconds: 1800, detail };
  }
  const o = result.orchestrator ?? {};
  const d = { ...detail, image_type: result.image_type ?? null, orchestrator_http: o.http ?? null };
  if (o.http === 200 && o.skipped) {
    // the orchestrator answers {skipped: true, classification: 'junk_url'}: keep the name of the decision, not "true"
    const why = typeof o.skipped === 'string' ? o.skipped : typeof o.classification === 'string' ? o.classification : 'skipped';
    return { outcome: 'policy_skip', detail: { ...d, skipped: why } };
  }
  if (o.http === 200 && o.success !== false) return { outcome: 'succeeded', detail: d };
  if (o.classifier_ok === false || /^classifier_response_/.test(String(o.error_class ?? ''))) {
    // the orchestrator refused this answer; another reading of the same photo can be valid, so it is retried, not retired
    return { outcome: 'unavailable', error_class: String(o.error_class || 'classifier_response_invalid'), http_status: o.http ?? null, retry_after_seconds: 900, detail: d };
  }
  if (o.http === 429) return { outcome: 'rate_limited', error_class: 'orchestrator_rate_limited', http_status: 429, retry_after_seconds: 900, detail: d };
  // the service key was refused: the receipt cannot be written either, and every remaining photo would fail the same way
  if (o.http === 401 || o.http === 403) return { outcome: 'unavailable', error_class: 'orchestrator_unauthorized', http_status: o.http, retry_after_seconds: 900, stop: true, detail: d };
  return { outcome: 'unavailable', error_class: String(o.error_class || 'orchestrator_http_error'), http_status: o.http ?? null, retry_after_seconds: 900, detail: d };
}

/**
 * Write the receipt (closes the open work item). Never throws: a reader must not lose a batch to its bookkeeping. A
 * failed write is tried again (three tries in all): without the receipt the item returns to the queue and is read twice.
 */
export async function recordStageReceipt(rpc, { imageId, stage = STAGE, version, receipt, fingerprint = null, tries = 3, pauseMs = 400 }) {
  let error = '';
  for (let n = 1; n <= Math.max(1, tries); n++) {
    try {
      const id = await rpc('record_image_stage_receipt', {
        p_image_id: imageId, p_stage: stage, p_producer_version: version, p_outcome: receipt.outcome,
        p_error_class: receipt.error_class ?? null, p_http_status: receipt.http_status ?? null,
        p_retry_after_seconds: receipt.retry_after_seconds ?? null, p_input_fingerprint: fingerprint, p_detail: receipt.detail ?? {},
      });
      return { ok: true, id, tries: n };
    } catch (e) {
      error = String(e?.message || e).slice(0, 200);
      if (n < tries && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs * n));
    }
  }
  return { ok: false, error };
}

// ---------------------------------------------------------------------------------------------------------------------
// The deep-reading and keyed-values stages. Same ledger, same receipt vocabulary; the answers differ.

/**
 * The receipt for one photo's deep reading.
 *   { download | input | convert | reader }   the same faults as a first read (receiptForResult); a deep reading that could
 *                                             not get two valid reads of the photo is { reader: { invalidOutput: true } }
 *   { policy: 'document' }                    the row no longer satisfies what the intake requires: no read was spent
 *   { intake: { http, success, error, ... } } the photo-pipeline-orchestrator's answer to record_reviewed_analysis
 * The intake's own words (reviewedAnalysis.ts; the SQL function project_reviewed_image_analysis behind it answers only
 * 'review_projection_refused'): review_requires_service_role 403; invalid_review_envelope|identity|verdict|state|presence|
 * workshop|camera|regions|flags|notes|lists|source|provenance 400 and review_too_large 400; review_source_changed 409;
 * review_source_withdrawn 409; review_projection_refused 409; review_projection_not_persisted 409;
 * review_source_unavailable 503; review_observation_not_persisted 502; review_persistence_failed 500; and the intake
 * guard's two words for an automatic reading, thin_review_over_reviewed 409 and thin_review_asserts_unchecked_field 409.
 */
export function receiptForDeepResult(result, { reader, promptVersion } = {}) {
  const detail = { reader: reader ?? null, prompt_version: promptVersion ?? null, ...(result.detail ?? {}) };
  // a hold that can lift (the approval gate has not passed yet) is a pause, not a retirement: image_stage_gaps never reopens a policy_skip
  if (result.policy && TRANSIENT_HOLDS.includes(result.policy)) return { outcome: 'unavailable', error_class: String(result.policy).slice(0, 48), retry_after_seconds: 3600, detail: { ...detail, held: String(result.policy).slice(0, 60) } };
  // this reader's own reading, made by the same method, is already on the photo and only its receipt is missing (a fire
  // that ended between the post and the receipt): the stage is done, and no read is spent finding that out
  if (result.policy === 'already_read_same_method') return { outcome: 'succeeded', detail: { ...detail, already_read: 'same_method' } };
  if (result.policy) return { outcome: 'policy_skip', detail: { ...detail, skipped: String(result.policy).slice(0, 60) } };
  if (!result.intake) {
    const r = receiptForResult(result, { reader, promptVersion });
    return { ...r, detail: { ...r.detail, ...(result.detail ?? {}) } };
  }
  const o = result.intake;
  const code = String(o.error ?? o.error_class ?? '');
  const d = { ...detail, intake_http: o.http ?? null, ...(code ? { intake_error: code.slice(0, 60) } : {}) };
  if (o.http === 200 && o.success !== false) {
    return { outcome: 'succeeded', detail: { ...d, ...(typeof o.observation_id === 'string' ? { observation_id: o.observation_id } : {}) } };
  }
  // withdrawn once before: permanent for this photo
  if (code === 'review_source_previously_withdrawn') return { outcome: 'policy_skip', detail: { ...d, skipped: code } };
  // the photo left the eligible set between the claim and the post (gate flipped, flagged, replaced). The next claim re-checks
  // the row before any read: a photo that is still held becomes a policy_skip there at no cost, one that was only waiting is read.
  if (code === 'review_source_withdrawn') return { outcome: 'unavailable', error_class: code, http_status: o.http ?? null, retry_after_seconds: 3600, detail: d };
  // the photo moved while it was being read: the next claim reads the current row again, so a short retry
  if (['review_source_changed', 'review_source_changed_during_projection', 'review_projection_not_persisted'].includes(code)) {
    return { outcome: 'unavailable', error_class: code, http_status: o.http ?? null, retry_after_seconds: 120, detail: d };
  }
  // the database refused to place a valid reading on this photo (SQL-side rules the reader cannot see, e.g. a withdrawal on
  // record). Each attempt spends two reads, so wait an hour between attempts rather than two minutes.
  if (code === 'review_projection_refused') return { outcome: 'unavailable', error_class: code, http_status: o.http ?? null, retry_after_seconds: 3600, detail: d };
  // the database's own words for an automatic reading it will not store (guard_reviewed_image_analysis, migration
  // 20261120140000), passed on by the orchestrator. A reading that is not this reader's already stands on the photo
  // (a reviewed landing won the race, or one the reader's own check could not see): the photo is read, by someone better.
  if (code === 'thin_review_over_reviewed') return { outcome: 'policy_skip', detail: { ...d, skipped: 'already_read' } };
  // the reading is not the shape the database takes from this reader: a reader fault that repeats on every photo and
  // spends two reads each time, so the stage stops for the fire at once and the fire's summary carries the word
  if (code === 'thin_review_asserts_unchecked_field') return { outcome: 'unavailable', error_class: 'thin_shape_refused', http_status: o.http ?? null, retry_after_seconds: 3600, stop: true, detail: d };
  // the observation was not written: the ingest failed, or (from an orchestrator that does not pass the words above on)
  // the database's rule for this reader's tier refused the row. The second repeats on every attempt and each
  // attempt spends two reads, so an hour between attempts. Nothing ends the retries for good (the gap finder offers a
  // photo again a day after its last allowed attempt); what bounds the cost is the reader stopping the stage for the
  // fire after REFUSAL_STREAK_STOP refusals in a row (deep-stage.mjs), and "intake_refusing" in the fire's summary.
  if (code === 'review_observation_not_persisted') return { outcome: 'unavailable', error_class: code, http_status: o.http ?? null, retry_after_seconds: 3600, detail: d };
  // the contract refused this answer: another reading of the photo can be valid
  if (/^invalid_review_/.test(code) || code === 'review_too_large') {
    return { outcome: 'unavailable', error_class: 'reader_output_invalid', http_status: o.http ?? null, retry_after_seconds: 1800, detail: d };
  }
  if (o.http === 429) return { outcome: 'rate_limited', error_class: 'orchestrator_rate_limited', http_status: 429, retry_after_seconds: 900, detail: d };
  if (o.http === 401 || o.http === 403 || code === 'review_requires_service_role') {
    return { outcome: 'unavailable', error_class: 'orchestrator_unauthorized', http_status: o.http ?? null, retry_after_seconds: 900, stop: true, detail: d };
  }
  return { outcome: 'unavailable', error_class: code ? code.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48) : 'orchestrator_http_error', http_status: o.http ?? null, retry_after_seconds: 900, detail: d };
}

/**
 * The receipt for one photo's keyed values: the receipt projectCachedRun returned for exactly that photo, or the fault
 * that kept it from running.
 *   { projection: receipt }   succeeded with the number of values written (or already there), or policy_skip with the
 *                             projection's own deferral reason (receipt_document, no_known_scalar_values, source_requires_review ...)
 *   { error: 'text' }         the projection could not run: retried later
 */
export function receiptForKeyedResult(result, { reader, promptVersion } = {}) {
  const detail = { reader: reader ?? null, prompt_version: promptVersion ?? null };
  if (result.error) return { outcome: 'unavailable', error_class: 'projection_error', retry_after_seconds: 900, detail: { ...detail, error: String(result.error).slice(0, 160) } };
  const p = result.projection ?? {};
  const deferred = p.deferred && typeof p.deferred === 'object' ? p.deferred : {};
  const counts = { values: (p.inserted || 0) + (p.duplicates || 0), inserted: p.inserted || 0, duplicates: p.duplicates || 0, already_projected: p.already_projected || 0 };
  if (p.failed > 0 || p.reason) {
    return { outcome: 'unavailable', error_class: 'projection_failed', retry_after_seconds: 900, detail: { ...detail, ...counts, reason: String(p.reason || 'ingest_failed').slice(0, 60) } };
  }
  if (counts.values > 0) return { outcome: 'succeeded', detail: { ...detail, ...counts, deferred } };
  // the photo already carries every value its reading yields (landed by hand, or by an earlier fire whose receipt was lost)
  if (counts.already_projected > 0) return { outcome: 'succeeded', detail: { ...detail, ...counts, values: counts.already_projected, already_there: true, deferred } };
  if (!p.source_rows) return { outcome: 'unavailable', error_class: 'reading_not_found', retry_after_seconds: 900, detail: { ...detail, ...counts } };
  // a check that could not be asked is not a decision about the photo: try again
  if (deferred.privacy_check_unavailable > 0) return { outcome: 'unavailable', error_class: 'privacy_check_unavailable', retry_after_seconds: 900, detail: { ...detail, ...counts, deferred } };
  // nothing is written for this photo, and the projection said why (its own words, most frequent first)
  const why = Object.entries(deferred).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'nothing_to_project';
  return { outcome: 'policy_skip', detail: { ...detail, ...counts, skipped: why, deferred } };
}
