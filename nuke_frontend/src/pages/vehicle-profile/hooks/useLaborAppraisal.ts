import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { bounded } from '../../../services/accountingCloseout';

/** One reassembly part the reader matched (or could not match) to a book operation. Words come from the reader when it carries them. */
export interface LaborPart {
  item_id: string; hours: number | null; operation_code?: string | null; system?: string | null; counted_in?: string | null;
  reason?: string | null; description?: string | null; name?: string | null; day?: string | null;
  /** The catalog part the piece resolves to (catalog_parts key). Absent when the piece has no catalog row. */
  part?: { catalog_part_id: string; name: string | null } | null;
  /** fitted | not_fitted | unwitnessed; an unwitnessed piece carries the state of its fitted question. */
  witness?: string | null; question_state?: string | null;
}
export interface LaborStageStep {
  from_stage?: string | null; to_stage?: string | null; zone?: string | null; status?: string | null; photo_phase?: string | null;
  images?: number | null; hours_min?: number | null; hours_typical?: number | null; hours_max?: number | null;
  panel_count?: number | null; mode?: string | null; pieces?: LaborPart[] | null;
  /** stage_transition_labor_map key; its words are in the reader's names.transitions. */
  transition_id?: string | null;
}
export interface LaborRange { hours_min: number | null; hours_typical: number | null; hours_max: number | null }
/** One segment of vehicle_labor_appraisal, as the reader returns it. */
export interface LaborSegment extends LaborRange {
  segment: string; category?: string | null; status?: string | null; citation?: string | null;
  hours_basis?: string | null; paper_hours?: number | null; book_hours?: LaborRange | null; range_below_paper?: boolean | null;
  evidence_grade?: string | null; evidence_count?: number | null; stage_steps?: LaborStageStep[] | null;
  hours_counted_elsewhere?: number | null; fitted_parts?: number | null;
  /** witnessed | unwitnessed_purchase: which of the reader's two totals this segment's hours belong to. */
  counts_in?: string | null; counted_in?: string | null;
  witnessed_hours_min?: number | null; witnessed_hours_typical?: number | null; witnessed_hours_max?: number | null;
  /** The reader's witness counts for the segment's pieces (from 20261124214500), with the pieces themselves. */
  witness_share?: {
    pieces?: LaborPart[] | null; fitted_with_operation?: number | null; fitted_without_operation?: number | null;
    not_fitted?: number | null; unwitnessed?: number | null; cannot_tell?: number | null; none_raised?: number | null;
  } | null;
  witnessed_reason?: string | null;
  reassembly?: { matched?: LaborPart[]; unmatched?: LaborPart[]; matched_count?: number; unmatched_count?: number } | null;
}
export interface LaborAppraisal {
  vehicle_id: string; as_of: string | null; logic_version: string | null; applicable: boolean;
  segments: LaborSegment[];
  /** The reader's per-grade sums. The blended totals beside them are never printed. */
  totals: (LaborRange & {
    by_grade?: Record<string, LaborRange> | null;
    /** The reader's two totals, side by side: hours witnessed, and hours including purchases not seen fitted. */
    /** max_witnessed false: the reader says its max is not witnessed (a book bound), so only the floor and typical are. */
    /** unknown_max_segments (from 20261125033000): segments whose witnessed max is unknown, so hours_max is not a bound. */
    witnessed?: (LaborRange & { unknown_min_segments?: number | null; unknown_max_segments?: number | null; max_witnessed?: boolean | null }) | null; with_unwitnessed_purchases?: LaborRange | null;
    priced_segments?: number | null; unwitnessed_purchase_segments?: number | null; rule?: string | null;
  }) | null;
  /** The keys' words, read from their own rows (20261125073000): transitions by transition_id, operations by code. */
  names?: LaborNames | null;
}
export interface LaborNames {
  transitions?: Record<string, { label?: string | null; category?: string | null; from_stage?: string | null; to_stage?: string | null }> | null;
  operations?: Record<string, { name?: string | null }> | null;
}

/** The labor appraisal by segment, computed by the database. No arithmetic happens here. */
export function useLaborAppraisal(vehicleId: string) {
  const { user, loading: authLoading } = useAuthContext();
  return useQuery({
    queryKey: ['vehicle-labor-appraisal', vehicleId, user?.id ?? 'anonymous'],
    enabled: !!vehicleId && !authLoading, staleTime: 300_000,
    // The reader takes 3 s alone and 12 s or more while the print reads every section; one slow answer must not
    // print as "could not load". Retries keep isFetching up, so the print waits for them.
    retry: 2, retryDelay: (attempt) => 1_500 * 2 ** attempt,
    queryFn: async ({ signal }) => {
      const { data, error } = await bounded(requestSignal => supabase.rpc('vehicle_labor_appraisal', { p_vehicle_id: vehicleId })
        .abortSignal(requestSignal), signal);
      if (error) throw new Error('Labor appraisal could not be read');
      if (!data || !Array.isArray(data.segments)) return null;
      return data as LaborAppraisal;
    },
  });
}
