import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface VideoMoment {
  id: string;
  lot_number: string;
  source: string;
  source_url: string | null;
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

const YOUTUBE_SOURCE_ID = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4';

interface BroadcastPresentation {
  id: string;
  vehicle_id: string | null;
  structured_data?: {
    media?: { video_id?: string; start_seconds?: number; end_seconds?: number };
    value?: { lot?: string; sale_displayed?: string | null; displayed_outcome?: string };
    event_context?: { auction_house?: string; auction?: string | null };
  };
}

/** A lot presentation read from the broadcast overlay. The displayed bid is not a hammer price, so it
 * never fills winning_bid; the outcome is what the screen showed. */
export function momentFromPresentation(o: BroadcastPresentation): VideoMoment | null {
  const media = o.structured_data?.media;
  const value = o.structured_data?.value;
  if (!media?.video_id || typeof media.start_seconds !== 'number') return null;
  const outcome = value?.displayed_outcome;
  return {
    id: o.id,
    lot_number: value?.lot ?? '',
    source: (o.structured_data?.event_context?.auction_house ?? 'youtube').replace('_', '-'),
    source_url: null,
    auction_name: o.structured_data?.event_context?.auction ?? value?.sale_displayed ?? null,
    auction_start_date: null,
    winning_bid: null,
    outcome: outcome && outcome !== 'unknown' ? outcome : null,
    broadcast_video_url: `https://www.youtube.com/watch?v=${media.video_id}`,
    broadcast_timestamp_start: media.start_seconds,
    broadcast_timestamp_end: typeof media.end_seconds === 'number' ? media.end_seconds : null,
    estimate_low: null,
    estimate_high: null,
    vehicle_id: o.vehicle_id,
  };
}

const videoKey = (m: VideoMoment) =>
  `${m.broadcast_video_url.match(/[A-Za-z0-9_-]{11}(?=$|[&?#])/)?.[0]}:${Math.round(m.broadcast_timestamp_start / 60)}`;

export function useVehicleVideos(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle-videos', vehicleId],
    queryFn: async () => {
      // 2026-05-24 dead-query-sweep: removed `auction_name` from select — column does
      // not exist on auction_events (caused 400). The VideoMoment shape keeps the
      // field nullable; consumer renders null gracefully.
      const [events, presentations] = await Promise.all([
        supabase
          .from('auction_events')
          .select(`
            id, lot_number, source, source_url, auction_start_date,
            winning_bid, outcome, estimate_low, estimate_high, vehicle_id,
            broadcast_video_url, broadcast_timestamp_start, broadcast_timestamp_end
          `)
          .eq('vehicle_id', vehicleId)
          .not('broadcast_video_url', 'is', null)
          .not('broadcast_timestamp_start', 'is', null)
          .order('auction_start_date', { ascending: false }),
        supabase
          .from('vehicle_observations')
          .select('id, vehicle_id, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('source_id', YOUTUBE_SOURCE_ID)
          .eq('structured_data->>property', 'broadcast_lot_presentation')
          .eq('is_superseded', false)
          .order('observed_at', { ascending: false }),
      ]);

      if (events.error) throw events.error;
      const moments = (events.data || []).filter(video => video.vehicle_id === vehicleId) as VideoMoment[];
      // A failing broadcast read must not hide the recorded clips.
      const seen = new Set(moments.map(videoKey));
      for (const o of (presentations.error ? [] : presentations.data || []) as BroadcastPresentation[]) {
        const m = o.vehicle_id === vehicleId ? momentFromPresentation(o) : null;
        if (m && !seen.has(videoKey(m))) { seen.add(videoKey(m)); moments.push(m); }
      }
      return moments;
    },
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export type { VideoMoment };
