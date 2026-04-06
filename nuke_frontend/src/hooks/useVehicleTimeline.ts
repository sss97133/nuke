import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useVehicleTimeline(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle-timeline', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_timeline_events')
        .select(`
          *,
          images:timeline_event_images(id, event_id, image_url, image_context, category),
          participants:timeline_event_participants(
            id, role, display_name,
            organization:businesses(id, business_name),
            profile:profiles(id, full_name, username)
          ),
          locations:timeline_event_locations(
            id, location_type, display_name, latitude, longitude
          ),
          proofs:timeline_event_proofs(
            id, proof_type, description, url, file_path
          )
        `)
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!vehicleId,
    staleTime: 2 * 60 * 1000,
  });
}
