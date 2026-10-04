import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

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
export async function readAuctionEpisode(vehicleId: string) {
  const parent = await supabase.from('vehicles')
    .select('id,title,year,make,model,listing_url,auction_end_date')
    .eq('id', vehicleId).eq('is_public', true).is('deleted_at', null)
    .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item').maybeSingle();
  if (parent.error) throw parent.error;
  // Comments have a legacy broad public policy. Never read them without an eligible public parent.
  if (!parent.data) return null;
  const vehicle = parent.data;
  if (!/^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/.test(vehicle.listing_url ?? '')) return null;
  const url = vehicle.listing_url!.replace(/\/$/, '');
  const [comments, specs] = await Promise.all([
    supabase.from('auction_comments')
      .select('id,posted_at,comment_type,comment_text,bid_amount,is_seller,media_urls,bat_comment_id,source_url,vehicles!inner(id)')
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

export function useAuctionEpisode(vehicleId: string) {
  return useQuery({
    queryKey: ['auction-episode-evidence', vehicleId],
    queryFn: () => readAuctionEpisode(vehicleId),
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
      const base = () => {
        let q = supabase.from('auction_comments').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId!);
        if (listingUrl) q = q.eq('source_url', listingUrl);
        return q;
      };

      const [bidCountRes, commentCountRes, lastBidRes, lastCommentRes, sellerRes] = await Promise.all([
        // bid count
        (() => {
          let q = supabase.from('auction_comments').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId!);
          if (listingUrl) q = q.eq('source_url', listingUrl);
          return q.not('bid_amount', 'is', null);
        })(),
        // comment count (non-bid)
        (() => {
          let q = supabase.from('auction_comments').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId!);
          if (listingUrl) q = q.eq('source_url', listingUrl);
          return q.or('bid_amount.is.null,comment_type.neq.bid');
        })(),
        // last bid
        (() => {
          let q = supabase.from('auction_comments').select('posted_at, author_username').eq('vehicle_id', vehicleId!);
          if (listingUrl) q = q.eq('source_url', listingUrl);
          return q.not('bid_amount', 'is', null).order('posted_at', { ascending: false }).limit(1).maybeSingle();
        })(),
        // last comment
        (() => {
          let q = supabase.from('auction_comments').select('posted_at').eq('vehicle_id', vehicleId!);
          if (listingUrl) q = q.eq('source_url', listingUrl);
          return q.order('posted_at', { ascending: false }).limit(1).maybeSingle();
        })(),
        // seller
        (() => {
          let q = supabase.from('auction_comments').select('author_username').eq('vehicle_id', vehicleId!);
          if (listingUrl) q = q.eq('source_url', listingUrl);
          return q.eq('is_seller', true).order('posted_at', { ascending: false }).limit(1).maybeSingle();
        })(),
      ]);

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
        .select('*')
        .eq('vehicle_id', vehicleId!)
        .order('posted_at', { ascending: false });
      if (listingUrl) q = q.eq('source_url', listingUrl);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!vehicleId,
    staleTime: 30 * 1000,
  });
}
