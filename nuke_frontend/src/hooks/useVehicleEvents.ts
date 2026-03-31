import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useVehicleEvents(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicle-events', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_events')
        .select('*')
        .eq('vehicle_id', vehicleId!)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!vehicleId,
    staleTime: 2 * 60 * 1000,
  });
}
