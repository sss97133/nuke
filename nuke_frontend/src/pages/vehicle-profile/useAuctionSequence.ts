/**
 * useAuctionSequence — the rows behind a BaT lot's week (one sequence per listing
 * when the car ran more than once). Shared query invalidation follows the
 * current-cache Realtime delivery, so an open timeline follows native changes.
 *
 * Parent-gated indexed reads on vehicle_id (auction_comments, auction_events,
 * vehicle_events, vehicle_images with only id/taken_at/source), only for a
 * vehicle that carries a BaT lot; anything else returns null without a query.
 * The sequence itself is built by auctionSequence.ts, which never reads
 * created_at.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  buildAuctionSequences, type AuctionCommentRow, type AuctionEventRow, type AuctionSequence,
  type ImageStampRow, type TimelineEventLike, type VehicleEventRow,
} from './auctionSequence';

interface RawRows {
  comments: AuctionCommentRow[];
  auctionEvents: AuctionEventRow[];
  vehicleEvents: VehicleEventRow[];
  images: ImageStampRow[];
}

const BAT_LOT = /bringatrailer\.com\/listing\//i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Complete the currently readable native collection; never publish a partial prefix. */
export async function fetchNativeAuctionComments(
  vehicleId: string,
  signal?: AbortSignal,
  { maxRows = 10_000, timeBudgetMs = 20_000 } = {},
): Promise<AuctionCommentRow[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeBudgetMs);
  const rows: AuctionCommentRow[] = [];
  let after: string | undefined;
  try {
    for (let page = 0; page < 100; page++) {
      if (controller.signal.aborted) throw new Error('auction_activity_read_incomplete');
      let query = supabase.from('auction_comments')
        .select('id,vehicle_id,posted_at,comment_type,bid_amount,author_username,is_seller,comment_text,bat_comment_id,source_url,sequence_number,comment_likes')
        .eq('vehicle_id', vehicleId).order('id', { ascending: true }).limit(250)
        .abortSignal(controller.signal);
      if (after) query = query.gt('id', after);
      const response = await query;
      if (response.error || !Array.isArray(response.data)) throw new Error('auction_activity_read_incomplete');
      if (!response.data.length) return rows;
      if (rows.length + response.data.length > maxRows) throw new Error('auction_activity_read_incomplete');
      for (const row of response.data) {
        if (!UUID.test(row.id) || row.vehicle_id !== vehicleId || (after && row.id <= after)) {
          throw new Error('auction_activity_read_incomplete');
        }
        rows.push(row as unknown as AuctionCommentRow);
        after = row.id;
      }
      // Even a short page can be a server cap. Seek until an empty next page.
      // UUID pagination retains unknown clocks and does not round microseconds.
    }
    throw new Error('auction_activity_read_incomplete');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** True when the vehicle row or its timeline says this car was a BaT lot. */
export function looksLikeBatLot(vehicle: Record<string, unknown> | null | undefined, timelineEvents: TimelineEventLike[]): string | null {
  for (const k of ['listing_url', 'bat_auction_url', 'discovery_url', 'platform_url']) {
    const u = vehicle?.[k];
    if (typeof u === 'string' && BAT_LOT.test(u)) return u;
  }
  const ev = timelineEvents.find(t => /^auction_/.test(String(t.event_type ?? '')) && /bat|bring a trailer/i.test(`${t.source ?? ''} ${t.data_source ?? ''}`));
  return ev ? '' : null;
}

async function fetchRows(vehicleId: string, signal?: AbortSignal): Promise<RawRows> {
  let parentQuery = supabase.from('vehicles').select('id').eq('id', vehicleId).limit(1);
  if (signal) parentQuery = parentQuery.abortSignal(signal);
  const parent = await parentQuery;
  if (parent.error || parent.data?.length !== 1 || parent.data[0].id !== vehicleId) {
    throw new Error('auction_parent_unavailable');
  }
  if (signal?.aborted) throw new Error('auction_activity_read_incomplete');
  const [comments, auctionEvents, vehicleEvents, images] = await Promise.all([
    fetchNativeAuctionComments(vehicleId, signal),
    supabase
      .from('auction_events')
      .select('id,source,source_url,lot_number,outcome,winning_bid,total_bids,winning_bidder,seller_name,page_views,watchers,comments_count')
      .eq('vehicle_id', vehicleId)
      .limit(5),
    supabase
      .from('vehicle_events')
      .select('id,source_platform,source_url,started_at,ended_at,sold_at,final_price,event_status')
      .eq('vehicle_id', vehicleId)
      .limit(10),
    supabase
      .from('vehicle_images')
      .select('id,taken_at,source,source_url')
      .eq('vehicle_id', vehicleId)
      .not('is_duplicate', 'is', true)
      .limit(2000),
  ]);
  for (const r of [auctionEvents, vehicleEvents, images]) if (r.error) throw new Error('auction_context_unavailable');
  return {
    comments,
    auctionEvents: (auctionEvents.data ?? []) as unknown as AuctionEventRow[],
    vehicleEvents: (vehicleEvents.data ?? []) as unknown as VehicleEventRow[],
    images: (images.data ?? []) as unknown as ImageStampRow[],
  };
}

export function useAuctionSequence(
  vehicleId: string | undefined,
  vehicle: Record<string, unknown> | null | undefined,
  timelineEvents: TimelineEventLike[],
): { auctions: AuctionSequence[]; importStampedDays: string[]; loading: boolean; activityUnavailable: boolean; hasUnpositionedActivity: boolean } {
  const lotHint = useMemo(() => looksLikeBatLot(vehicle, timelineEvents), [vehicle, timelineEvents]);
  const { data: rows, isLoading: loading, isError } = useQuery({
    queryKey: ['auction-sequence', vehicleId],
    queryFn: ({ signal }) => fetchRows(vehicleId!, signal),
    enabled: !!vehicleId && lotHint !== null,
    staleTime: 60_000,
    retry: false,
  });

  const built = useMemo(() => {
    if (!rows || lotHint === null || isError) return null;
    return buildAuctionSequences({ ...rows, timelineEvents, lotUrlHint: lotHint || null });
  }, [rows, lotHint, timelineEvents, isError]);

  const hasUnpositionedActivity = !!built && !!rows?.comments.some(c => !c.posted_at || !Number.isFinite(Date.parse(c.posted_at)));
  return { auctions: built?.sequences ?? [], importStampedDays: built?.importStampedDays ?? [], loading,
    activityUnavailable: isError && lotHint !== null, hasUnpositionedActivity };
}
