import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { bounded } from '../../../services/accountingCloseout';

export interface VisualWork {
  observation_id: string; title: string; summary: string; gaps: string[];
  images: { image_id: string; image_url: string; role: 'before' | 'during' | 'after'; caption: string; taken_at: string;
    capture_time_zone?: string | null; capture_time_basis?: string | null }[];
  receipts: { item_id: string; receipt_id: string; relation: 'candidate_material' | 'documented_operation';
    source_table: 'vehicle_documents' | 'vehicle_images'; source_id: string; vendor: string | null;
    page_date: string | null; description: string | null; part_number: string | null; quantity: number | null;
    hours: number | null; amount: number | null; currency: string | null; amounts_visible: boolean }[];
  receipt_links_unavailable: number;
  effort_reference: { reference_id: string; description: string; hours_min: number; hours_max: number; hours_typical: number;
    basis: 'seed_uncalibrated' } | null;
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
      return { rows: (data.visual_work ?? []) as VisualWork[], limited: data.visual_work_coverage === 'limit_reached' };
    },
  });
  // A prior viewer's or failed refresh's source permissions never survive in the card.
  return { ...query, rows: authLoading || query.isError || query.isFetching ? [] : query.data?.rows ?? [],
    limited: !authLoading && !query.isError && query.data?.limited === true };
}
