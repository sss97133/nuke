import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useEditHistory(vehicleId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['edit-history', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_edit_history')
        .select(`
          *,
          editor:profiles!vehicle_edit_history_edited_by_fkey(full_name, username)
        `)
        .eq('vehicle_id', vehicleId)
        .order('edited_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!vehicleId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}
