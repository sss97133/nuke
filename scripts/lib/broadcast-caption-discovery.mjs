/** Offline cue discovery. A language hit is a review lead, never a verified vehicle fact.
 * Raw captions stay in the caller's INTERNAL cache; exported grains carry hashes and offsets.
 */
import { createHash } from 'node:crypto';

export const DISCOVERY_VERSION = 'mecum-caption-cues-v2';
const hash = value => createHash('sha256').update(value).digest('hex');
const rule = (property, label, pattern) => ({ property, label, id: `${property}:${label}`, pattern });
export const RULES = [
  rule('vehicle_reference_cue', 'vehicle_year', /\b(?:19[2-9]\d|20[0-2]\d)\b/),
  rule('vehicle_reference_cue', 'chevrolet', /\b(?:chevrolet|chevy)\b/i),
  rule('vehicle_reference_cue', 'corvette', /\bcorvettes?\b/i),
  rule('vehicle_reference_cue', 'ford', /\bford\b/i),
  rule('vehicle_reference_cue', 'mustang', /\bmustangs?\b/i),
  rule('vehicle_reference_cue', 'shelby', /\bshelby\b/i),
  rule('vehicle_reference_cue', 'dodge', /\bdodge\b/i),
  rule('vehicle_reference_cue', 'plymouth', /\bplymouth\b/i),
  rule('vehicle_reference_cue', 'pontiac', /\bpontiac\b/i),
  rule('vehicle_reference_cue', 'camaro', /\bcamaros?\b/i),
  rule('vehicle_reference_cue', 'challenger', /\bchallengers?\b/i),
  rule('vehicle_reference_cue', 'charger', /\bchargers?\b/i),
  rule('vehicle_reference_cue', 'ferrari', /\bferraris?\b/i),
  rule('vehicle_reference_cue', 'porsche', /\bporsche\b/i),
  rule('vehicle_reference_cue', 'bmw', /\bbmw\b/i),
  rule('vehicle_reference_cue', 'mercedes', /\bmercedes\b/i),
  rule('vehicle_reference_cue', 'lamborghini', /\blamborghinis?\b/i),
  rule('vehicle_reference_cue', 'jaguar', /\bjaguars?\b/i),
  rule('vehicle_reference_cue', 'cadillac', /\bcadillacs?\b/i),
  rule('vehicle_reference_cue', 'aston_martin', /\baston\s+martin\b/i),
  rule('vehicle_reference_cue', 'lot_reference', /\blot\s*(?:number\s*)?[a-z]?\d{2,5}\b/i),
  rule('vehicle_reference_cue', 'relative_next_vehicle', /\bnext\s+car\b/i),
  rule('vehicle_history_cue', 'ownership', /\b(?:[a-z-]+owner|owners?|ownership|owned|purchased|bought|acquired|consignor)\b/i),
  rule('vehicle_history_cue', 'collection', /\b(?:collection|collector|museum|estate)\b/i),
  rule('vehicle_history_cue', 'competition_history', /\b(?:raced|racing|race\s+history|competition|championship|winner|won\s+the)\b/i),
  rule('vehicle_history_cue', 'documentation', /\b(?:documentation|documented|documents|paperwork|certifications?|certified|affirmations?|provenance|build\s+sheet|window\s+sticker)\b/i),
  rule('vehicle_history_cue', 'restoration', /\b(?:restored|restoration|rebuilt|rebuild)\b/i),
  rule('vehicle_history_cue', 'delivery_origin', /\b(?:delivered|delivery|original\s+dealer|sold\s+new|factory\s+ordered)\b/i),
  rule('vehicle_detail_cue', 'engine', /\b(?:engine|horsepower|horse|cubic\s+inch|big\s*block|small\s*block|carburetor|carburetors|v[68]|turbo|supercharg|hemi|l68)\b/i),
  rule('vehicle_detail_cue', 'drivetrain', /\b(?:transmission|rear\s+end|rearend|four[- ]speed|4[- ]speed|manual|automatic|gearbox|differential)\b/i),
  rule('vehicle_detail_cue', 'originality', /\b(?:numbers?[- ]matching|original|unrestored|survivor|authentic)\b/i),
  rule('vehicle_detail_cue', 'body_configuration', /\b(?:convertible|roadster|coupe|fastback|hard\s*top|soft\s*top|two[- ]top|sedan)\b/i),
  rule('vehicle_detail_cue', 'color_trim', /\b(?:paint|interior|leather|upholstery|color\s+combination|livery|liveries|stinger)\b/i),
  rule('vehicle_detail_cue', 'equipment', /\b(?:headrest|air\s+conditioning|tinted\s+glass|radio|amfm|am\/fm|wheels?|tires?|brakes?|steering)\b/i),
  rule('vehicle_detail_cue', 'mileage', /\b(?:odometer|mileage|miles?|kilometers?)\b/i),
  rule('vehicle_detail_cue', 'production_rarity', /\b(?:produced|production|built|one\s+of|only\s+\d|rare\s+color)\b/i),
  rule('evaluative_language_cue', 'quality_appearance', /\b(?:beautiful|gorgeous|stunning|fantastic|amazing|excellent|exceptional|spectacular|impressive|wonderful|pristine|that's\s+good|wow)\b/i),
  rule('evaluative_language_cue', 'rarity_desirability', /\b(?:rare|rarity|collectib(?:le|ility)|desirable|exclusiv(?:e|ity)|iconic|special|unique)\b/i),
  rule('evaluative_language_cue', 'value_opinion', /\b(?:blue\s*chip|bargain|investment|undervalued|overvalued|worth|great\s+(?:buy|value)|set\s+the\s+bar\s+on\s+value)\b/i),
  rule('evaluative_language_cue', 'opinion_marker', /\b(?:i\s+(?:think|believe|love|like)|in\s+my\s+opinion|to\s+me)\b/i),
  rule('price_language_cue', 'explicit_currency', /\$\s*\d|\b\d[\d,.]*\s*(?:million|thousand|dollars?)\b/i),
  rule('price_language_cue', 'high_bid', /\bhigh\s*bid\b/i),
  rule('price_language_cue', 'bid_or_price_discussion', /\b(?:current\s+bid|bid\s+at|asking\s+(?:price|for)|price|estimate|bidder|bidding)\b/i),
  rule('outcome_language_cue', 'sold_language', /\b(?:sold|hammer\s+down|goes\s+to|going\s+to\s+the\s+bidder)\b/i),
  rule('outcome_language_cue', 'reserve_off', /\b(?:reserve\s+(?:is\s+)?off|no\s+reserve)\b/i),
  rule('outcome_language_cue', 'no_sale_language', /\b(?:no\s*sale|reserve\s+not\s+met|bid\s+goes\s+on|passed\s+on\s+the\s+block)\b/i),
  rule('auction_cadence_language_cue', 'warning_or_closing', /\b(?:going\s+once|going\s+twice|fair\s+warning|last\s+chance|anybody\s+else|all\s+done)\b/i),
  rule('auction_cadence_language_cue', 'asking_or_chant', /\b(?:do\s+i\s+hear|who'll\s+give|would\s+you\s+give|you\s+want\s+more|now\s+\d|bid\s+\d)\b/i),
  rule('room_reaction_language_cue', 'verbal_reaction_description', /\b(?:applause|cheering|crowd|standing\s+ovation|audience|bidding\s+war|bidder\s+war|excitement|excited)\b/i),
];
const PROPERTIES = [...new Set(RULES.map(r => r.property))];
const titles = {
  vehicle_reference_cue: 'Vehicle references and possible presentation transitions',
  vehicle_history_cue: 'Ownership, history, restoration and documents',
  vehicle_detail_cue: 'Specifications, originality, equipment and mileage',
  evaluative_language_cue: 'Verbal evaluation and opinion',
  price_language_cue: 'Price and bidding language',
  outcome_language_cue: 'Outcome and reserve language',
  auction_cadence_language_cue: 'Chant, asking and closing language',
  room_reaction_language_cue: 'Verbal room and reaction descriptions',
};
const transition = /\b(?:next\s+car|next\s+up|up\s+next|how\s+about|here\s+comes|on\s+the\s+block|it\s+is\s+time|it['’]s\s+time|from\s+the\b.{0,70}\bhow\s+about)\b/i;
const historical = /\b(?:yesterday|last\s+(?:year|night|week|month)|previously|in\s+(?:19|20)\d{2}|sold\s+new|years?\s+ago|original\s+dealer)\b/i;

export function classifyText(text) {
  const grouped = new Map();
  for (const r of RULES) if (r.pattern.test(text)) {
    if (!grouped.has(r.property)) grouped.set(r.property, []);
    grouped.get(r.property).push(r);
  }
  return grouped;
}

function explicitMoney(text) {
  const result = [];
  // A currency sign or written currency unit is required. Bare chant numbers stay uninterpreted.
  const expressions = [/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(million|thousand|m|k)?\b/gi,
    /\b(\d[\d,]*(?:\.\d+)?)\s*(million|thousand)?\s+dollars?\b/gi];
  for (const pattern of expressions) for (const match of text.matchAll(pattern)) {
    const multiplier = /^(million|m)$/i.test(match[2] ?? '') ? 1e6 : /^(thousand|k)$/i.test(match[2] ?? '') ? 1e3 : 1;
    const amount = Number(match[1].replaceAll(',', '')) * multiplier;
    if (!Number.isFinite(amount) || amount < 0) continue;
    if (!result.some(x => x.start_char === match.index && x.amount === amount)) result.push({
      amount, currency: null, currency_symbol_or_word: match[0].includes('$') ? '$' : 'dollar',
      start_char: match.index, status: 'unverified_caption_numeric_parse',
      warning: 'ASR can corrupt decimal points, commas and scale words; this is not an accepted bid.',
    });
  }
  return result;
}

function validate(source, options) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(source.video_id ?? '')) throw new Error('11-character video_id required');
  if (!Number.isFinite(Date.parse(source.captured_at))) throw new Error('Frozen source capture timestamp required');
  if (source.timing_unit !== 'seconds_from_media_start') throw new Error('Media-relative caption clock required');
  if (!Array.isArray(source.segments) || !source.segments.length) throw new Error('Nonempty cached caption segments required');
  const seen = new Set(); let previous = -Infinity;
  for (const cue of source.segments) {
    if (!Number.isSafeInteger(cue.index) || cue.index < 0 || seen.has(cue.index)) throw new Error('Unique nonnegative caption indexes required');
    seen.add(cue.index);
    if (!Number.isFinite(cue.time_seconds) || cue.time_seconds < 0 || cue.time_seconds < previous) throw new Error('Ordered nonnegative caption onset required');
    if (typeof cue.text !== 'string') throw new Error('Caption text required');
    if (options.duration_seconds != null && cue.time_seconds > options.duration_seconds) throw new Error('Caption onset exceeds source duration');
    previous = cue.time_seconds;
  }
  if (options.duration_seconds != null && (!Number.isFinite(options.duration_seconds) || options.duration_seconds <= 0)) throw new Error('Positive supplied duration required');
  if (!options.raw_source_ref) throw new Error('INTERNAL source reference required');
  if (options.event_date && !/^\d{4}-\d{2}-\d{2}$/.test(options.event_date)) throw new Error('Date-only event context required');
}

/** Retain every caption index, including simultaneous onsets. Export no original caption text. */
export function discoverCaptionCues(source, options = {}) {
  validate(source, options);
  const grains = []; const byCue = []; const ruleCounts = {};
  for (let position = 0; position < source.segments.length; position++) {
    const cue = source.segments[position]; const grouped = classifyText(cue.text);
    for (const hits of grouped.values()) for (const r of hits) {
      ruleCounts[r.id] = (ruleCounts[r.id] ?? 0) + 1;
    }
    const next = source.segments[position + 1];
    const nextOnset = next?.time_seconds > cue.time_seconds ? next.time_seconds : null;
    const roles = [...grouped.keys()];
    const anchor = grouped.has('vehicle_reference_cue') &&
      (transition.test(cue.text) || grouped.get('vehicle_reference_cue').some(r => r.label === 'lot_reference'));
    const references = (grouped.get('vehicle_reference_cue') ?? []).filter(r => !['vehicle_year','lot_reference','relative_next_vehicle'].includes(r.label)).map(r => r.label);
    if (grouped.size) byCue.push({ caption_index: cue.index, start_seconds: cue.time_seconds, next_caption_onset_seconds: nextOnset,
      properties: roles, reference_labels: references, transition_candidate: anchor });
    for (const [property, hits] of grouped) {
      const labels = hits.map(r => r.label);
      const value = { cue_labels: labels, rule_ids: hits.map(r => r.id), interpretation_status: 'candidate_for_review',
        speaker_id: null, speaker_role: null, vehicle_id: null,
        historical_language_present: historical.test(cue.text),
        ...(labels.includes('relative_next_vehicle') ? { navigation_relation: 'relative_next_vehicle_language',
          navigation_scope: 'next_or_future_reference_not_verified_auction_transition', actual_presentation_start: null } : {}),
        ...(property === 'price_language_cue' ? { explicit_currency_parses: explicitMoney(cue.text), accepted_bid: null } : {}),
        ...(property === 'outcome_language_cue' ? { auction_outcome: null, scope: historical.test(cue.text) ? 'historical_language_present' : 'current_or_historical_unknown' } : {}),
        ...(property === 'room_reaction_language_cue' ? { measured_crowd_emotion: null, evidence_channel: 'verbal_caption_description' } : {}),
      };
      grains.push({ source_slug: 'youtube', source_identifier: `youtube:${source.video_id}:caption:${cue.index}:cue:${property}:v1`,
        source_url: `https://www.youtube.com/watch?v=${source.video_id}&t=${Math.floor(cue.time_seconds)}s`,
        kind: 'media', observed_at: source.captured_at, confidence: 0.35, agent_inferred: true,
        extraction_method: 'deterministic_caption_rule_discovery',
        raw_source_ref: `${options.raw_source_ref}#caption-index=${cue.index}`,
        observer_raw: { speaker_id: null, speaker_role: null, role_status: 'unknown_pending_original_audio' },
        structured_data: { property, value, claim_role: 'transcript_discovery_cue',
          media: { video_id: source.video_id, caption_index: cue.index, start_seconds: cue.time_seconds,
            end_seconds: null, next_caption_onset_seconds: nextOnset, next_onset_is_utterance_end: false },
          media_citation: { start_ms: Math.round(cue.time_seconds * 1000), relation: 'vehicle_discussed', span_semantics: 'caption_cue' },
          event_context: { auction_house: options.auction_house ?? null, auction: options.auction ?? null,
            event_date: options.event_date ?? null, event_date_precision: options.event_date ? 'day' : 'unknown' },
          clock: { observed_at_basis: 'source_capture_time', source_event_date: options.event_date ?? null,
            source_event_time_precision: options.event_date ? 'day' : 'unknown', source_event_at: null,
            relative_media_time_unit: 'second', usable_for_exact_event_time_replay: false },
        },
        extraction_metadata: { captured_at: source.captured_at, discovery_version: DISCOVERY_VERSION,
          source_caption_sha256: hash(cue.text), source_video_sha256: null, source_caption_hash_basis: 'exact_cached_caption_utf8',
          source_transcript_type: source.transcript_type ?? 'unknown', needs_review: true,
          available_at: options.available_at ?? null, available_at_basis: options.available_at ? 'source_publication_time' : 'unknown' },
      });
    }
  }
  // Review groups are capped at 180s. Neither gaps nor an adjacent caption determine an auction boundary.
  const windows = []; let current;
  for (const cue of byCue) {
    if (!current || cue.start_seconds - current.last_cue_seconds > 20 || cue.start_seconds - current.start_seconds > 180) {
      current = { review_window_id: `youtube:${source.video_id}:review:${cue.caption_index}:v1`, start_seconds: cue.start_seconds,
        last_cue_seconds: cue.start_seconds, caption_indexes: [], properties: new Set(), reference_labels: new Set(), transition_candidate_count: 0 };
      windows.push(current);
    }
    current.last_cue_seconds = cue.start_seconds; current.caption_indexes.push(cue.caption_index);
    cue.properties.forEach(p => current.properties.add(p)); cue.reference_labels.forEach(p => current.reference_labels.add(p));
    if (cue.transition_candidate) current.transition_candidate_count++;
  }
  const reviewWindows = windows.map(w => ({ ...w, properties: [...w.properties], reference_labels: [...w.reference_labels],
    source_url: `https://www.youtube.com/watch?v=${source.video_id}&t=${Math.floor(w.start_seconds)}s`,
    media_citation: { start_ms: Math.round(w.start_seconds * 1000), end_ms: Math.round(w.last_cue_seconds * 1000),
      relation: 'vehicle_discussed', span_semantics: 'candidate_interval' },
    boundary_basis: 'rule_hit_group_gap_max20s_span_max180s', actual_presentation_boundary_verified: false,
    vehicle_id: null, auction_event_id: null }));
  const categories = PROPERTIES.map(property => {
    const rows = grains.filter(g => g.structured_data.property === property);
    return { property, title: titles[property], candidate_grains: rows.length, unique_caption_cues: rows.length,
      review_windows: reviewWindows.filter(w => w.properties.includes(property)).length,
      rule_frequencies: Object.fromEntries(RULES.filter(r => r.property === property).map(r => [r.label, ruleCounts[r.id] ?? 0])),
      example_candidates: rows.slice(0, 3).map(g => ({ start_seconds: g.structured_data.media.start_seconds,
        caption_index: g.structured_data.media.caption_index, cue_labels: g.structured_data.value.cue_labels,
        source_url: g.source_url, claim_role: 'transcript_discovery_cue', speaker_role: null })),
    };
  });
  const onsets = source.segments.map(s => s.time_seconds);
  const gaps = onsets.slice(1).map((v, i) => v - onsets[i]);
  const sortedGaps = [...gaps].sort((a,b) => a-b);
  const anchored = byCue.filter(c => c.transition_candidate);
  return { grains, review_windows: reviewWindows, summary: {
    discovery_version: DISCOVERY_VERSION, status: 'whole_cached_broadcast_scanned_candidates_only_no_new_production_writes',
    video_id: source.video_id, source_url: `https://www.youtube.com/watch?v=${source.video_id}`,
    source_capture_at: source.captured_at, publication_at: options.available_at ?? null,
    coverage: { caption_cues: source.segments.length, scanned_caption_cues: source.segments.length,
      word_tokens: source.segments.reduce((n,s) => n + (s.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length,0),
      duration_seconds: options.duration_seconds ?? null, duration_basis: options.duration_seconds ? 'caller_supplied_source_metadata' : 'unknown',
      first_caption_onset_seconds: onsets[0], last_caption_onset_seconds: onsets.at(-1),
      caption_onset_envelope_seconds: onsets.at(-1) - onsets[0],
      duplicate_onset_pairs: gaps.filter(g => g === 0).length, max_caption_onset_gap_seconds: gaps.length ? Math.max(...gaps) : null,
      median_caption_onset_gap_seconds: sortedGaps[Math.floor(sortedGaps.length / 2)] ?? null,
      audio_seconds_listened_or_asr_assayed: 0, frame_seconds_assayed_this_lane: 0,
      continuous_audio_or_visual_coverage_verified: false },
    yield: { candidate_source_grains: grains.length, unique_source_grains: new Set(grains.map(g => g.source_identifier)).size,
      captions_with_any_rule_hit: byCue.length, captions_without_rule_hit: source.segments.length - byCue.length,
      review_windows: reviewWindows.length, presentation_transition_candidates: anchored.length,
      windows_with_transition_candidates: reviewWindows.filter(w => w.transition_candidate_count).length,
      distinct_reference_label_combinations: new Set(byCue.filter(c => c.reference_labels.length).map(c => [...c.reference_labels].sort().join('+'))).size,
      actual_vehicle_presentations_verified: 0, speaker_roles_verified: 0, accepted_bids_verified: 0,
      new_production_observations: 0, completeness_or_recall_measured: false },
    categories,
    definitions: { candidate_grain: 'One caption/category hit, not one verified vehicle fact.',
      review_window: 'A rule-hit group with gaps <=20 seconds and onset span <=180 seconds, not a measured auction.',
      transition_candidate: 'A vehicle/year/lot reference plus explicit transition language, not an identified vehicle.',
      distinct_reference_label_combinations: 'Distinct detected make/model label sets, not distinct vehicle counts.' },
    limitations: [
      'Automatic captions omit or corrupt speech and numbers; detector recall and precision have not been measured.',
      'All speakers and subjects remain unresolved. Caption writing style does not identify an auctioneer or commentator.',
      'Language cues do not verify specifications, ownership, lot identity, accepted bids, current sale outcomes or crowd emotion.',
      'Next caption onsets are retained as navigation points, never measured utterance ends or exact bid instants.',
      'Date-only auction context cannot become an exact event timestamp; publication and source capture time remain separate.',
      'Explicit currency parses can contain ASR scale errors and have unknown currency code; review original audio/display before acceptance.',
      'These eight initial avenues are open discovery prompts, not a complete fixed schema of the channel.' ],
    next_assays: [
      ...(source.video_id === 'c9fxArnD3IY' ? [
      { priority: 1, action: 'Listen/ASR original S114 audio and annotate speaker turns plus exact audible price/outcome phrases', start_seconds: 2518, end_seconds: 2610 },
      { priority: 2, action: 'Measure display price samples as interval-censored changes; separately annotate accepted bids from audio/video', start_seconds: 2532, end_seconds: 2606 },
      ] : []),
      { priority: 3, action: 'Check transition candidates against lot overlays and event-scoped primary catalogue identifiers', quantity: anchored.length },
      { priority: 4, action: 'Review stratified samples in every category and unhit captions to measure precision, missed avenues and recall', quantity: categories.length },
      { priority: 5, action: 'Assay crowd audio with levels, cheering/applause intervals and room video; distinguish description from measurement', prerequisite: 'original audio and video window' },
    ],
  } };
}

const median = values => {
  const ordered = [...values].sort((a,b) => a-b);
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : null;
};
const stopWords = new Set('the a an and or of on in this that is was it its to for from with all our at have has had as so well one you i they we he she be are were into over just but there about yeah how do'.split(' '));
const informativeTokens = text => new Set((text.toLowerCase().replace(/[.,-]/g,'').match(/[a-z0-9]+/g) ?? []).filter(w => !stopWords.has(w)));
const overlap = (a,b) => {
  const intersection = [...a].filter(w => b.has(w)).length;
  return intersection / Math.max(1, Math.min(a.size,b.size));
};

/** Assay already-produced local ASR. Clip offsets stay relative until its origin is verified.
 * Similar words can suggest a seek correction but cannot prove the WAV-to-video sample mapping.
 */
export function discoverAudioAssay(assay, source, options = {}) {
  if (!Array.isArray(assay.segments) || !assay.source_sha256 || !assay.source_duration_seconds) throw new Error('ASR source receipt, hash and duration required');
  const receipt=options.acquisition_receipt;
  if (!receipt?.acquired || receipt.video_id!==source.video_id ||
    !receipt.files?.some(file=>file.sha256===assay.source_sha256 && file.path===assay.source_file)) {
    throw new Error('Acquired audio receipt must bind this video to the exact ASR source file/hash');
  }
  const grains = []; const anchors = [];
  const requestedStart = assay.requested_offset_seconds ?? receipt.requested_start_seconds;
  const target = source.segments.filter(c => !Number.isFinite(requestedStart) ||
    (c.time_seconds >= requestedStart - 120 && c.time_seconds <= requestedStart + assay.source_duration_seconds + 120));
  assay.segments.forEach((s,index) => {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start || s.end > assay.source_duration_seconds + 0.1 || typeof s.text !== 'string') throw new Error('Valid file-relative ASR span required');
    const grouped = classifyText(s.text);
    for (const [property,hits] of grouped) grains.push({
      source_identifier: `youtube:${source.video_id}:audio:${assay.source_sha256}:asr:${index}:cue:${property}:v1`,
      property, claim_role: 'transcript_discovery_cue', value: { cue_labels: hits.map(r => r.label), rule_ids: hits.map(r => r.id),
        ...(property === 'price_language_cue' ? { explicit_currency_parses: explicitMoney(s.text), accepted_bid: null } : {}) },
      source_url: `https://www.youtube.com/watch?v=${source.video_id}`, source_audio_file: assay.source_file,
      raw_source_ref: `${options.raw_source_ref ?? 'INTERNAL_ASR'}#segment-index=${index}`,
      source_audio_sha256: assay.source_sha256, source_asr_segment_sha256: hash(s.text),
      relative_audio_start_seconds: s.start, relative_audio_end_seconds: s.end,
      timestamp_basis: 'acquired_audio_file_start', absolute_source_video_start_seconds: null,
      boundaries_basis: 'unreviewed_local_asr_segments', speaker_id: null, speaker_role: null, vehicle_id: null,
      status: 'review_candidate_not_intake_ready_source_seek_unverified',
    });
    const tokens = informativeTokens(s.text);
    if (tokens.size < 4) return;
    const scored = target.map(c => ({ caption_index: c.index, caption_start_seconds: c.time_seconds,
      score: overlap(tokens, informativeTokens(c.text)), token_count: informativeTokens(c.text).size }))
      .filter(c => c.token_count >= 4).sort((a,b) => b.score-a.score || a.caption_index-b.caption_index);
    const best = scored[0];
    if (best && best.score >= 0.7 && best.score - (scored[1]?.score ?? 0) >= 0.1) anchors.push({
      audio_segment_index: index, audio_start_seconds: s.start, caption_index: best.caption_index,
      caption_start_seconds: best.caption_start_seconds, informative_token_overlap: Number(best.score.toFixed(3)),
      offset_candidate_seconds: Number((best.caption_start_seconds-s.start).toFixed(3)),
    });
  });
  const initial = median(anchors.map(a => a.offset_candidate_seconds));
  const consistent = initial == null ? [] : anchors.filter(a => Math.abs(a.offset_candidate_seconds-initial) <= 8);
  const offset = median(consistent.map(a => a.offset_candidate_seconds));
  const categories = PROPERTIES.map(property => ({ property, title: titles[property],
    candidate_grains: grains.filter(g => g.property === property).length,
    unique_asr_segments: new Set(grains.filter(g => g.property === property).map(g => g.raw_source_ref)).size,
  }));
  return { grains, summary: {
    status: 'original_audio_asr_assayed_language_candidates_not_verified_speaker_or_bid_events',
    source_audio_file: assay.source_file, source_audio_sha256: assay.source_sha256,
    source_provenance_status: 'acquisition_receipt_video_and_hash_match', acquisition_capture_at: receipt.capture_finished_at ?? null,
    source_duration_seconds: assay.source_duration_seconds, asr_segment_count: assay.segments.length,
    asr_word_count_receipt: assay.word_count ?? null,
    asr_word_timestamp_count: assay.segments.reduce((n,s) => n+(s.words?.length ?? 0),0),
    model: assay.model, engine: assay.engine, device: assay.device, compute_type: assay.compute_type,
    measured_inference_seconds: assay.inference_seconds ?? null, measured_inference_audio_ratio: assay.inference_audio_ratio ?? null,
    paid_model_api_calls: assay.paid_model_api_calls ?? null, cost_dollars: assay.cost_dollars ?? null,
    categories, candidate_grains: grains.length, accepted_bids_verified: 0, speaker_roles_verified: 0,
    crowd_emotion_verified: false, auctioneer_utterances_verified: 0, commentator_utterances_verified: 0,
    alignment: { status: 'text_alignment_candidate_not_verified_source_seek', requested_offset_seconds: requestedStart ?? null,
      verified_offset_seconds: null, offset_candidate_seconds: offset,
      consistent_anchor_count: consistent.length, candidate_anchor_count: anchors.length,
      consistent_offset_min_seconds: consistent.length ? Math.min(...consistent.map(a=>a.offset_candidate_seconds)) : null,
      consistent_offset_max_seconds: consistent.length ? Math.max(...consistent.map(a=>a.offset_candidate_seconds)) : null,
      anchors, method: 'distinctive_token_overlap_within_requested_neighborhood_then_median_plusminus8s',
      caution: 'Caption and ASR onset boundaries are approximate; wording agreement cannot verify sample-accurate source origin.' },
    next_assays: [ 'Verify WAV source origin using source presentation timestamps or audiovisual anchors before absolute offsets.',
      'Listen to overlapping voices and manually annotate speaker turns before assigning commentary/auctioneer roles.',
      'Annotate accepted bids, asks, repetitions and outcomes separately; foreground ASR may omit background chant.',
      'Measure audio levels and crowd sounds separately from evaluative words.' ],
  } };
}
