import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface VideoMoment {
  id: string;
  lot_number: string;
  source: string;
  auction_name: string | null;
  auction_start_date: string | null;
  winning_bid: number | null;
  outcome: string | null;
  broadcast_video_url: string;
  broadcast_timestamp_start: number;
  broadcast_timestamp_end: number | null;
  estimate_low: number | null;
  estimate_high: number | null;
  vehicle_id: string | null;
}

export function useVehicleVideos(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle-videos', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auction_events')
        .select(`
          id, lot_number, source, auction_name, auction_start_date,
          winning_bid, outcome, estimate_low, estimate_high, vehicle_id,
          broadcast_video_url, broadcast_timestamp_start, broadcast_timestamp_end
        `)
        .eq('vehicle_id', vehicleId)
        .not('broadcast_video_url', 'is', null)
        .not('broadcast_timestamp_start', 'is', null)
        .order('auction_start_date', { ascending: false });

      if (error) throw error;
      return (data || []) as VideoMoment[];
    },
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export type { VideoMoment };
