import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useVehicle(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!vehicleId,
    staleTime: 2 * 60 * 1000, // 2 min
  });
}
