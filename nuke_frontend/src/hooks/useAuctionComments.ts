import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { auctionSourceUrlVariants, buildAuctionPulseFromExternalListings } from '../pages/vehicle-profile/buildAuctionPulse';

export interface EpisodeInteraction {
  id: string;
  posted_at: string | null;
  comment_type: string | null;
  comment_text: string | null;
  bid_amount: number | null;
  is_seller: boolean | null;
  media_urls: string[] | null;
  bat_comment_id: number | null;
  source_url: string;
}

export const EPISODE_READ_LIMIT = 100;

/** Existing public relations, one exact current listing URL, no semantic/analytical fold. */
export async function readAuctionEpisode(vehicleId: string, expectedSourceUrl?: string | null) {
  const parent = await supabase.from('vehicles')
    .select('id,title,year,make,model,listing_url,auction_end_date')
    .eq('id', vehicleId).eq('is_public', true).is('deleted_at', null).is('merged_into_vehicle_id', null)
    .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item')
    .or('status.is.null,status.neq.merged').maybeSingle();
  if (parent.error) throw parent.error;
  // Comments have a legacy broad public policy. Never read them without an eligible public parent.
  if (!parent.data) return null;
  const vehicle = parent.data;
  const isBatLot = (value: string) => /^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/.test(value);
  let url = String(vehicle.listing_url ?? '').replace(/\/$/, '');
  if (expectedSourceUrl && expectedSourceUrl.replace(/\/$/, '') !== url) {
    if (!isBatLot(expectedSourceUrl)) return null;
    const variants = auctionSourceUrlVariants(expectedSourceUrl);
    const episode = await supabase.from('vehicle_events')
      .select('id,source_platform,source_url,event_type,event_status,ended_at,sold_at,duplicate_of_event_id')
      .eq('vehicle_id', vehicleId).is('duplicate_of_event_id', null)
      .in('source_url', variants).eq('event_type', 'auction').in('source_platform', ['bat', 'bringatrailer'])
      .in('event_status', ['active', 'live']).is('sold_at', null).gt('ended_at', new Date().toISOString()).limit(2);
    if (episode.error) throw episode.error;
    if (!Array.isArray(episode.data) || episode.data.length !== 1) return null;
    const row = episode.data[0];
    const current = buildAuctionPulseFromExternalListings([row], vehicleId);
    if (row.duplicate_of_event_id || row.sold_at || row.event_type !== 'auction'
      || !['bat', 'bringatrailer'].includes(row.source_platform) || !variants.includes(row.source_url)
      || !['active', 'live'].includes(current?.listing_status) || !(Date.parse(current?.end_date || '') > Date.now())) return null;
    url = expectedSourceUrl.replace(/\/$/, '');
  }
  if (!isBatLot(url)) return null;
  const [comments, specs] = await Promise.all([
    supabase.from('auction_comments')
      .select('id,posted_at,comment_type,comment_text,bid_amount,is_seller,media_urls,bat_comment_id,source_url,vehicles!inner(id),canonical:auction_events_canonical(id)').or('auction_event_id.is.null,canonical.not.is.null')
      .eq('vehicle_id', vehicleId).eq('vehicles.is_public', true).is('vehicles.deleted_at', null)
      .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicles' })
      .in('source_url', [url, `${url}/`])
      .order('posted_at', { ascending: false, nullsFirst: false }).order('id')
      .limit(EPISODE_READ_LIMIT + 1),
    supabase.rpc('get_vehicle_specs', { p_vehicle_id: vehicleId }),
  ]);
  if (comments.error) throw comments.error;
  if (specs.error) throw specs.error;
  const rows = comments.data ?? [];
  return {
    vehicle, sourceUrl: `${url}/`,
    interactions: rows.slice(0, EPISODE_READ_LIMIT) as EpisodeInteraction[],
    truncated: rows.length > EPISODE_READ_LIMIT,
    specs: Array.isArray(specs.data) ? specs.data : [],
    fetchedAt: new Date().toISOString(), // Browser response time, not source freshness or historical as-of.
  };
}

export function useAuctionEpisode(vehicleId: string, expectedSourceUrl?: string | null) {
  return useQuery({
    queryKey: ['auction-episode-evidence', vehicleId, expectedSourceUrl?.replace(/\/$/, '') ?? null],
    queryFn: () => readAuctionEpisode(vehicleId, expectedSourceUrl),
    enabled: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId),
    staleTime: 30_000, refetchInterval: 60_000, retry: 1,
  });
}

