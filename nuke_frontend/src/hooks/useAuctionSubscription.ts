import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface AuctionUpdate {
  type: 'bid_placed' | 'auction_extended' | 'auction_ended' | 'status_change';
  listing_id: string;
  current_high_bid_cents?: number;
  bid_count?: number;
  auction_extended?: boolean;
  new_end_time?: string;
  status?: string;
}

export interface UseAuctionSubscriptionReturn {
  currentHighBid: number | null;
  bidCount: number;
  auctionEndTime: Date | null;
  isExtended: boolean;
  error: Error | null;
  subscribe: (listingId: string) => void;
  unsubscribe: () => void;
  softCloseResetSeconds?: number | null;
}

/**
 * Hook for real-time auction updates
 * Subscribes to auction changes including bids, extensions, and status updates
 */
export function useAuctionSubscription(listingId: string | null) {
  const [currentHighBid, setCurrentHighBid] = useState<number | null>(null);
  const [bidCount, setBidCount] = useState(0);
  const [auctionEndTime, setAuctionEndTime] = useState<Date | null>(null);
  const [isExtended, setIsExtended] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const [softCloseResetSeconds, setSoftCloseResetSeconds] = useState<number | null>(null);

  // Load initial auction state
  useEffect(() => {
    if (!listingId) return;

    const loadAuctionState = async () => {
      const { data, error: fetchError } = await supabase
        .from('vehicle_listings')
        .select('current_high_bid_cents, bid_count, auction_end_time, soft_close_reset_seconds')
        .eq('id', listingId)
        .single();

      if (fetchError) {
        setError(fetchError as Error);
        return;
      }

      if (data) {
        setCurrentHighBid(data.current_high_bid_cents);
        setBidCount(data.bid_count || 0);
        setAuctionEndTime(data.auction_end_time ? new Date(data.auction_end_time) : null);
        setSoftCloseResetSeconds(typeof data.soft_close_reset_seconds === 'number' ? data.soft_close_reset_seconds : null);
      }
    };

    loadAuctionState();
  }, [listingId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!listingId) return;

    const auctionChannel = supabase
      .channel(`auction:${listingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_bids',
          filter: `listing_id=eq.${listingId}`,
        },
        (payload) => {
          // Handle bid updates
          if (payload.eventType === 'INSERT') {
            const bid = payload.new as any;
            // Backward/forward compatible: some environments used `bid_amount` (USD) before we added `displayed_bid_cents`.
            const nextHighBidCents =
              typeof bid.displayed_bid_cents === 'number'
                ? bid.displayed_bid_cents
                : typeof bid.bid_amount === 'number'
                  ? Math.round(bid.bid_amount * 100)
                  : null;

            if (nextHighBidCents !== null) setCurrentHighBid(nextHighBidCents);
            setBidCount((prev) => prev + 1);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'vehicle_listings',
          filter: `id=eq.${listingId}`,
        },
        (payload) => {
          const listing = payload.new as any;
          setCurrentHighBid(listing.current_high_bid_cents);
          setBidCount(listing.bid_count || 0);
          if (typeof listing.soft_close_reset_seconds === 'number') {
            setSoftCloseResetSeconds(listing.soft_close_reset_seconds);
          }
          
          if (listing.auction_end_time) {
            const newEndTime = new Date(listing.auction_end_time);
            const oldEndTime = auctionEndTime;
            
            // Check if auction was extended
            if (oldEndTime && newEndTime > oldEndTime) {
              setIsExtended(true);
              setAuctionEndTime(newEndTime);
            } else {
              setAuctionEndTime(newEndTime);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to auction:${listingId}`);
        } else if (status === 'CHANNEL_ERROR') {
          setError(new Error('Failed to subscribe to auction updates'));
        }
      });

    setChannel(auctionChannel);

    return () => {
      if (auctionChannel) {
        supabase.removeChannel(auctionChannel);
      }
    };
  }, [listingId, auctionEndTime]);

  const subscribe = useCallback((newListingId: string) => {
    // This is handled by the useEffect above
    // But we can expose it for manual control if needed
  }, []);

  const unsubscribe = useCallback(() => {
    if (channel) {
      supabase.removeChannel(channel);
      setChannel(null);
    }
  }, [channel]);

  return {
    currentHighBid,
    bidCount,
    auctionEndTime,
    isExtended,
    error,
    subscribe,
    unsubscribe,
    // Exposed for UI copy ("resets to 2:00 on late bids") without hardcoding.
    softCloseResetSeconds,
  };
}

