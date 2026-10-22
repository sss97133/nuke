import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ScreenAmount { t: number; amount: number }
export interface ReplayComparison {
  id: string; lot: string; title: string; source_url: string;
  start_seconds: number; end_seconds: number; displayed_bids: ScreenAmount[];
  displayed_outcome: string | null; matching_basis: string; differences: string;
}
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
  /** Broadcast overlay only: how many times the displayed bid changed on screen during the presentation. */
  displayed_bid_changes?: number | null;
  displayed_bids?: ScreenAmount[];
  displayed_asks?: ScreenAmount[];
  raw_displayed_bids?: ScreenAmount[];
  screen_status_changes?: { t: number; status: string }[];
  matched_auction_event_id?: string | null;
  comparison_presentations?: ReplayComparison[];
}

const YOUTUBE_SOURCE_ID = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4';

interface BroadcastPresentation {
  id: string;
  vehicle_id: string | null;
  structured_data?: {
    property?: string;
    media?: { video_id?: string; start_seconds?: number; end_seconds?: number };
    value?: { lot?: string; sale_displayed?: string | null; displayed_outcome?: string; bid_ladder?: unknown;
      ask_ladder?: unknown; displayed_bid_readings?: unknown; status_changes?: unknown };
    event_context?: { auction_house?: string; auction?: string | null; resolution_status?: string;
      matched_event?: { table?: string; id?: string } };
  };
}

interface ScreenOutcomeObservation {
  vehicle_id?: string | null;
  structured_data?: {
    property?: unknown;
    value?: unknown;
    media?: { video_id?: unknown; start_seconds?: unknown };
    event_context?: { lot?: unknown };
  };
}

/** Point observations supplement a presentation only inside its exact video/lot interval.
 * They describe the screen's outcome; they never supply a completed sale amount. */
export function withScreenOutcomes(moment: VideoMoment, rows: readonly ScreenOutcomeObservation[]): VideoMoment {
  const videoId = moment.broadcast_video_url.match(/(?:v=|embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1];
  const outcomes = rows.flatMap(row => {
    const data = row.structured_data, t = data?.media?.start_seconds, status = data?.value;
    return row.vehicle_id === moment.vehicle_id && data?.property === 'outcome_label_displayed'
      && data.media?.video_id === videoId
      && String(data.event_context?.lot ?? '').toUpperCase() === moment.lot_number.toUpperCase()
      && typeof t === 'number' && Number.isFinite(t) && t >= moment.broadcast_timestamp_start
      && moment.broadcast_timestamp_end != null && t <= moment.broadcast_timestamp_end
      && typeof status === 'string' && ['sold', 'bid_goes_on', 'no_sale'].includes(status) ? [{ t, status }] : [];
  });
  const changes = [...(moment.screen_status_changes ?? []), ...outcomes];
  const terminal = (status: string) => ['sold', 'bid_goes_on', 'no_sale'].includes(status);
  // Refuse conflicting readings at the same instant rather than selecting by row order.
  return { ...moment, screen_status_changes: changes.filter((step, i) =>
    !changes.some(other => other.t === step.t && other.status !== step.status && terminal(other.status) && terminal(step.status))
    && changes.findIndex(other => other.t === step.t && other.status === step.status) === i).sort((a, b) => a.t - b.t) };
}

/** A lot presentation read from the broadcast overlay. The displayed bid is not a hammer price, so it
 * never fills winning_bid; the outcome is what the screen showed. */
export function momentFromPresentation(o: BroadcastPresentation): VideoMoment | null {
  const media = o.structured_data?.media;
  const value = o.structured_data?.value;
  if (!media?.video_id || typeof media.start_seconds !== 'number' || !Number.isFinite(media.start_seconds) || media.start_seconds < 0) return null;
  const outcome = value?.displayed_outcome;
  const context = o.structured_data?.event_context;
  const ladder = Array.isArray(value?.bid_ladder) ? value.bid_ladder : null;
  const changes = ladder?.filter(step => typeof (step as { amount?: unknown })?.amount === 'number'
    && typeof (step as { t?: unknown })?.t === 'number').length;
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
    displayed_bid_changes: changes ? changes : null,
    displayed_bids: screenAmounts(value?.bid_ladder, media.start_seconds!, media.end_seconds),
    displayed_asks: screenAmounts(value?.ask_ladder, media.start_seconds!, media.end_seconds),
    raw_displayed_bids: screenAmounts(value?.displayed_bid_readings, media.start_seconds!, media.end_seconds),
    screen_status_changes: Array.isArray(value?.status_changes) ? value.status_changes.filter(
      (step): step is { t: number; status: string } => Number.isFinite(step?.t)
        && step.t >= media.start_seconds! && (media.end_seconds == null || step.t <= media.end_seconds)
        && typeof step.status === 'string') : [],
    matched_auction_event_id: context?.resolution_status === 'scoped_event_match'
      && context.matched_event?.table === 'auction_events' ? context.matched_event.id ?? null : null,
  };
}

function screenAmounts(value: unknown, start: number, end?: number): ScreenAmount[] {
  return Array.isArray(value) ? value.filter((step): step is ScreenAmount =>
    Number.isFinite(step?.t) && Number.isFinite(step?.amount) && step.amount >= 0
    && step.t >= start && (end == null || step.t <= end)).sort((a, b) => a.t - b.t) : [];
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
          .in('structured_data->>property', ['broadcast_lot_presentation', 'outcome_label_displayed'])
          .eq('is_superseded', false)
          .order('observed_at', { ascending: false }),
      ]);

      if (events.error) throw events.error;
      const moments = (events.data || []).filter(video => video.vehicle_id === vehicleId) as VideoMoment[];
      // A failing broadcast read must not hide the recorded clips.
      const seen = new Set(moments.map(videoKey));
      for (const o of (presentations.error ? [] : presentations.data || []) as BroadcastPresentation[]) {
        const m = o.vehicle_id === vehicleId && o.structured_data?.property === 'broadcast_lot_presentation'
          ? momentFromPresentation(o) : null;
        // A recorded clip may already occupy this exact event/video position. Add its
        // timed screen evidence only with explicit event binding, never minute proximity.
        const recorded = m && moments.find(event => event.id === m.matched_auction_event_id
          && event.broadcast_video_url === m.broadcast_video_url
          && event.broadcast_timestamp_start === m.broadcast_timestamp_start);
        if (recorded && m) {
          Object.assign(recorded, { displayed_bids: m.displayed_bids, displayed_asks: m.displayed_asks,
            raw_displayed_bids: m.raw_displayed_bids, screen_status_changes: m.screen_status_changes });
          continue;
        }
        if (m && !seen.has(videoKey(m))) { seen.add(videoKey(m)); moments.push(m); }
      }
      const screenRows = presentations.error ? [] : presentations.data || [];
      return moments.map(moment => withScreenOutcomes(moment, screenRows));
    },
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export type { VideoMoment };
