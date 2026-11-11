import type { ReceiptCatalogProduct } from '../CatalogProductReference';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { bounded } from '../../../services/accountingCloseout';

export interface CostRange { min: number | null; typical: number | null; max: number | null }
export interface CostCoverage {
  lines: number; resolved_lines: number; partial_lines: number; unresolved_lines: number;
  excluded_lines: number; duplicate_claims_folded: number; status: string;
}
export interface CostTotals {
  hours: CostRange | null;
  currencies: { currency: string; cost: CostRange; covered_lines: number }[];
  labor_currencies?: { currency: string; cost: CostRange; covered_lines: number }[];
  material_currencies?: { currency: string; cost: CostRange; covered_lines: number }[];
}
export interface MasterCostLine {
  kind: 'labor' | 'material'; physical_key: string; system_key: string; label: string;
  status: 'resolved' | 'partial' | 'unresolved' | 'excluded'; reasons: string[];
  work_observation_ids: string[]; source_observation_ids: string[];
  source_images: VisualWork['images'];
  quantity: { value: number | null; unit: string | null; basis: string | null; derivation?: string } | null;
  reference: Record<string, unknown> | null; pricing: Record<string, unknown> | null;
  rate_basis: Record<string, unknown> | null; evidence_role: string | null;
  hours: CostRange | null; cost: CostRange | null; currency: string | null;
  overlap_group: string | null; selected: boolean | null; shared_access: boolean;
  input_fingerprint: string; claim_count: number; formula: string | Record<string, unknown> | null;
}
export interface MasterCostLedger {
  version: number; as_of: string; scope: string;
  scenarios: { scenario: 'reconstruct_observed' | 'finish_scenario'; rows: MasterCostLine[];
    totals: CostTotals; coverage: CostCoverage;
    systems: { system_key: string; totals: CostTotals; coverage: CostCoverage }[] }[];
  coverage: { source_read_limited: boolean; cards_without_estimates: number; scope_completeness: string };
  current_component_value: { status: string }; documented_charges: { status: string };
}

export interface VisualWork {
  observation_id: string; title: string; summary: string; gaps: string[];
  images: { image_id: string; image_url: string; role: 'before' | 'during' | 'after' | 'context' | 'source'; caption: string; taken_at: string;
    capture_time_zone?: string | null; capture_time_basis?: string | null }[];
  receipts: { product?: ReceiptCatalogProduct | null; item_id: string; receipt_id: string; relation: 'candidate_material' | 'documented_operation';
    source_table: 'vehicle_documents' | 'vehicle_images'; source_id: string; source_url_sha256: string; vendor: string | null;
    page_date: string | null; description: string | null; part_number: string | null; quantity: number | null;
    hours: number | null; amount: number | null; currency: string | null; amounts_visible: boolean }[];
  receipt_links_unavailable: number;
  market_value: { status: 'not_established_by_cited_sources' };
  paid_labor: { status: 'unreconciled' };
  effort_reference: { reference_id: string; description: string; hours_min: number; hours_max: number; hours_typical: number;
    basis: 'seed_uncalibrated' } | null;
}

export interface ComponentReading {
  observation_id: string; quote: string; value?: 'present' | 'absent'; descriptor_id?: string;
  evidence_time: string; recorded_at: string; agreement_status: string;
  clock_basis: 'source_analysis_time'; source_role: 'attributed_retained_image_reading';
  images: (Omit<VisualWork['images'][number], 'taken_at'> & { taken_at: string | null; bbox: [number, number, number, number] })[];
}
export interface ComponentEvidence {
  version: 1; as_of: string;
  expected_population: { status: string; reason?: string };
  coverage: { examined_readings: number; qualified_readings: number; truncated: boolean };
  components: {
    subject_id: string; component_key: string; label: string; identity_basis: 'position_only';
    presence: { status: string; readings: ComponentReading[] };
    condition: { status: string; readings: ComponentReading[] };
    purchase_candidates: {
      receipt_item_id: string; receipt_id: string; source_table: 'vehicle_documents' | 'vehicle_images';
      source_id: string; source_url_sha256: string; description: string; printed_part_number: string;
      printed_quantity: number | null; page_date: string | null; association_basis: string;
      product: ReceiptCatalogProduct | null; documented_amount: number | null; currency: string | null;
      amounts_visible: boolean; installation_status: 'unestablished';
    }[];
    unresolved: string[];
  }[];
}

