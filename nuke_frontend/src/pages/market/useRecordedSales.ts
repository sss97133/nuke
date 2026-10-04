import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export type SalesSeries = 'selected' | 'benchmark';
export type SalesScope = { kind: 'canonical_make'; canonical_make_id: string }
  | { kind: 'supported_subject'; subject_id: string };
export interface SalesScopeOption { key: string; label: string; make: string; scope: SalesScope }
export interface SalesWindow { event_from: string; event_to: string }
export interface SalesDrill { bucket: string; series: SalesSeries }
export interface SalesRequest extends SalesWindow {
  metric: 'recorded_sale_events'; source_registry_slug: 'bringatrailer';
  benchmark: 'same_platform_excluding_scope'; scope: SalesScope; evidence_limit: number;
  evidence_bucket?: string; evidence_series?: SalesSeries;
}
export interface SalesPoint {
  bucket_start: string; series: SalesSeries; value: number | null; denominator: number | null;
  ratio: number | null; absolute_change: number | null; relative_change: number | null;
  source_observed_at: string | null;
  coverage: {
    captured_eligible: number | null; ended_pending: number | null; explicit_no_sale: number | null;
    bid_to: number | null; sold_without_supported_amount: number | null;
    source_clock_known: number | null; source_clock_unknown: number | null;
    incomplete_bucket: boolean; bucket_elapsed_seconds: number; full_bucket_seconds: number;
  };
}
export interface SalesContributor {
  auction_event_id: string; vehicle_id: string; source_url: string; event_at: string;
  bucket_start: string; series: SalesSeries; source_read_basis: string;
  source_observed_at: string | null; latest_source_row_write: string | null;
}
export interface RecordedSalesReceipt extends SalesWindow {
  contract_version: number; metric_id: string; state: 'partial'; reason: string;
  scope: { label?: string; comparison_basis?: string; comparison_scope_basis?: string };
  knowledge_cutoff: string; knowledge_mode: string; generated_at: string;
  candidate_limit: number; captured_candidates: number; truncated: boolean;
  coverage: {
    unresolved_scope: number | null; conflicting_alias_episodes: number | null;
    eligible_recorded_episodes: number | null; complete_external_capture: boolean;
  };
  series: SalesPoint[];
  evidence: { has_more: boolean; per_bucket_series_limit: number; pagination_supported: boolean;
    contributors: SalesContributor[] };
}
export type SalesResponse = RecordedSalesReceipt | { state: 'unavailable'; reason: string };

/** Full UTC days: today is excluded, so even seven days stays within the RPC's limit. */
export function recordedSalesWindow(days: 2 | 7, now = Date.now()): SalesWindow {
  const date = new Date(now);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { event_from: new Date(end - days * 86_400_000).toISOString(), event_to: new Date(end).toISOString() };
}

export function recordedSalesRequest(scope: SalesScope, window: SalesWindow, drill: SalesDrill | null): SalesRequest {
  return { metric: 'recorded_sale_events', source_registry_slug: 'bringatrailer',
    benchmark: 'same_platform_excluding_scope', scope, ...window, evidence_limit: 20,
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
    supabase.from('canonical_makes').select('id,canonical_name').order('canonical_name').limit(201),
    supabase.from('make_model_profiles')
      .select('subject_id,canonical_make,canonical_model,grain,year,year_start,year_end')
      .eq('comparison_scope_status', 'supported').order('subject_id').limit(101),
  ]);
  if (makes.error) throw makes.error;
  if (subjects.error) throw subjects.error;
  if ((makes.data?.length ?? 0) > 200 || (subjects.data?.length ?? 0) > 100) throw new Error('Scope catalog exceeds its display limit');
  const options: SalesScopeOption[] = (makes.data ?? []).map(m => ({ key: `make:${m.id}`,
    label: m.canonical_name, make: m.canonical_name, scope: { kind: 'canonical_make', canonical_make_id: m.id } }));
  for (const s of subjects.data ?? []) {
    const years = s.grain === 'year' ? s.year : `${s.year_start}–${s.year_end}`;
    options.push({ key: `subject:${s.subject_id}`, label: `${s.canonical_make} ${s.canonical_model} · ${years} · supported grouping`,
      make: s.canonical_make, scope: { kind: 'supported_subject', subject_id: s.subject_id } });
  }
  return options;
}

export async function fetchRecordedSales(request: SalesRequest): Promise<SalesResponse> {
  const { data, error } = await supabase.rpc('get_market_trends', { p_request: request });
  if (error) throw error;
  if (data?.state === 'unavailable' && typeof data.reason === 'string') return data as SalesResponse;
  if (!data || data.state !== 'partial' || data.contract_version !== 1 || data.metric_id !== 'recorded_sale_events'
    || !Array.isArray(data.series) || !data.evidence || !Array.isArray(data.evidence.contributors)) {
    throw new Error('Unsupported recorded-sales receipt');
  }
  return data as RecordedSalesReceipt;
}

export function useSalesScopes() {
  return useQuery({ queryKey: ['market-recorded-sales-scopes'], queryFn: fetchSalesScopes,
    staleTime: 30 * 60_000, retry: false, refetchOnWindowFocus: false });
}

export function useRecordedSales(request: SalesRequest | null) {
  return useQuery({ queryKey: ['market-recorded-sales', request], enabled: request != null,
    queryFn: () => fetchRecordedSales(request!), staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
}
