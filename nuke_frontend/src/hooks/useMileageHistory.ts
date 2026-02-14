import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useMicroPortalData, type PortalDataState } from '../components/vehicles/micro-portals/useMicroPortalData';

export interface MileagePoint {
  date: string;
  mileage: number;
  type: string;
  title: string;
}

function classifyMileage(data: MileagePoint[]): PortalDataState {
  if (!data || data.length === 0) return 'empty';
  if (data.length <= 2) return 'sparse';
  return 'rich';
}

export function useMileageHistory(vehicleId: string | undefined, enabled: boolean) {
  const fetcher = useCallback(async (): Promise<MileagePoint[]> => {
    if (!vehicleId) return [];

    const { data, error } = await supabase.rpc('get_vehicle_mileage_history', {
      p_vehicle_id: vehicleId,
    });

    if (error) throw error;

    // RPC returns jsonb array of {date, mileage, type, title}
    const rows = (data as MileagePoint[]) || [];
    return Array.isArray(rows) ? rows : [];
  }, [vehicleId]);

  return useMicroPortalData<MileagePoint[]>(
    `mileage-history-${vehicleId}`,
    fetcher,
    classifyMileage,
    enabled && !!vehicleId,
  );
}