/** Malformed or withdrawn evidence must not leave an older component conclusion visible. */
export function isComponentEvidence(value: unknown): value is ComponentEvidence {
  const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
  const source = (r: unknown) => object(r) && typeof r.observation_id === 'string' && typeof r.quote === 'string'
    && typeof r.evidence_time === 'string' && Number.isFinite(Date.parse(r.evidence_time))
    && r.clock_basis === 'source_analysis_time' && r.source_role === 'attributed_retained_image_reading'
    && Array.isArray(r.images) && r.images.length > 0 && r.images.every((i: unknown) => object(i)
      && typeof i.image_id === 'string' && typeof i.image_url === 'string' && /^https:\/\//.test(i.image_url)
      && Array.isArray(i.bbox) && i.bbox.length === 4 && i.bbox.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 999)
      && i.bbox[0] < i.bbox[2] && i.bbox[1] < i.bbox[3]);
  return object(value) && value.version === 1 && object(value.expected_population) && object(value.coverage)
    && Array.isArray(value.components) && value.components.every((c: unknown) => object(c)
      && typeof c.subject_id === 'string' && typeof c.component_key === 'string' && typeof c.label === 'string'
      && object(c.presence) && Array.isArray(c.presence.readings) && c.presence.readings.every((r: unknown) => source(r)
        && object(r) && ['present', 'absent'].includes(r.value))
      && object(c.condition) && Array.isArray(c.condition.readings) && c.condition.readings.every(source)
      && Array.isArray(c.unresolved) && c.unresolved.every((r: unknown) => typeof r === 'string')
      && Array.isArray(c.purchase_candidates) && c.purchase_candidates.every((p: unknown) => object(p)
        && typeof p.receipt_item_id === 'string' && ['vehicle_documents', 'vehicle_images'].includes(p.source_table)
        && typeof p.source_id === 'string' && typeof p.source_url_sha256 === 'string' && /^[a-f0-9]{64}$/.test(p.source_url_sha256)
        && typeof p.description === 'string' && typeof p.amounts_visible === 'boolean'));
}

/** The existing build-log reader owns both the source qualification and money masks. */
export function useVisualWork(vehicleId: string) {
  const { user, loading: authLoading } = useAuthContext();
  const query = useQuery({
    queryKey: ['vehicle-visual-work', vehicleId, user?.id ?? 'anonymous'],
    enabled: !!vehicleId && !authLoading, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await bounded(requestSignal => supabase.rpc('vehicle_build_log_public', {
        p_vehicle_id: vehicleId, p_include_reported: false,
      }).abortSignal(requestSignal), signal);
      if (error || !data || !Array.isArray(data.work_records)) throw new Error('Work sources could not be read');
      if (data.visual_work != null && (!Array.isArray(data.visual_work) || data.visual_work.some((row: VisualWork) =>
        !row || typeof row.observation_id !== 'string' || !Array.isArray(row.images) || !Array.isArray(row.receipts) || !Array.isArray(row.gaps)))) {
        throw new Error('Work source response is incomplete');
      }
      if (data.master_ledger != null && (data.master_ledger.version !== 1 || !Array.isArray(data.master_ledger.scenarios)
        || data.master_ledger.scenarios.some((scenario: MasterCostLedger['scenarios'][number]) =>
          !Array.isArray(scenario.rows) || !Array.isArray(scenario.systems) || !scenario.totals || !scenario.coverage))) {
        throw new Error('Cost ledger response is incomplete');
      }
      if (data.component_evidence != null && !isComponentEvidence(data.component_evidence)) throw new Error('Component source response is incomplete');
      return { rows: (data.visual_work ?? []) as VisualWork[], ledger: (data.master_ledger ?? null) as MasterCostLedger | null,
        components: (data.component_evidence ?? null) as ComponentEvidence | null,
        limited: data.visual_work_coverage === 'limit_reached' };
    },
  });
  // A prior viewer's or failed refresh's source permissions never survive in the card.
  return { ...query, rows: authLoading || query.isError || query.isFetching ? [] : query.data?.rows ?? [],
    ledger: authLoading || query.isError || query.isFetching ? null : query.data?.ledger ?? null,
    components: authLoading || query.isError || query.isFetching ? null : query.data?.components ?? null,
    limited: !authLoading && !query.isError && query.data?.limited === true };
}
