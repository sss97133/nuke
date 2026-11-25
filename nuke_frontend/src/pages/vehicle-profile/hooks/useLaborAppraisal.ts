import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { bounded } from '../../../services/accountingCloseout';

/** One reassembly part the reader matched (or could not match) to a book operation. Words come from the reader when it carries them. */
export interface LaborPart {
  item_id: string; hours: number | null; operation_code?: string | null; system?: string | null; counted_in?: string | null;
  reason?: string | null; description?: string | null; name?: string | null; day?: string | null;
}
export interface LaborStageStep {
  from_stage?: string | null; to_stage?: string | null; zone?: string | null; status?: string | null; photo_phase?: string | null;
  images?: number | null; hours_min?: number | null; hours_typical?: number | null; hours_max?: number | null;
  panel_count?: number | null; mode?: string | null;
}
export interface LaborRange { hours_min: number | null; hours_typical: number | null; hours_max: number | null }
/** One segment of vehicle_labor_appraisal, as the reader returns it. */
export interface LaborSegment extends LaborRange {
  segment: string; category?: string | null; status?: string | null; citation?: string | null;
  hours_basis?: string | null; paper_hours?: number | null; book_hours?: LaborRange | null; range_below_paper?: boolean | null;
  evidence_grade?: string | null; evidence_count?: number | null; stage_steps?: LaborStageStep[] | null;
  hours_counted_elsewhere?: number | null; fitted_parts?: number | null;
  reassembly?: { matched?: LaborPart[]; unmatched?: LaborPart[]; matched_count?: number; unmatched_count?: number } | null;
}
export interface LaborAppraisal {
  vehicle_id: string; as_of: string | null; logic_version: string | null; applicable: boolean;
  segments: LaborSegment[];
  /** The reader's per-grade sums. The blended totals beside them are never printed. */
  totals: (LaborRange & { by_grade?: Record<string, LaborRange> | null }) | null;
}

/** The labor appraisal by segment, computed by the database. No arithmetic happens here. */
export function useLaborAppraisal(vehicleId: string) {
  const { user, loading: authLoading } = useAuthContext();
  return useQuery({
    queryKey: ['vehicle-labor-appraisal', vehicleId, user?.id ?? 'anonymous'],
    enabled: !!vehicleId && !authLoading, staleTime: 300_000, retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await bounded(requestSignal => supabase.rpc('vehicle_labor_appraisal', { p_vehicle_id: vehicleId })
        .abortSignal(requestSignal), signal);
      if (error) throw new Error('Labor appraisal could not be read');
      if (!data || !Array.isArray(data.segments)) return null;
      return data as LaborAppraisal;
    },
  });
}
