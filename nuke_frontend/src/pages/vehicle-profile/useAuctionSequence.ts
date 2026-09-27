/**
 * useAuctionSequence — the rows behind a BaT lot's week (one sequence per listing
 * when the car ran more than once), read once per vehicle.
 *
 * Four indexed reads on vehicle_id (auction_comments, auction_events,
 * vehicle_events, vehicle_images with only id/taken_at/source), only for a
 * vehicle that carries a BaT lot; anything else returns null without a query.
 * The sequence itself is built by auctionSequence.ts, which never reads
 * created_at.
 */

import { useEffect, useMemo, useState } from 'react';
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

const cache = new Map<string, RawRows>();

const BAT_LOT = /bringatrailer\.com\/listing\//i;

/** True when the vehicle row or its timeline says this car was a BaT lot. */
export function looksLikeBatLot(vehicle: Record<string, unknown> | null | undefined, timelineEvents: TimelineEventLike[]): string | null {
  for (const k of ['listing_url', 'bat_auction_url', 'discovery_url', 'platform_url']) {
    const u = vehicle?.[k];
    if (typeof u === 'string' && BAT_LOT.test(u)) return u;
  }
  const ev = timelineEvents.find(t => /^auction_/.test(String(t.event_type ?? '')) && /bat|bring a trailer/i.test(`${t.source ?? ''} ${t.data_source ?? ''}`));
  return ev ? '' : null;
}

async function fetchRows(vehicleId: string): Promise<RawRows> {
  const [comments, auctionEvents, vehicleEvents, images] = await Promise.all([
    supabase
      .from('auction_comments')
      .select('id,posted_at,comment_type,bid_amount,author_username,is_seller,comment_text,bat_comment_id,source_url,sequence_number,comment_likes')
      .eq('vehicle_id', vehicleId)
      .order('posted_at', { ascending: true })
      .limit(2000),
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
  for (const r of [comments, auctionEvents, vehicleEvents, images]) if (r.error) throw r.error;
  return {
    comments: (comments.data ?? []) as unknown as AuctionCommentRow[],
    auctionEvents: (auctionEvents.data ?? []) as unknown as AuctionEventRow[],
    vehicleEvents: (vehicleEvents.data ?? []) as unknown as VehicleEventRow[],
    images: (images.data ?? []) as unknown as ImageStampRow[],
  };
}

export function useAuctionSequence(
  vehicleId: string | undefined,
  vehicle: Record<string, unknown> | null | undefined,
  timelineEvents: TimelineEventLike[],
): { auctions: AuctionSequence[]; importStampedDays: string[]; loading: boolean } {
  const lotHint = useMemo(() => looksLikeBatLot(vehicle, timelineEvents), [vehicle, timelineEvents]);
  const [rows, setRows] = useState<RawRows | null>(vehicleId ? cache.get(vehicleId) ?? null : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vehicleId || lotHint === null) return;
    const cached = cache.get(vehicleId);
    if (cached) { setRows(cached); return; }
    let cancelled = false;
    setLoading(true);
    fetchRows(vehicleId)
      .then(r => { cache.set(vehicleId, r); if (!cancelled) setRows(r); })
      .catch(e => console.warn('[useAuctionSequence]', e?.message ?? e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId, lotHint]);

  const built = useMemo(() => {
    if (!rows || lotHint === null) return null;
    return buildAuctionSequences({ ...rows, timelineEvents, lotUrlHint: lotHint || null });
  }, [rows, lotHint, timelineEvents]);

  return { auctions: built?.sequences ?? [], importStampedDays: built?.importStampedDays ?? [], loading };
}
