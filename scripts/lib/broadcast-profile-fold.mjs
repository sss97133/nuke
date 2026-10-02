/** Incremental preview of one presentation's source evidence. No database writes.
 * Each new immutable source-grain tuple updates only its event/stream counters and sums.
 * A duplicate tuple is a no-op. Relative media proxies never become accepted-bid rates.
 */
export function createBroadcastFold(context = {}) {
  for (const clock of ['source_as_of', 'system_as_of']) {
    if (context[clock] && !Number.isFinite(Date.parse(context[clock]))) throw new Error(`Invalid ${clock} cutoff`);
  }
  return { context, seen: new Set(), inputIds: new Set(), claims: 0, captionClaims: 0,
    properties: {}, roles: {}, streams: {}, cues: new Map(), excludedAlignment: 0,
    excludedAvailability: 0, excludedKnowledge: 0, opinionCandidates: 0, explicitOpinions: 0 };
}

export function applyBroadcastGrain(state, grain) {
  const available = grain.source_available_at || state.context.source_available_at;
  if (state.context.source_as_of && (!available || !Number.isFinite(Date.parse(available)) || Date.parse(available) > Date.parse(state.context.source_as_of))) {
    state.excludedAvailability++; return { applied: false, reason: 'not_available_as_of' };
  }
  if (state.context.system_as_of && (!grain.ingested_at || !Number.isFinite(Date.parse(grain.ingested_at)) || Date.parse(grain.ingested_at) > Date.parse(state.context.system_as_of))) {
    state.excludedKnowledge++; return { applied: false, reason: 'not_ingested_as_of' };
  }
  if (!grain.source_id || !grain.source_identifier || !grain.content_hash) throw new Error('Immutable source tuple required');
  const key = [grain.source_id, grain.source_identifier, grain.kind, grain.content_hash].join(':');
  if (state.seen.has(key)) return { applied: false, reason: 'duplicate_source_grain' };
  state.seen.add(key); state.inputIds.add(grain.id); state.claims++;
  if (grain.property) state.properties[grain.property] = (state.properties[grain.property] || 0) + 1;
  if (grain.claim_role) state.roles[grain.claim_role] = (state.roles[grain.claim_role] || 0) + 1;
  if (grain.property === 'evaluative_language_cue') state.opinionCandidates++;
  if (grain.property === 'commentary_opinion_text' && typeof grain.value === 'string') state.explicitOpinions++;
  const media = grain.media || {};
  if (Number.isInteger(media.segment_index)) {
    state.captionClaims++;
    const cueKey = `${media.video_id}:${media.segment_index}`;
    const prior = state.cues.get(cueKey);
    state.cues.set(cueKey, prior
      ? [Math.min(prior[0],media.start_seconds),Math.max(prior[1],media.end_seconds)]
      : [media.start_seconds,media.end_seconds]);
  }
  if (['current_bid_displayed', 'background_board_amount'].includes(grain.property)) {
    if (grain.unit !== 'USD' || !Number.isFinite(grain.value) || grain.value < 0 || !Number.isFinite(media.start_seconds)) {
      throw new Error('Display sample requires nonnegative USD value and media position');
    }
    // A background board is a separate instrument; no bid history is inferred from either.
    const streamKey = `${media.video_id}:${grain.property}`;
    const s = state.streams[streamKey] ||= { property: grain.property, samples: 0, eligible: 0,
      sum_t: 0, sum_p: 0, sum_tt: 0, sum_tp: 0, first_t: null, first_p: null, last_t: null, last_p: null };
    s.samples++;
    const requested = media.requested_seek_seconds ?? media.start_seconds;
    const decoded = media.decoded_callback_media_time_seconds;
    const alignmentPresent = Object.hasOwn(media, 'decoded_callback_media_time_seconds');
    const mismatch = (Object.hasOwn(media, 'requested_seek_seconds') && !Number.isFinite(requested)) ||
      (alignmentPresent && (!Number.isFinite(decoded) || Math.abs(decoded - requested) > 0.1));
    if (mismatch) { state.excludedAlignment++; return { applied: true, proxy_eligible: false }; }
    // Use a documented nominal offset so old screenshots without decoded PTS remain explicit proxies.
    const t = media.start_seconds, p = grain.value;
    s.eligible++; s.sum_t += t; s.sum_p += p; s.sum_tt += t * t; s.sum_tp += t * p;
    if (s.first_t === null || t < s.first_t) { s.first_t = t; s.first_p = p; }
    if (s.last_t === null || t > s.last_t) { s.last_t = t; s.last_p = p; }
  }
  return { applied: true };
}

function cueUnion(cues) {
  const intervals = [...cues.values()].filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((a,b) => a[0]-b[0]);
  let duration = 0, start = null, end = null;
  for (const [a,b] of intervals) {
    if (start === null) { start = a; end = b; }
    else if (a > end) { duration += end-start; start = a; end = b; }
    else end = Math.max(end,b);
  }
  return duration + (start === null ? 0 : end-start);
}

export function readBroadcastFold(state) {
  const streams = Object.entries(state.streams).map(([source_stream, s]) => {
    const elapsed = s.first_t === null ? null : s.last_t-s.first_t;
    const denominator = s.eligible*s.sum_tt-s.sum_t*s.sum_t;
    return { source_stream, source_property: s.property, sample_count: s.samples,
      proxy_eligible_samples: s.eligible, first_nominal_media_seconds: s.first_t,
      last_nominal_media_seconds: s.last_t, sampled_elapsed_seconds: elapsed,
      first_price_usd: s.first_p, last_price_usd: s.last_p,
      endpoint_delta_usd: elapsed > 0 ? s.last_p-s.first_p : null,
      endpoint_growth_usd_per_nominal_media_second: elapsed > 0 ? (s.last_p-s.first_p)/elapsed : null,
      regression_growth_usd_per_nominal_media_second: denominator > 0 ? (s.eligible*s.sum_tp-s.sum_t*s.sum_p)/denominator : null,
      measurement: 'sampled display proxy; nominal source offsets; no accepted-bid or change-time assertion' };
  });
  return { fold_version: 'broadcast-profile-v1', status: 'offline_preview_from_live_evidence',
    context: state.context,
    measured: { source_claims: state.claims, caption_attribute_claims: state.captionClaims,
      distinct_caption_cues: state.cues.size, caption_cue_union_seconds: cueUnion(state.cues),
      caption_coverage_semantics: 'cue bounds deduplicated at read; not utterance duration or lot duration',
      property_claim_counts: state.properties, source_role_claim_counts: state.roles,
      explicit_opinion_claims: state.explicitOpinions, evaluative_language_candidates: state.opinionCandidates },
    display_streams: streams,
    unknown: { accepted_bid_count: null, accepted_bid_velocity_per_second: null,
      active_lot_duration_seconds: null, continuous_vehicle_visible_seconds: null,
      speaker_identity: null, speaker_role: null, acoustic_excitation: null, crowd_emotion: null },
    coverage: { selected_presentations: 1, selected_videos: 1, accepted_bid_audio_coverage: 'unverified',
      price_samples_excluded_for_alignment: state.excludedAlignment,
      claims_excluded_by_source_as_of: state.excludedAvailability,
      claims_excluded_by_system_as_of: state.excludedKnowledge,
      population_inference: false },
    lineage: { observation_ids: [...state.inputIds].sort(), source_grain_count: state.seen.size,
      storage: 'reads the existing observation log; no parallel source/provenance store' } };
}
