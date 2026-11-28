import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export type SalesSeries = 'selected' | 'benchmark';
export type SalesMetric = 'recorded_sale_events' | 'captured_sell_through';
export type SalesOutcome = 'known_bidding_outcome' | 'sold' | 'no_sale' | 'withdrawn' | 'unresolved';
export type SalesScope = { kind: 'canonical_make'; canonical_make_id: string }
  | { kind: 'supported_subject'; subject_id: string }
  | { kind: 'descriptive_subject'; subject_id: string };
export interface SalesScopeOption { key: string; label: string; make: string; scope: SalesScope;
  descriptive?: { model: string; grain: 'year' | 'model'; year: number | null; yearStart: number | null; yearEnd: number | null } }
export interface DescriptiveScopeRule {
  subject_id: string; canonical_make: string | null; canonical_model: string | null; grain: string | null;
  year: number | null; year_start: number | null; year_end: number | null; canonical_model_id: string | null;
  comparison_scope_status: string | null; admission_purpose: 'captured_sell_through_descriptive';
  membership_method: string | null; state: 'admitted' | 'unavailable'; reason: string;
  registered_model_label: string | null; catalog_subject_id: string | null; equivalent_catalog_subjects: number;
}
export interface DescriptiveScopeCatalog { candidateCount: number; options: SalesScopeOption[]; rules: DescriptiveScopeRule[] }
const SCOPE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_PURPOSE='captured_sell_through_descriptive';
const SCOPE_METHOD='unique_exact_registered_model_alias_with_declared_year_scope_v1';

export interface SalesWindow { event_from: string; event_to: string }
export interface SalesDrill { bucket: string; series: SalesSeries; offset?: number; snapshotHash?: string; outcome?: SalesOutcome }
export interface SalesRequest extends SalesWindow {
  metric: SalesMetric; source_registry_slug: 'bringatrailer';
  benchmark: 'same_platform_excluding_scope'; scope: SalesScope; evidence_limit: number;
  evidence_bucket?: string; evidence_series?: SalesSeries;
  reserve_policy?: 'all_recorded_policies'; evidence_offset?: number;
  evidence_snapshot_hash?: string; evidence_outcome?: SalesOutcome;
}
export interface SalesPoint {
  bucket_start: string; series: SalesSeries; value: number | null; denominator: number | null;
  ratio: number | null; absolute_change: number | null; relative_change: number | null;
  numerator?: number | null; difference_vs_benchmark?: number | null; value_reason?: string;
  unit?: string;
  source_observed_at: string | null;
  coverage: {
    captured_eligible: number | null; ended_pending?: number | null; explicit_no_sale: number | null;
    bid_to?: number | null; sold_without_supported_amount?: number | null;
    withdrawn?: number | null; unresolved?: number | null; captured_sold?: number | null;
    source_clock_known: number | null; source_clock_unknown: number | null;
    incomplete_bucket: boolean; bucket_elapsed_seconds: number; full_bucket_seconds: number;
  };
}
export interface SalesContributor {
  auction_event_id: string; vehicle_id: string; source_url: string; event_at: string;
  bucket_start: string; series: SalesSeries; source_read_basis: string;
  source_observed_at: string | null; latest_source_row_write: string | null;
  outcome_class?: 'sold' | 'no_sale' | 'withdrawn' | 'unresolved'; source_outcome?: string | null;
  outcome_reason?: string; numerator_contribution?: number; denominator_contribution?: number;
  vehicle_identity?: { year: number | null; make: string | null; model: string | null };
}
export interface SalesScopeExclusion {
  auction_event_id:string;source_event_ids:string[];vehicle_id:string;source_url:string;event_at:string;
  vehicle_identity:{year:number|null;make:string|null;model:string|null};vehicle_identity_basis:'current_representative_parent_record';
  source_observed_at:string|null;source_read_basis:'direct_fetch'|'cached_snapshot'|'unknown';
  source_outcome:string|null;recorded_outcome_class:'sold'|'no_sale'|'withdrawn'|'unresolved';
  membership_reason:string;conflicting_listing_aliases:boolean;recorded_canonical_make_id:string|null;resolved_make_id:string|null;
  requested_canonical_model_id:string;exact_registered_model_count:number;matching_model_keys_limit:20;
  matching_model_keys_fingerprint:string|null;matching_model_keys_truncated:boolean;matching_model_ids:string[];
}
export interface SalesScopeExclusions {
  contract_version:1;state:'partial'|'unavailable';reason:string;membership_method:string;snapshot_hash:string;
  record_limit:20;complete_external_capture:false;current_parent_identity_only:true;
  total:number|null;records_truncated:boolean|null;omitted_records:number|null;
  reason_counts:{reason:string;episodes:number}[]|null;records:SalesScopeExclusion[];
}
export interface RecordedSalesReceipt extends SalesWindow {
  contract_version: number; metric_id: string; state: 'partial'; reason: string;
  unit?: string; method_id?: string; method_version?: number;
  scope: { kind?: SalesScope['kind']; canonical_make_id?: string; subject_id?: string;
    label?: string; comparison_basis?: string; comparison_scope_basis?: string; grain?: string; year?: number|null;
    year_start?: number|null; year_end?: number|null; canonical_model_id?: string; membership_method?: string; admission_purpose?: string };
  knowledge_cutoff: string; knowledge_mode: string; generated_at: string;
  candidate_limit: number; captured_candidates: number; truncated: boolean;
  coverage: {
    unresolved_scope: number | null; conflicting_alias_episodes: number | null;
    eligible_recorded_episodes: number | null; complete_external_capture: boolean;
  };
  series: SalesPoint[];
  summary?: { series: SalesSeries; numerator: number | null; denominator: number | null;
    ratio: number | null; withdrawn: number | null; unresolved: number | null }[];
  scope_exclusions?:SalesScopeExclusions;
  evidence: { has_more: boolean; per_bucket_series_limit: number; pagination_supported: boolean;
    snapshot_hash?: string; offset?: number; next_offset?: number | null; outcome_filter?: SalesOutcome;
    contributors: SalesContributor[] };
}
export type SalesResponse = RecordedSalesReceipt | { state: 'unavailable'; reason: string;
  scope_admission?: { subject_id: string; state: string; reason: string; admission_purpose: string } };

