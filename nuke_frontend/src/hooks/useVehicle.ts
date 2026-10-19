import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useVehicle(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      // The row as the caller may see it: hidden rows read as null, the owner's purchase facts as null
      // unless the caller is the owner (a select('*') on vehicles is not granted).
      const { data, error } = await supabase.rpc('vehicle_row_read', { p_vehicle_id: vehicleId! });
      if (error) throw error;
      if (!data) throw new Error('Vehicle not found');
      return data;
    },

    enabled: !!vehicleId,
    staleTime: 2 * 60 * 1000, // 2 min
  });
}
