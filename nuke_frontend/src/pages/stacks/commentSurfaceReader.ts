import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export const COMMENT_FILTERS = ['all_discussion', 'text', 'media_only', 'no_captured_content'] as const;
export type CommentFilter = typeof COMMENT_FILTERS[number];
export interface CommentSurfaceRequest {
  evidence_filter: CommentFilter;
  knowledge_mode?: 'recorded_input_reconstruction'; cutoff?: string;
  offset?: number; snapshot_hash?: string; event_cutoff?: string; recorded_cutoff?: string;
  include_trajectory?: boolean; evidence_bucket?: string;
}
export interface CommentHour {
  bucket_start: string; window_start: string; window_end: string; window_seconds: number;
  discussion_entries: number; text_entries: number; media_only_entries: number; no_captured_content_entries: number;
  whitespace_tokens: number; question_mark_entries: number; url_marker_entries: number; numeric_unit_marker_entries: number;
  seller_flagged_entries: number; unknown_seller_flag_entries: number; keyed_participant_count: number; unkeyed_participant_entries: number;
  entries_per_window_hour: number | null; cumulative_discussion_entries: number;
}
export interface CommentTrajectory {
  contract_version: 1; method_id: 'auction_comment_hourly_v1'; bucket_unit: 'UTC_hour'; nominal_bucket_seconds: 3600;
  event_time_basis: 'posted_at'; count_unit: 'retained_eligible_discussion_entries';
  rate_basis: 'eligible_window_seconds_not_observed_capture_uptime';
  zero_basis: 'zero_retained_eligible_entries_not_zero_external_activity';
  participant_basis: 'distinct_keyed_platform_identities_per_bucket_not_additive_people'; buckets: CommentHour[];
}
export interface CommentContribution {
  comment_id: string; vehicle_id: string; auction_event_id: string; native_comment_id: number | null;
  source_url: string; source_locator_basis: 'typed_lot_relation_only' | 'source_and_typed_lot_relation';
  source_comment_type: string; is_seller: boolean | null; external_identity_id: string | null;
  posted_at: string; db_recorded_at: string; characters: number | null; whitespace_tokens: number | null;
  question_marks: number | null; url_marker: boolean | null; numeric_unit_marker: boolean | null;
  media_reference_count: number; excerpt: string | null; excerpt_truncated: boolean;
}
export interface CommentSurfaceReceipt {
  state: 'partial'; contract_version: 1; method_id: 'auction_comment_surface'; method_version: 1;
  reason: 'retained_keyed_inputs_only'; knowledge_mode: 'current_recorded_state' | 'recorded_input_reconstruction';
  vehicle_id: string; auction_event_id: string; source_url: string; measured_at: string;
  event_cutoff: string; recorded_cutoff: string; close_at_as_currently_recorded: string; window_from: string;
  window_basis: string; historical_forecast_receipt: false; complete_external_capture: false; truncated: false;
  units: Record<string, string>; pattern_profiles: Record<string, string>;
  trajectory?: CommentTrajectory;
  coverage: {
    keyed_source_rows: number; unknown_event_time: number; unknown_recording_time: number;
    outside_event_window: number; recorded_after_cutoff: number; source_bid_marked_rows: number;
    other_source_labels: number; discussion_posted_by_cutoff: number; discussion_recorded_by_cutoff: number;
    unkeyed_source_rows: 'not_assessed'; semantic_classification: 'not_assessed';
  };
  features: {
    discussion_entries: number; text_entries: number; media_only_entries: number;
    no_captured_text_or_media_entries: number; whitespace_tokens: number; median_whitespace_tokens: number | null;
    question_mark_entries: number; question_mark_count: number; url_marker_entries: number;
    numeric_unit_marker_entries: number; seller_flagged_entries: number; unknown_seller_flag_entries: number;
    keyed_participant_count: number; unkeyed_participant_entries: number;
  };
  evidence: { snapshot_hash: string; offset: number; limit: 20; filter: CommentFilter; matching_entries: number;
    has_more: boolean; next_offset: number | null; contributors: CommentContribution[]; bucket_start?: string | null };
}
export type CommentSurfaceResponse = CommentSurfaceReceipt | { state: 'unavailable'; reason: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{32}$/;
const zoned = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const finiteCommentClock = (v: unknown): v is string => typeof v === 'string' && zoned.test(v) && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const sameClock = (a: string, b: string) => Date.parse(a) === Date.parse(b);
const PARAMS = ['csFilter', 'csCutoff', 'csOffset', 'csHash', 'csEvent', 'csRecorded', 'csHour'];
export const commentHourBoundary = (v: unknown): v is string => finiteCommentClock(v) && Date.parse(v) % 3_600_000 === 0;

/** Preserve the actual evidence cutoffs in a shared URL, without guessing missing continuation state. */
export function commentRequestFromParams(params: URLSearchParams): CommentSurfaceRequest | null {
  if (PARAMS.some(k => params.getAll(k).length > 1)) return null;
  const filter = params.get('csFilter') ?? 'all_discussion';
  const cutoff = params.get('csCutoff');
  const offset = params.get('csOffset');
  const snapshot = params.get('csHash');
  const event = params.get('csEvent'), recorded = params.get('csRecorded');
  const hour = params.get('csHour');
  if (!COMMENT_FILTERS.includes(filter as CommentFilter) || (cutoff !== null && !finiteCommentClock(cutoff))
    || (offset !== null && (!/^(0|[1-9][0-9]*)$/.test(offset) || Number(offset) > 5000))
    || (snapshot !== null && !hash.test(snapshot)) || (Number(offset) > 0 && !snapshot)
    || (hour !== null && (!commentHourBoundary(hour) || !snapshot))
    || (cutoff !== null && (event !== null || recorded !== null))
    || (cutoff === null && ((snapshot !== null) !== (event !== null && recorded !== null)
      || (event !== null && !finiteCommentClock(event)) || (recorded !== null && !finiteCommentClock(recorded))
      || ((event === null) !== (recorded === null))))) return null;
  return { evidence_filter: filter as CommentFilter, include_trajectory: true,
    ...(hour !== null ? { evidence_bucket: hour } : {}),
    ...(cutoff !== null ? { knowledge_mode: 'recorded_input_reconstruction' as const, cutoff } : {}),
    ...(offset !== null ? { offset: Number(offset) } : {}), ...(snapshot ? { snapshot_hash: snapshot } : {}),
    ...(event && recorded ? { event_cutoff: event, recorded_cutoff: recorded } : {}) };
}

export function commentParams(params: URLSearchParams, request: CommentSurfaceRequest): URLSearchParams {
  const next = new URLSearchParams(params);
  PARAMS.forEach(k => next.delete(k));
  if (request.evidence_filter !== 'all_discussion') next.set('csFilter', request.evidence_filter);
  if (request.cutoff) next.set('csCutoff', request.cutoff);
  if (request.offset != null) next.set('csOffset', String(request.offset));
  if (request.snapshot_hash) next.set('csHash', request.snapshot_hash);
  if (request.event_cutoff) next.set('csEvent', request.event_cutoff);
  if (request.recorded_cutoff) next.set('csRecorded', request.recorded_cutoff);
  if (request.evidence_bucket) next.set('csHour', request.evidence_bucket);
  return next;
}

export function initialCommentRequest(request: CommentSurfaceRequest): CommentSurfaceRequest {
  return { evidence_filter: request.evidence_filter,
    ...(request.include_trajectory ? {include_trajectory:true} : {}),
    ...(request.cutoff ? { knowledge_mode: 'recorded_input_reconstruction', cutoff: request.cutoff } : {}) };
}

export function commentPageRequest(receipt: CommentSurfaceReceipt, offset: number): CommentSurfaceRequest {
  return { evidence_filter: receipt.evidence.filter, offset, snapshot_hash: receipt.evidence.snapshot_hash,
    ...(receipt.trajectory ? {include_trajectory:true} : {}),
    ...(receipt.evidence.bucket_start ? {evidence_bucket:receipt.evidence.bucket_start} : {}),
    ...(receipt.knowledge_mode === 'recorded_input_reconstruction'
      ? { knowledge_mode: 'recorded_input_reconstruction', cutoff: receipt.recorded_cutoff }
      : { event_cutoff: receipt.event_cutoff, recorded_cutoff: receipt.recorded_cutoff }) };
}

export function commentHourRequest(receipt: CommentSurfaceReceipt, bucket: string | null): CommentSurfaceRequest {
  const next = commentPageRequest(receipt,0);
  delete next.evidence_bucket;
  if (bucket !== null) next.evidence_bucket=bucket;
  return next;
}

function checkedTrajectory(d:CommentSurfaceReceipt,request:CommentSurfaceRequest,fail:()=>never):CommentHour|undefined {
  if (!request.include_trajectory) {if(d.trajectory!==undefined||d.evidence.bucket_start!==undefined)fail();return;}
  const t=d.trajectory,f=d.features,e=d.evidence;
  if(!t||t.contract_version!==1||t.method_id!=='auction_comment_hourly_v1'||t.bucket_unit!=='UTC_hour'
    ||t.nominal_bucket_seconds!==3600||t.event_time_basis!=='posted_at'||t.count_unit!=='retained_eligible_discussion_entries'
    ||t.rate_basis!=='eligible_window_seconds_not_observed_capture_uptime'||t.zero_basis!=='zero_retained_eligible_entries_not_zero_external_activity'
    ||t.participant_basis!=='distinct_keyed_platform_identities_per_bucket_not_additive_people'||!Array.isArray(t.buckets))fail();
  const start=Date.parse(d.window_from),end=Date.parse(d.event_cutoff),first=Math.floor(start/3_600_000)*3_600_000;
  const expected=Math.floor(end/3_600_000)-Math.floor(start/3_600_000)+1;
  if(expected<1||expected>337||t.buckets.length!==expected)fail();
  const additive={discussion_entries:'discussion_entries',text_entries:'text_entries',media_only_entries:'media_only_entries',
    no_captured_content_entries:'no_captured_text_or_media_entries',whitespace_tokens:'whitespace_tokens',question_mark_entries:'question_mark_entries',
    url_marker_entries:'url_marker_entries',numeric_unit_marker_entries:'numeric_unit_marker_entries',seller_flagged_entries:'seller_flagged_entries',
    unknown_seller_flag_entries:'unknown_seller_flag_entries',unkeyed_participant_entries:'unkeyed_participant_entries'} as const;
  const totals=Object.fromEntries(Object.keys(additive).map(k=>[k,0])) as Record<keyof typeof additive,number>;
  let cumulative=0,identitySum=0;
  for(const [i,b] of t.buckets.entries()){
    const bucket=first+i*3_600_000,from=Math.max(bucket,start),to=Math.min(bucket+3_600_000,end);
    if(!commentHourBoundary(b.bucket_start)||Date.parse(b.bucket_start)!==bucket
      ||![b.window_start,b.window_end].every(finiteCommentClock)||Date.parse(b.window_start)!==from||Date.parse(b.window_end)!==to
      ||typeof b.window_seconds!=='number'||!Number.isFinite(b.window_seconds)||b.window_seconds<0||b.window_seconds>3600
      ||Math.abs(b.window_seconds-(to-from)/1000)>0.001001
      ||!Object.keys(additive).every(k=>count(b[k as keyof typeof additive]))||!count(b.keyed_participant_count)
      ||!count(b.cumulative_discussion_entries)||b.text_entries+b.media_only_entries+b.no_captured_content_entries!==b.discussion_entries
      ||![b.question_mark_entries,b.url_marker_entries,b.numeric_unit_marker_entries].every(n=>n<=b.text_entries)
      ||b.whitespace_tokens<b.text_entries||b.seller_flagged_entries+b.unknown_seller_flag_entries>b.discussion_entries
      ||b.unkeyed_participant_entries>b.discussion_entries||b.keyed_participant_count>b.discussion_entries-b.unkeyed_participant_entries
      ||b.keyed_participant_count>f.keyed_participant_count)fail();
    const rate=b.window_seconds===0?null:b.discussion_entries*3600/b.window_seconds;
    if(rate===null?b.entries_per_window_hour!==null:typeof b.entries_per_window_hour!=='number'||!Number.isFinite(b.entries_per_window_hour)
      ||Math.abs(b.entries_per_window_hour-rate)>Math.max(0.000001,Math.abs(rate)*1e-12))fail();
    cumulative+=b.discussion_entries;identitySum+=b.keyed_participant_count;
    if(b.cumulative_discussion_entries!==cumulative)fail();
    for(const key of Object.keys(additive) as (keyof typeof additive)[])totals[key]+=b[key];
  }
  if(Object.entries(additive).some(([key,feature])=>totals[key as keyof typeof additive]!==f[feature])||identitySum<f.keyed_participant_count)fail();
  if(request.evidence_bucket===undefined){if(e.bucket_start!==null)fail();return;}
  if(!commentHourBoundary(e.bucket_start)||!sameClock(e.bucket_start,request.evidence_bucket))fail();
  const selected=t.buckets.find(b=>sameClock(b.bucket_start,request.evidence_bucket!));
  if(!selected)fail();return selected;
}

export function assertCommentSurface(value: unknown, vehicle: string, lot: string, request: CommentSurfaceRequest): asserts value is CommentSurfaceReceipt {
  const d = value as CommentSurfaceReceipt;
  const fail = ():never => { throw new Error('Unsupported comment measurement receipt'); };
  if (!d || d.state !== 'partial' || d.contract_version !== 1 || d.method_id !== 'auction_comment_surface'
    || d.method_version !== 1 || d.reason !== 'retained_keyed_inputs_only' || d.vehicle_id !== vehicle || d.auction_event_id !== lot
    || d.knowledge_mode !== (request.knowledge_mode ?? 'current_recorded_state')
    || !/^https:\/\/bringatrailer\.com\/listing\/[a-z0-9-]+\/$/.test(d.source_url)
    || d.window_basis !== 'recorded_close_minus_14_days_not_observed_opening'
    || d.historical_forecast_receipt !== false || d.complete_external_capture !== false || d.truncated !== false
    || ![d.measured_at,d.event_cutoff,d.recorded_cutoff,d.close_at_as_currently_recorded,d.window_from].every(finiteCommentClock)
    || Date.parse(d.window_from) !== Date.parse(d.close_at_as_currently_recorded) - 14 * 86_400_000
    || Date.parse(d.event_cutoff) < Date.parse(d.window_from)
    || Date.parse(d.event_cutoff) > Math.min(Date.parse(d.recorded_cutoff),Date.parse(d.close_at_as_currently_recorded))
    || Date.parse(d.recorded_cutoff) > Date.parse(d.measured_at)
    || (request.cutoff && !sameClock(d.recorded_cutoff,request.cutoff))
    || (request.event_cutoff && !sameClock(d.event_cutoff,request.event_cutoff))
    || (request.recorded_cutoff && !sameClock(d.recorded_cutoff,request.recorded_cutoff))) fail();
  const units = { volume:'retained_source_entries',tokens:'whitespace_separated_runs',characters:'postgres_character_count',
    markers:'literal_pattern_presence',media:'nonblank_stored_media_references_not_verified_assets',expertise:'unmeasured',literacy:'unmeasured' };
  const profiles = { tokens:'posix_nonspace_runs_v1', questions:'literal_ascii_question_mark_v1',
    urls:'http_or_https_marker_v1',numeric_units:'english_automotive_unit_marker_v1' };
  if (Object.entries(units).some(([k,v]) => d.units?.[k] !== v)
    || Object.entries(profiles).some(([k,v]) => d.pattern_profiles?.[k] !== v)) fail();
  const f = d.features, c = d.coverage, e = d.evidence;
  const coverageCounts = ['keyed_source_rows','unknown_event_time','unknown_recording_time','outside_event_window',
    'recorded_after_cutoff','source_bid_marked_rows','other_source_labels','discussion_posted_by_cutoff','discussion_recorded_by_cutoff'] as const;
  if (!f || !c || !e || !Object.values(f).every(v => v === null || count(v) || (v === f.median_whitespace_tokens && typeof v === 'number' && Number.isFinite(v) && v >= 0))
    || !coverageCounts.every(k => count(c[k]) && c[k] <= 5000)
    || c.unkeyed_source_rows !== 'not_assessed' || c.semantic_classification !== 'not_assessed'
    || !count(f.discussion_entries) || f.discussion_entries > c.keyed_source_rows
    || c.discussion_recorded_by_cutoff !== f.discussion_entries || c.discussion_posted_by_cutoff < f.discussion_entries
    || ![f.text_entries,f.media_only_entries,f.no_captured_text_or_media_entries].every(count)
    || f.text_entries + f.media_only_entries + f.no_captured_text_or_media_entries !== f.discussion_entries
    || ![f.question_mark_entries,f.url_marker_entries,f.numeric_unit_marker_entries].every(v => count(v) && v <= f.text_entries)
    || !count(f.question_mark_count) || f.question_mark_count < f.question_mark_entries
    || !count(f.whitespace_tokens) || f.whitespace_tokens < f.text_entries
    || (f.text_entries === 0 ? f.median_whitespace_tokens !== null : typeof f.median_whitespace_tokens !== 'number' || f.median_whitespace_tokens < 1)
    || ![f.seller_flagged_entries,f.unknown_seller_flag_entries,f.keyed_participant_count,f.unkeyed_participant_entries].every(v => count(v) && v <= f.discussion_entries)
    || f.seller_flagged_entries + f.unknown_seller_flag_entries > f.discussion_entries
    || f.keyed_participant_count > f.discussion_entries - f.unkeyed_participant_entries) fail();
  const selected=checkedTrajectory(d,request,fail);
  if (!hash.test(e.snapshot_hash) || (request.snapshot_hash && e.snapshot_hash !== request.snapshot_hash)
    || e.offset !== (request.offset ?? 0) || e.limit !== 20 || e.filter !== request.evidence_filter
    || !count(e.matching_entries) || e.matching_entries !== (selected
      ? {all_discussion:selected.discussion_entries,text:selected.text_entries,media_only:selected.media_only_entries,no_captured_content:selected.no_captured_content_entries}
      : {all_discussion:f.discussion_entries,text:f.text_entries,media_only:f.media_only_entries,no_captured_content:f.no_captured_text_or_media_entries})[e.filter]
    || !Array.isArray(e.contributors) || e.contributors.length !== Math.min(20,Math.max(0,e.matching_entries-e.offset))
    || e.has_more !== (e.matching_entries > e.offset+20) || e.next_offset !== (e.has_more ? e.offset+20 : null)) fail();
  const seen = new Set<string>();
  for (const row of e.contributors) {
    const text = typeof row.excerpt === 'string';
    if (!uuid.test(row.comment_id) || seen.has(row.comment_id) || row.vehicle_id !== vehicle || row.auction_event_id !== lot
      || !['question','answer','observation','seller_update','seller_response','expert_opinion'].includes(row.source_comment_type)
      || !['typed_lot_relation_only','source_and_typed_lot_relation'].includes(row.source_locator_basis)
      || ![row.posted_at,row.db_recorded_at].every(finiteCommentClock)
      || Date.parse(row.posted_at) < Date.parse(d.window_from) || Date.parse(row.posted_at) > Date.parse(d.event_cutoff)
      || Date.parse(row.db_recorded_at) > Date.parse(d.recorded_cutoff)
      || (request.evidence_bucket && Math.floor(Date.parse(row.posted_at)/3_600_000)!==Math.floor(Date.parse(request.evidence_bucket)/3_600_000))
      || !(row.native_comment_id === null || (count(row.native_comment_id) && row.native_comment_id > 0))
      || row.source_url !== `${d.source_url}${row.native_comment_id ? `#comment-${row.native_comment_id}` : ''}`
      || !(row.external_identity_id === null || uuid.test(row.external_identity_id))
      || !(row.is_seller === null || typeof row.is_seller === 'boolean') || !count(row.media_reference_count)
      || typeof row.excerpt_truncated !== 'boolean'
      || (text ? !count(row.characters) || row.characters < 1 || !count(row.whitespace_tokens) || row.whitespace_tokens < 1
        || !count(row.question_marks) || typeof row.url_marker !== 'boolean' || typeof row.numeric_unit_marker !== 'boolean'
        : row.excerpt !== null || row.characters !== null || row.whitespace_tokens !== null || row.question_marks !== null
          || row.url_marker !== null || row.numeric_unit_marker !== null)
      || (e.filter === 'text' && !text) || (e.filter === 'media_only' && (text || row.media_reference_count < 1))
      || (e.filter === 'no_captured_content' && (text || row.media_reference_count !== 0))) fail();
    seen.add(row.comment_id);
  }
}

export const commentSurfaceKey = (vehicle: string, lot: string, request: CommentSurfaceRequest | null) =>
  ['auction-comment-surface', vehicle, lot, request] as const;

export async function fetchCommentSurface(vehicle: string, lot: string, request: CommentSurfaceRequest): Promise<CommentSurfaceResponse> {
  const { data, error } = await supabase.rpc('popup_vehicle_intel', {p_vehicle_id:vehicle,p_auction_event_id:lot,p_request:request});
  if (error) throw error;
  if (data?.state === 'unavailable' && typeof data.reason === 'string') return { state:'unavailable',reason:data.reason };
  assertCommentSurface(data,vehicle,lot,request);
  return data;
}

export function useCommentSurface(vehicle: string, lot: string, request: CommentSurfaceRequest | null) {
  return useQuery({ queryKey:commentSurfaceKey(vehicle,lot,request),
    queryFn:() => fetchCommentSurface(vehicle,lot,request!), enabled:uuid.test(vehicle) && uuid.test(lot) && request !== null,
    staleTime:60_000,retry:false,refetchOnWindowFocus:false });
}