/** Full UTC days: today is excluded, so even seven days stays within the RPC's limit. */
export function recordedSalesWindow(days: 2 | 7, now = Date.now(), weeksBack = 0): SalesWindow {
  const date = new Date(now);
  const back = Number.isInteger(weeksBack) && weeksBack >= 0 && weeksBack <= 3 ? weeksBack : 0;
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - back * 7 * 86_400_000;
  return { event_from: new Date(end - days * 86_400_000).toISOString(), event_to: new Date(end).toISOString() };
}

export function recordedSalesRequest(scope: SalesScope, window: SalesWindow, drill: SalesDrill | null,
  metric: SalesMetric = 'recorded_sale_events'): SalesRequest {
  return { metric, source_registry_slug: 'bringatrailer',
    benchmark: 'same_platform_excluding_scope', scope, ...window, evidence_limit: 20,
    ...(metric === 'captured_sell_through' ? { reserve_policy: 'all_recorded_policies' as const,
      ...(drill?.offset ? { evidence_offset: drill.offset } : {}),
      ...(drill?.snapshotHash ? { evidence_snapshot_hash: drill.snapshotHash } : {}),
      ...(drill?.outcome ? { evidence_outcome: drill.outcome } : {}) } : {}),
    ...(drill ? { evidence_bucket: drill.bucket, evidence_series: drill.series } : {}) };
}

export function matchSalesMake(options: SalesScopeOption[], make: string | null): SalesScopeOption | undefined {
  if (!make) return undefined;
  const matches = options.filter(o => o.scope.kind === 'canonical_make' && o.make.toUpperCase() === make.toUpperCase());
  return matches.length === 1 ? matches[0] : undefined;
}

