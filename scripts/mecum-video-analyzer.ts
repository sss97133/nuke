#!/usr/bin/env node
/** Existing Mecum analyzer owner, now an offline discovery lane.
 * Downloads/ASR are separate evidence acquisition. This CLI never writes a database,
 * invents auction durations, or treats transcript numbers as accepted bids.
 */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { discoverCaptionCues, discoverAudioAssay } from './lib/broadcast-caption-discovery.mjs';

const usage = 'node scripts/mecum-video-analyzer.ts --transcript INTERNAL.json --output-dir DIR [--event-date YYYY-MM-DD] [--auction NAME] [--duration-seconds N] [--publication-at ISO] [--sample SAMPLE.json] [--evidence-module PATH] [--audio-assay PATH --audio-source-receipt PATH] [--miss-audit PATH] [--baseline-report PATH]';
const args = process.argv.slice(2);
const accepted = new Set(['--transcript','--output-dir','--event-date','--auction','--duration-seconds','--publication-at','--sample','--evidence-module','--audio-assay','--audio-source-receipt','--miss-audit','--baseline-report']);
const options = {};
for (let i=0; i<args.length; i++) {
  if (args[i] === '--help') { console.log(usage); process.exit(0); }
  if (!accepted.has(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new Error(usage);
  options[args[i].slice(2)] = args[++i];
}
if (!options.transcript || !options['output-dir']) throw new Error(usage);
const started = performance.now();
const transcriptPath = resolve(options.transcript);
const sourceBytes = await readFile(transcriptPath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const result = discoverCaptionCues(source, {
  raw_source_ref: transcriptPath, event_date: options['event-date'], auction_house: 'Mecum', auction: options.auction,
  duration_seconds: options['duration-seconds'] ? Number(options['duration-seconds']) : undefined,
  available_at: options['publication-at'],
});
const report = result.summary;
let audio=null;
if (options['audio-assay']) {
  if (!options['audio-source-receipt']) throw new Error('Original-audio ASR requires its acquisition receipt');
  const assay=JSON.parse(await readFile(resolve(options['audio-assay']),'utf8'));
  const acquisition_receipt=JSON.parse(await readFile(resolve(options['audio-source-receipt']),'utf8'));
  if (createHash('sha256').update(await readFile(assay.source_file)).digest('hex')!==assay.source_sha256) {
    throw new Error('Actual original-audio bytes no longer match the ASR source hash');
  }
  audio=discoverAudioAssay(assay,source,{ raw_source_ref: resolve(options['audio-assay']),acquisition_receipt });
}
if (audio) {
  report.original_audio = audio.summary;
  report.coverage.audio_seconds_listened_or_asr_assayed = audio.summary.source_duration_seconds;
}
report.generated_at = new Date().toISOString();
report.lane = 'audio_speech_feature_discovery';
report.owner = 'scripts/mecum-video-analyzer.ts';
report.raw_transcript_exported = false;
report.source_transcript_sha256 = createHash('sha256').update(sourceBytes).digest('hex');
report.measured_scan_ms = Number((performance.now() - started).toFixed(3));
if (options['miss-audit']) {
  const audit = JSON.parse(await readFile(resolve(options['miss-audit']), 'utf8'));
  if (audit.video_id !== source.video_id || audit.source_transcript_sha256 !== createHash('sha256').update(sourceBytes).digest('hex')) {
    throw new Error('Miss audit must describe the exact cached transcript being scanned');
  }
  report.miss_audit = { artifact: resolve(options['miss-audit']), status: audit.status,
    applies_to_discovery_version: audit.discovery_version, selection: audit.selection,
    denominators: audit.denominators, observed_counts: audit.observed_counts, discovered_missing_avenues: audit.discovered_missing_avenues,
    example_misses: audit.rows.filter(r => r.assessment === 'missed_avenue').map(r => ({ caption_index: r.caption_index,
      start_seconds: r.start_seconds, source_url: r.source_url, paraphrase: r.paraphrase })),
    repair_proposals: audit.repair_proposals, limitation: audit.limitation };
}
if (options['baseline-report']) {
  const baseline=JSON.parse(await readFile(resolve(options['baseline-report']),'utf8'));
  if (baseline.video_id!==source.video_id || baseline.source_transcript_sha256!==report.source_transcript_sha256) {
    throw new Error('Baseline report must describe the exact cached transcript being scanned');
  }
  report.revision = { baseline_artifact: resolve(options['baseline-report']), baseline_version: baseline.discovery_version,
    current_version: report.discovery_version, baseline_yield: baseline.yield, revised_yield: report.yield,
    candidate_grain_delta: report.yield.candidate_source_grains-baseline.yield.candidate_source_grains,
    transition_candidate_delta: report.yield.presentation_transition_candidates-baseline.yield.presentation_transition_candidates,
    change: 'Added literal next-car references even when make/year is absent; retained raw cue context and unresolved future/current scope.',
    literal_next_car_followup: source.segments.filter(c=>/\bnext\s+car\b/i.test(c.text)).map(c=>({ caption_index: c.index,
      start_seconds: c.time_seconds, detected_as_candidate: result.grains.some(g=>g.structured_data.media.caption_index===c.index &&
        g.structured_data.value.cue_labels.includes('relative_next_vehicle')), verified_auction_boundary: false,
      source_url: `https://www.youtube.com/watch?v=${source.video_id}&t=${Math.floor(c.time_seconds)}s` })),
    precision_or_recall_inference: 'None. Five previously missed lexical leads are now retained for review.' };
}
if (options.sample) {
  const sample = JSON.parse(await readFile(resolve(options.sample), 'utf8'));
  report.existing_production_sample = { artifact: resolve(options.sample), observation_count: sample.observation_count,
    status: sample.status, proof_scope: 'previous verified source sample, separate from this discovery candidate yield' };
}
let normalized = null;
if (options['evidence-module']) {
  const shared = await import(pathToFileURL(resolve(options['evidence-module'])).href);
  normalized = shared.prepareBroadcastReceipt({ observations: result.grains });
  report.intake_compatibility = { validated_with: resolve(options['evidence-module']),
    assay: shared.assayBroadcastReceipt(normalized), posted: false,
    hold: 'Language discovery candidates need review and source-specific property semantics before production intake.' };
}
const s114 = result.grains.filter(g => g.structured_data.media.start_seconds >= 2532 && g.structured_data.media.start_seconds < 2606);
if (source.video_id === 'c9fxArnD3IY') report.first_review_window = { source_offset_start_seconds: 2532, source_offset_end_seconds: 2606,
  scope: 'S114 source window established by separate catalogue/frame sample; parser makes no vehicle assignment',
  candidate_grains: s114.length,
  category_counts: Object.fromEntries(report.categories.map(c => [c.property,s114.filter(g => g.structured_data.property === c.property).length])),
  example_claims: [
    { start_seconds: 2541, property: 'evaluative_language_cue', paraphrase: 'Investment-quality praise of the Corvette.', claim_status: 'caption-derived opinion cue', speaker_role: null },
    { start_seconds: 2542, property: 'vehicle_detail_cue', paraphrase: 'Engine and transmission originality plus documentation are discussed.', claim_status: 'unverified vehicle fact claim', speaker_role: null },
    { start_seconds: 2550, property: 'vehicle_history_cue', paraphrase: 'Three-owner history is stated alongside an odometer reading.', claim_status: 'unverified vehicle fact claim', speaker_role: null },
    { start_seconds: 2574, property: 'vehicle_detail_cue', paraphrase: 'A model-year production quantity is stated; compare the catalogue and audio.', claim_status: 'unverified numeric fact claim', speaker_role: null },
    { start_seconds: 2600, property: 'price_language_cue', paraphrase: 'A high bid of 140,000 dollars is announced in the caption.', claim_status: 'announced high bid, not a completed sale or accepted-bid count', speaker_role: null },
  ].filter(e => s114.some(g => g.structured_data.property === e.property && g.structured_data.media.start_seconds === e.start_seconds)),
  original_audio_review_pending: true, accepted_bid_velocity: null, bid_acceleration: null, crowd_emotion: null };
const outputDir = resolve(options['output-dir']);
await mkdir(outputDir, { recursive: true });
const save = async (name, value) => {
  const target = join(outputDir, name); const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, target);
};
await save('candidate-grains.json', { status: 'review_only_not_posted', observations: result.grains });
await save('review-windows.json', { windows: result.review_windows });
if (audio) await save('original-audio-candidate-grains.json', { status: 'review_only_clip_offsets_not_intake_ready', grains: audio.grains });
if (normalized) await save('validated-candidate-payload.json', { options: { stop_on_error: true, gap_fill: false, write_evidence: false }, observations: normalized, review_only: true });
// Write latest last, atomically, so dashboards only see a complete pass.
await save(`${report.discovery_version}.json`, report);
await save('latest.json', report);
console.log(JSON.stringify({ status: report.status, coverage: report.coverage, yield: report.yield,
  measured_scan_ms: report.measured_scan_ms, output: join(outputDir,'latest.json') },null,2));
