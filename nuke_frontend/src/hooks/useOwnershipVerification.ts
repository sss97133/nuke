import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useOwnershipVerification(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['ownership-verification', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('vehicle_id', vehicleId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!vehicleId,
  });
}