export async function fetchSalesScopes(): Promise<SalesScopeOption[]> {
  // Existing public registries, not a second model/range policy or an operator catalog.
  const [makes, subjects] = await Promise.all([
    supabase.from('canonical_makes').select('id,canonical_name', { count: 'exact' }).order('canonical_name').limit(1001),
    supabase.from('make_model_profiles')
      .select('subject_id,canonical_make,canonical_model,grain,year,year_start,year_end', { count: 'exact' })
      .eq('comparison_scope_status', 'supported').order('subject_id').limit(101),
  ]);
  if (makes.error) throw makes.error;
  if (subjects.error) throw subjects.error;
  if ((makes.data?.length ?? 0) > 1000 || (subjects.data?.length ?? 0) > 100) throw new Error('Scope catalog exceeds its display limit');
  // PostgREST max_rows can hide the sentinel itself; the total must match the returned collection.
  if (makes.count == null || subjects.count == null || makes.count !== makes.data?.length
    || subjects.count !== subjects.data?.length) throw new Error('Scope catalog response is incomplete');
  const options: SalesScopeOption[] = (makes.data ?? []).map(m => ({ key: `make:${m.id}`,
    label: m.canonical_name, make: m.canonical_name, scope: { kind: 'canonical_make', canonical_make_id: m.id } }));
  for (const s of subjects.data ?? []) {
    const years = s.grain === 'year' ? s.year : `${s.year_start}–${s.year_end}`;
    options.push({ key: `subject:${s.subject_id}`, label: `${s.canonical_make} ${s.canonical_model} · ${years} · supported grouping`,
      make: s.canonical_make, scope: { kind: 'supported_subject', subject_id: s.subject_id } });
  }
  return options;
}

/** Candidate collection is bounded to one selected make; PostgreSQL supplies admission and alias folding. */
export async function fetchDescriptiveSalesScopes(make: string, signal?: AbortSignal): Promise<DescriptiveScopeCatalog> {
  const fail=(): never=>{throw new Error('Incomplete or unsupported descriptive scope catalog');};
  if (!make.trim()) return fail();
  const literalMake=make.replace(/[\\%_]/g,'\\$&');
  let candidates=supabase.from('make_model_profiles').select('subject_id',{count:'exact'})
    .ilike('canonical_make',literalMake).in('grain',['year','model']).order('subject_id').limit(1001);
  if(signal)candidates=candidates.abortSignal(signal);
  const source=await candidates;
  if(source.error)throw source.error;
  if(!Array.isArray(source.data)||source.count===null||source.count!==source.data.length||source.count>1000)return fail();
  const ids:string[]=source.data.map(row=>row.subject_id);
  if(ids.some(id=>typeof id!=='string'||!SCOPE_UUID.test(id))||new Set(ids).size!==ids.length)return fail();
  if(ids.length===0)return {candidateCount:0,options:[],rules:[]};
  let call=supabase.rpc('cohort_scope_rule',{p_subject_ids:ids,p_purpose:SCOPE_PURPOSE});
  if(signal)call=call.abortSignal(signal);
  const {data,error}=await call;if(error)throw error;
  if(!Array.isArray(data)||data.length!==ids.length)return fail();
  const rows=data as DescriptiveScopeRule[],requested=new Set(ids),seen=new Set<string>();
  const nullableText=(value:unknown)=>value===null||typeof value==='string';
  const nullableYear=(value:unknown)=>value===null||typeof value==='number'&&Number.isSafeInteger(value);
  for(const row of rows){
    if(!row||typeof row!=='object'||!requested.has(row.subject_id)||seen.has(row.subject_id)||row.admission_purpose!==SCOPE_PURPOSE
      ||!['admitted','unavailable'].includes(row.state)||typeof row.reason!=='string'||!row.reason
      ||![row.canonical_make,row.canonical_model,row.grain,row.canonical_model_id,row.comparison_scope_status,row.registered_model_label].every(nullableText)
      ||![row.year,row.year_start,row.year_end].every(nullableYear))return fail();
    seen.add(row.subject_id);
    if(row.state==='admitted'){
      if(!row.canonical_make||row.canonical_make.toUpperCase()!==make.toUpperCase()||!row.canonical_model
        ||!row.registered_model_label||!row.canonical_model_id||!SCOPE_UUID.test(row.canonical_model_id)||!['year','model'].includes(row.grain??'')
        ||row.membership_method!==SCOPE_METHOD||!row.catalog_subject_id||!requested.has(row.catalog_subject_id)
        ||!Number.isSafeInteger(row.equivalent_catalog_subjects)||row.equivalent_catalog_subjects<1||row.equivalent_catalog_subjects>ids.length
        ||row.grain==='year'&&(row.year===null||row.year_start!==null||row.year_end!==null)
        ||row.grain==='model'&&row.year!==null)return fail();
    }else if(row.catalog_subject_id!==null||row.equivalent_catalog_subjects!==0||row.membership_method!==null)return fail();
  }
  const byId=new Map(rows.map(row=>[row.subject_id,row]));
  const counts=new Map<string,number>();
  for(const row of rows.filter(row=>row.state==='admitted'))counts.set(row.catalog_subject_id!,1+(counts.get(row.catalog_subject_id!)??0));
  for(const row of rows.filter(row=>row.state==='admitted')){
    const representative=byId.get(row.catalog_subject_id!)!;
    if(representative.state!=='admitted'||representative.catalog_subject_id!==representative.subject_id
      ||representative.canonical_model_id!==row.canonical_model_id||representative.grain!==row.grain
      ||representative.year!==row.year||representative.year_start!==row.year_start||representative.year_end!==row.year_end
      ||representative.equivalent_catalog_subjects!==row.equivalent_catalog_subjects
      ||counts.get(row.catalog_subject_id!)!==row.equivalent_catalog_subjects)return fail();
  }
  const options=rows.filter(row=>row.state==='admitted'&&row.subject_id===row.catalog_subject_id).map(row=>({
    key:`descriptive:${row.subject_id}`,label:`${row.canonical_make} ${row.canonical_model} · ${row.grain==='year'?`${row.year} model year`:'registered model group'}`,
    make:row.canonical_make!,scope:{kind:'descriptive_subject' as const,subject_id:row.subject_id},
    descriptive:{model:row.canonical_model!,grain:row.grain as 'year'|'model',year:row.year,yearStart:row.year_start,yearEnd:row.year_end},
  })).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
  return {candidateCount:ids.length,options,rules:rows};
}
export function useDescriptiveSalesScopes(make:string|null,enabled=true){
  return useQuery({queryKey:['market-descriptive-scopes',make?.toUpperCase()??null],
    queryFn:({signal})=>fetchDescriptiveSalesScopes(make!,signal),enabled:enabled&&Boolean(make),
    staleTime:60_000,retry:false,refetchOnWindowFocus:false});
}

