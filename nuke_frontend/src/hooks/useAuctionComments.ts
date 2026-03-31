import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

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