interface AuctionCommentStats {
  bidCount: number;
  commentCount: number;
  lastBidAt: string | null;
  lastCommentAt: string | null;
  winnerName: string | null;
  sellerUsername: string | null;
}

/**
 * Fetches auction comment statistics for a vehicle.
 * When listingUrl is provided, scopes to that specific listing.
 */
export function useAuctionCommentStats(
  vehicleId: string | undefined,
  listingUrl?: string | null,
) {
  return useQuery({
    queryKey: ['auction-comment-stats', vehicleId, listingUrl ?? null],
    queryFn: async (): Promise<AuctionCommentStats> => {
      const [bidCountRes, commentCountRes, lastBidRes, lastCommentRes, sellerRes] = await Promise.all([
        // bid count
        (() => {
          let q = supabase.from('auction_comments').select('id,canonical:auction_events_canonical(id)', { count: 'exact', head: true }).or('auction_event_id.is.null,canonical.not.is.null').eq('vehicle_id', vehicleId!);
          if (listingUrl) { const url = listingUrl.replace(/\/$/, ''); q = q.in('source_url', [url, `${url}/`]); }
          return q.not('bid_amount', 'is', null);
        })(),
        // comment count (non-bid)
        (() => {
          let q = supabase.from('auction_comments').select('id,canonical:auction_events_canonical(id)', { count: 'exact', head: true }).or('auction_event_id.is.null,canonical.not.is.null').eq('vehicle_id', vehicleId!);
          if (listingUrl) { const url = listingUrl.replace(/\/$/, ''); q = q.in('source_url', [url, `${url}/`]); }
          return q.or('bid_amount.is.null,comment_type.neq.bid');
        })(),
        // last bid
        (() => {
          let q = supabase.from('auction_comments').select('posted_at, author_username,canonical:auction_events_canonical(id)').or('auction_event_id.is.null,canonical.not.is.null').eq('vehicle_id', vehicleId!);
          if (listingUrl) { const url = listingUrl.replace(/\/$/, ''); q = q.in('source_url', [url, `${url}/`]); }
          return q.not('bid_amount', 'is', null).order('posted_at', { ascending: false }).limit(1).maybeSingle();
        })(),
        // last comment
        (() => {
          let q = supabase.from('auction_comments').select('posted_at,canonical:auction_events_canonical(id)').or('auction_event_id.is.null,canonical.not.is.null').eq('vehicle_id', vehicleId!);
          if (listingUrl) { const url = listingUrl.replace(/\/$/, ''); q = q.in('source_url', [url, `${url}/`]); }
          return q.order('posted_at', { ascending: false }).limit(1).maybeSingle();
        })(),
        // seller
        (() => {
          let q = supabase.from('auction_comments').select('author_username,canonical:auction_events_canonical(id)').or('auction_event_id.is.null,canonical.not.is.null').eq('vehicle_id', vehicleId!);
          if (listingUrl) { const url = listingUrl.replace(/\/$/, ''); q = q.in('source_url', [url, `${url}/`]); }
          return q.eq('is_seller', true).order('posted_at', { ascending: false }).limit(1).maybeSingle();
        })(),
      ]);

      for (const result of [bidCountRes, commentCountRes, lastBidRes, lastCommentRes, sellerRes]) { if (result.error) throw result.error; }
      return {
        bidCount: typeof bidCountRes.count === 'number' ? bidCountRes.count : 0,
        commentCount: typeof commentCountRes.count === 'number' ? commentCountRes.count : 0,
        lastBidAt: (lastBidRes.data as any)?.posted_at ?? null,
        lastCommentAt: (lastCommentRes.data as any)?.posted_at ?? null,
        winnerName: ((lastBidRes.data as any)?.author_username ?? '').trim() || null,
        sellerUsername: ((sellerRes.data as any)?.author_username ?? '').trim() || null,
      };
    },
    enabled: !!vehicleId,
    staleTime: 30 * 1000, // 30s — these update frequently during live auctions
  });
}

/**
 * Fetches raw auction comments for a vehicle.
 */
export function useAuctionComments(
  vehicleId: string | undefined,
  listingUrl?: string | null,
) {
  return useQuery({
    queryKey: ['auction-comments', vehicleId, listingUrl ?? null],
    queryFn: async () => {
      let q = supabase
        .from('auction_comments')
        .select('*,canonical:auction_events_canonical(id)').or('auction_event_id.is.null,canonical.not.is.null')
        .eq('vehicle_id', vehicleId!)
        .order('posted_at', { ascending: false });
      if (listingUrl) q = q.in('source_url', auctionSourceUrlVariants(listingUrl));
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!vehicleId,
    staleTime: 30 * 1000,
  });
}