export async function fetchRecordedSales(request: SalesRequest): Promise<SalesResponse> {
  const { data, error } = await supabase.rpc('get_market_trends', { p_request: request });
  if (error) throw error;
  if (data?.state === 'unavailable' && typeof data.reason === 'string') {
    if(data.scope_admission!==undefined&&(request.scope.kind!=='descriptive_subject'
      ||data.scope_admission?.subject_id!==request.scope.subject_id||data.scope_admission.state!=='unavailable'
      ||data.scope_admission.admission_purpose!==SCOPE_PURPOSE||typeof data.scope_admission.reason!=='string'))
      throw new Error('Unsupported descriptive-scope refusal');
    return data as SalesResponse;
  }
  if (!data || data.state !== 'partial' || data.contract_version !== 1 || data.metric_id !== request.metric
    || !Array.isArray(data.series) || !data.evidence || !Array.isArray(data.evidence.contributors)) {
    throw new Error('Unsupported recorded-sales receipt');
  }
  if (request.metric === 'captured_sell_through') assertCapturedOutcomes(data, request);
  return data as RecordedSalesReceipt;
}

/** A captured rate can only be drawn when its source counts and fraction agree. */
function assertCapturedOutcomes(data: RecordedSalesReceipt, request: SalesRequest) {
  const fail = () => { throw new Error('Unsupported captured-outcome receipt'); };
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const fraction = (value: unknown, numerator: unknown, denominator: unknown) => {
    if (data.truncated) return value === null && numerator === null && denominator === null;
    if (!count(numerator) || !count(denominator) || numerator > denominator) return false;
    return denominator === 0 ? value === null : typeof value === 'number' && Number.isFinite(value)
      && value >= 0 && value <= 1 && Math.abs(value - numerator / denominator) < 1e-12;
  };
  const unit = 'fraction_of_known_retained_bidding_outcomes';
  if (data.scope?.kind !== request.scope.kind
    || (request.scope.kind === 'canonical_make' ? data.scope.canonical_make_id !== request.scope.canonical_make_id
      : data.scope.subject_id !== request.scope.subject_id)
    || Date.parse(data.event_from) !== Date.parse(request.event_from) || Date.parse(data.event_to) !== Date.parse(request.event_to)
    || data.unit !== unit || data.method_id !== 'captured_auction_outcomes' || data.method_version !== 1
    || data.knowledge_mode !== 'current_recorded_state' || data.coverage.complete_external_capture !== false
    || !data.summary || data.summary.length !== 2 || new Set(data.summary.map(s => s.series)).size !== 2
    || data.summary.some(s => !['selected', 'benchmark'].includes(s.series) || !fraction(s.ratio,s.numerator,s.denominator))
    || !/^[0-9a-f]{32}$/.test(data.evidence.snapshot_hash ?? '')
    || data.evidence.pagination_supported !== true || !count(data.evidence.offset) || data.evidence.offset > 2000
    || (data.evidence.has_more && (!count(data.evidence.next_offset)
      || data.evidence.next_offset <= data.evidence.offset || data.evidence.next_offset > 2000))) fail();
  if(request.scope.kind==='descriptive_subject'){
    const scope=data.scope;
    const year=(v:unknown)=>v===null||typeof v==='number'&&Number.isSafeInteger(v);
    if(scope.admission_purpose!==SCOPE_PURPOSE||scope.membership_method!==SCOPE_METHOD
      ||!scope.canonical_model_id||!SCOPE_UUID.test(scope.canonical_model_id)||!scope.label
      ||!['year','model'].includes(scope.grain??'')||![scope.year,scope.year_start,scope.year_end].every(year)
      ||scope.grain==='year'&&(scope.year===null||scope.year_start!==null||scope.year_end!==null)
      ||scope.grain==='model'&&scope.year!==null)fail();
  }
  const keys = new Set<string>();
  for (const p of data.series) {
    const key = `${p.bucket_start}:${p.series}`;
    if (p.unit !== unit || !['selected', 'benchmark'].includes(p.series) || !Number.isFinite(Date.parse(p.bucket_start))
      || keys.has(key) || !fraction(p.value,p.numerator,p.denominator) || p.ratio !== p.value) fail();
    keys.add(key);
  }
  for (const c of data.evidence.contributors) {
    if (!['sold', 'no_sale', 'withdrawn', 'unresolved'].includes(c.outcome_class ?? '')
      || c.numerator_contribution !== (c.outcome_class === 'sold' ? 1 : 0)
      || c.denominator_contribution !== (c.outcome_class === 'sold' || c.outcome_class === 'no_sale' ? 1 : 0)) fail();
  }
  if(data.scope_exclusions!==undefined)assertScopeExclusions(data);
}

