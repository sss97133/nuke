import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { bounded } from '../../../services/accountingCloseout';

export interface BuildLine {
  item_id: string; receipt_id: string; kind: 'part' | 'labor' | 'note' | 'service' | 'backordered' | 'kit_component';
  day: string | null; source: string | null; description: string | null; part_number: string | null;
  paper_hours: number | null; operation_code: string | null; amount: number | null;
}
export interface BuildStage { phase: string; images: number; prints: number; first_day: string | null; last_day: string | null;
  sample: { image_id: string; image_url: string }[] | null;
  reference: { description: string; hours_typical: number | null; hours_min: number | null; hours_max: number | null; confidence: string | null; source: string; transition: string } | null }
export interface BuildSystem {
  system_key: string; first_day: string | null; last_day: string | null; part_lines: number; backordered_lines: number;
  suppliers: string[];
  paper: { lines: number; lines_without_hours: number; hours: number | null; performers: number; shops: string[]; subjects?: string[] | null };
  reference: { hours: number | null; parts_without_reference: number;
    operations: { code: string; name: string; hours: number; part_lines: number; basis: 'part_on_receipt' | 'implied_by_machine_shop_work' }[] };
  priced_lines: number; recorded_amount: number | null; lines: BuildLine[] | null;
  /** Build stages a reviewed photo reading names for this system, each with the stored hour range for that stage. */
  stages?: BuildStage[] | null;
  /** Photographs whose part-keyed readings name this system; absent before the reader carries them. */
  photos?: { images: number; readings: number; first_day: string | null; last_day: string | null;
    sample: { image_id: string; image_url: string }[] | null } | null;
}
export interface BuildReconstruction {
  version: number; as_of: string; amounts_visible: boolean; rule: string; systems_without_paper: string[];
  totals: { lines: number; placed_lines: number; receipts: number; first_day: string | null; last_day: string | null;
    part_lines: number; paper_work_lines: number; paper_hours: number | null; reference_hours: number | null;
    reference_operations: number; parts_without_reference: number; recorded_amount: number | null; photo_images?: number; stage_images?: number | null;
    stage_hours?: { typical: number | null; min: number | null; max: number | null; stages: number } | null };
  systems: BuildSystem[];
}

/** The build per car system, computed by the database from the vehicle's receipt lines. No arithmetic happens here. */
export function useBuildReconstruction(vehicleId: string) {
  const { user, loading: authLoading } = useAuthContext();
  return useQuery({
    queryKey: ['vehicle-build-reconstruction', vehicleId, user?.id ?? 'anonymous'],
    enabled: !!vehicleId && !authLoading, staleTime: 60_000, retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await bounded(requestSignal => supabase.rpc('vehicle_build_reconstruction', { p_vehicle_id: vehicleId })
        .abortSignal(requestSignal), signal);
      if (error) throw new Error('Build record could not be read');
      if (!data || data.version !== 1 || !Array.isArray(data.systems) || !data.totals) return null;
      return data as BuildReconstruction;
    },
  });
}

export interface PartEvidenceLine { item_id: string; status: 'seen' | 'seen_in_prints_only' | 'not_photographed'; seen_images: number;
  first_day: string | null; last_day: string | null; seen: { image_id: string; image_url: string; words?: string | null }[] | null }
export interface PartEvidence { limitation: string; totals: { part_lines: number; lines_seen: number; lines_not_photographed: number }; lines: PartEvidenceLine[] }

/** Per bought part, the photographs whose readings name that part on the car. Read after the build record; the page works without it. */
export function usePartEvidence(vehicleId: string, enabled: boolean) {
  const { user, loading: authLoading } = useAuthContext();
  return useQuery({
    queryKey: ['vehicle-part-installation-evidence', vehicleId, user?.id ?? 'anonymous'],
    enabled: enabled && !!vehicleId && !authLoading, staleTime: 300_000, retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await bounded(requestSignal => supabase.rpc('vehicle_part_installation_evidence', { p_vehicle_id: vehicleId })
        .abortSignal(requestSignal), signal);
      if (error || !data || data.version !== 1 || !Array.isArray(data.lines)) return null;
      return data as PartEvidence;
    },
  });
}