/** Optional during the SQL rollout; once present, explanations must describe this exact population and snapshot. */
function assertScopeExclusions(data:RecordedSalesReceipt){
  const x=data.scope_exclusions!;
  const fail=():never=>{throw new Error('Unsupported scope-exclusion receipt');};
  const count=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
  const uuid=(v:unknown)=>typeof v==='string'&&SCOPE_UUID.test(v);
  const nullableUuid=(v:unknown)=>v===null||uuid(v);
  const nullableText=(v:unknown)=>v===null||typeof v==='string';
  if(!x||data.scope.kind!=='descriptive_subject'||x.contract_version!==1||x.membership_method!==data.scope.membership_method
    ||x.snapshot_hash!==data.evidence.snapshot_hash||x.record_limit!==20||x.complete_external_capture!==false
    ||x.current_parent_identity_only!==true||!Array.isArray(x.records))return fail();
  if(data.truncated){
    if(x.state!=='unavailable'||x.reason!=='candidate_cap_exceeded'||x.total!==null||x.reason_counts!==null
      ||x.records.length||x.records_truncated!==null||x.omitted_records!==null)return fail();
    return;
  }
  if(x.state!=='partial'||!count(x.total)||x.total!==data.coverage.unresolved_scope||!Array.isArray(x.reason_counts)
    ||x.records.length!==Math.min(x.total,20)||x.records_truncated!==(x.total>20)||x.omitted_records!==Math.max(0,x.total-20))return fail();
  const reasons=new Map<string,number>();
  for(const r of x.reason_counts){if(!r||typeof r.reason!=='string'||!r.reason||!count(r.episodes)||!r.episodes||reasons.has(r.reason))return fail();reasons.set(r.reason,r.episodes);}
  if([...reasons.values()].reduce((a,b)=>a+b,0)!==x.total)return fail();
  const ids=new Set<string>(),urls=new Set<string>(),seenReasons=new Map<string,number>();
  for(const r of x.records){
    if(!r||!uuid(r.auction_event_id)||!uuid(r.vehicle_id)||ids.has(r.auction_event_id)
      ||typeof r.source_url!=='string'||!/^https:\/\/bringatrailer[.]com\/listing\/[^/?#]+\/$/.test(r.source_url)||urls.has(r.source_url)
      ||!Array.isArray(r.source_event_ids)||!r.source_event_ids.length||r.source_event_ids.some(v=>!uuid(v))
      ||new Set(r.source_event_ids).size!==r.source_event_ids.length||!r.source_event_ids.includes(r.auction_event_id)
      ||!reasons.has(r.membership_reason)||r.requested_canonical_model_id!==data.scope.canonical_model_id
      ||!nullableUuid(r.recorded_canonical_make_id)||!nullableUuid(r.resolved_make_id)||typeof r.conflicting_listing_aliases!=='boolean'
      ||!r.vehicle_identity||r.vehicle_identity_basis!=='current_representative_parent_record'
      ||!nullableText(r.vehicle_identity.make)||!nullableText(r.vehicle_identity.model)
      ||!(r.vehicle_identity.year===null||Number.isSafeInteger(r.vehicle_identity.year))
      ||!nullableText(r.source_outcome)||!['sold','no_sale','withdrawn','unresolved'].includes(r.recorded_outcome_class)
      ||!count(r.exact_registered_model_count)||r.matching_model_keys_limit!==20||!Array.isArray(r.matching_model_ids)
      ||r.matching_model_ids.length!==Math.min(r.exact_registered_model_count,20)||r.matching_model_ids.some(v=>!uuid(v))
      ||new Set(r.matching_model_ids).size!==r.matching_model_ids.length||r.matching_model_keys_truncated!==(r.exact_registered_model_count>20)
      ||(r.exact_registered_model_count===0?r.matching_model_keys_fingerprint!==null:!(/^[a-f0-9]{32}$/).test(r.matching_model_keys_fingerprint??''))
      ||!Number.isFinite(Date.parse(r.event_at))||Date.parse(r.event_at)<Date.parse(data.event_from)||Date.parse(r.event_at)>=Date.parse(data.event_to)
      ||!['direct_fetch','cached_snapshot','unknown'].includes(r.source_read_basis)
      ||(r.source_read_basis==='unknown'?r.source_observed_at!==null:!r.source_observed_at||!Number.isFinite(Date.parse(r.source_observed_at))
        ||Date.parse(r.source_observed_at)>Date.parse(data.knowledge_cutoff)))return fail();
    ids.add(r.auction_event_id);urls.add(r.source_url);seenReasons.set(r.membership_reason,1+(seenReasons.get(r.membership_reason)??0));
  }
  if([...seenReasons].some(([reason,n])=>n>reasons.get(reason)!))return fail();
}

export function useSalesScopes() {
  return useQuery({ queryKey: ['market-recorded-sales-scopes'], queryFn: fetchSalesScopes,
    staleTime: 30 * 60_000, retry: false, refetchOnWindowFocus: false });
}

/** A cold cache can carry one read past get_market_trends' 5 s statement_timeout, and that read warms the cache, so one
 *  retry answers (2026-10-15, logged out: the 7-day Porsche read took 4.2 s cold, 0.9 s warm, and 5.1 s → HTTP 500 at
 *  06:46Z). Any other failure, or a second timeout, is shown as it is. */
export const retryColdTimeout = (failureCount: number, error: unknown) =>
  failureCount < 1 && (error as { code?: unknown } | null)?.code === '57014';

export function useRecordedSales(request: SalesRequest | null) {
  return useQuery({ queryKey: ['market-recorded-sales', request], enabled: request != null,
    queryFn: () => fetchRecordedSales(request!), staleTime: 60_000, retry: retryColdTimeout, refetchOnWindowFocus: false,
    // Keep the chart while a focused evidence read arrives, but never carry one population into another.
    placeholderData: (data, previousQuery) => {
      const previous = previousQuery?.queryKey[1] as SalesRequest | null | undefined;
      return request && previous && request.metric === previous.metric
        && request.event_from === previous.event_from && request.event_to === previous.event_to
        && JSON.stringify(request.scope) === JSON.stringify(previous.scope) ? data : undefined;
    } });
}
