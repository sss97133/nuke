/**
 * Scheduled Auction Component
 *
 * Full auction view with countdown timer, bid stack, and bidding controls.
 * Supports the committed offers auction model with visible bid stacking.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';
import { CommittedBidStack, BidStackData } from './CommittedBidStack';

export type AuctionStatus = 'scheduled' | 'preview' | 'active' | 'extended' | 'ended' | 'settled' | 'cancelled';

export interface ScheduledAuctionData {
  id: string;
  offering_id: string;
  seller_id: string;
  auction_type: string;
  starting_price: number;
  reserve_price: number | null;
  buy_now_price: number | null;
  shares_offered: number;
  visibility_start: string;
  bidding_start: string;
  scheduled_end: string;
  extension_enabled: boolean;
  extension_threshold_seconds: number;
  status: AuctionStatus;
  title: string | null;
  description: string | null;
  terms: string | null;
  winning_bid_id: string | null;
  final_price: number | null;
  vehicle_offerings?: {
    id: string;
    vehicle_id: string;
    current_share_price: number;
    total_shares: number;
  };
}

interface ScheduledAuctionProps {
  auctionId: string;
  userId?: string;
  onBidPlaced?: (result: any) => void;
  onAuctionEnd?: (auction: ScheduledAuctionData) => void;
}

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

const calculateTimeRemaining = (endDate: string): TimeRemaining => {
  const total = new Date(endDate).getTime() - Date.now();

  if (total <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  }

  return {
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
    total,
  };
};

export const ScheduledAuction: React.FC<ScheduledAuctionProps> = ({
  auctionId,
  userId,
  onBidPlaced,
  onAuctionEnd,
}) => {
  const [auction, setAuction] = useState<ScheduledAuctionData | null>(null);
  const [bidStack, setBidStack] = useState<BidStackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining | null>(null);
  const [userBidId, setUserBidId] = useState<string | null>(null);

  // Bid form state
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidAmount, setBidAmount] = useState('');
  const [sharesRequested, setSharesRequested] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const fetchAuction = useCallback(async () => {
    try {
      const response = await fetch(
        `${getSupabaseFunctionsUrl()}/scheduled-auction-manager`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}`,
          },
          body: JSON.stringify({
            action: 'get_auction',
            auctionId,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch auction');
      }

      setAuction(data.auction);
      setBidStack(data.bid_stack);

      // Check if user has an existing bid
      if (userId && data.bid_stack?.bids) {
        const userBid = data.bid_stack.bids.find((b: any) => b.bidder_id === userId);
        setUserBidId(userBid?.id || null);
      }

      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch auction:', err);
      setError((err as Error).message);
      setLoading(false);
    }
  }, [auctionId, userId]);

  // Initial fetch
  useEffect(() => {
    fetchAuction();
  }, [fetchAuction]);

  // Countdown timer
  useEffect(() => {
    if (!auction) return;

    const targetDate = auction.status === 'active' || auction.status === 'extended'
      ? auction.scheduled_end
      : auction.bidding_start;

    const updateTimer = () => {
      const remaining = calculateTimeRemaining(targetDate);
      setTimeRemaining(remaining);

      // Check if auction ended
      if (remaining.total <= 0 && (auction.status === 'active' || auction.status === 'extended')) {
        onAuctionEnd?.(auction);
        fetchAuction(); // Refresh to get updated status
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [auction, fetchAuction, onAuctionEnd]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`auction:${auctionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'committed_bids',
          filter: `auction_id=eq.${auctionId}`,
        },
        () => {
          fetchAuction();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scheduled_auctions',
          filter: `id=eq.${auctionId}`,
        },
        () => {
          fetchAuction();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [auctionId, fetchAuction]);

  const handlePlaceBid = async () => {
    if (!bidAmount || !userId) return;

    const amountCents = Math.round(parseFloat(bidAmount) * 100);

    if (isNaN(amountCents) || amountCents <= 0) {
      setError('Invalid bid amount');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `${getSupabaseFunctionsUrl()}/scheduled-auction-manager`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}`,
          },
          body: JSON.stringify({
            action: 'bid',
            auctionId,
            bidAmount: amountCents,
            sharesRequested,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to place bid');
      }

      setBidAmount('');
      setShowBidForm(false);
      onBidPlaced?.(data);
      fetchAuction();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBid = async () => {
    if (!userBidId || !userId) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `${getSupabaseFunctionsUrl()}/scheduled-auction-manager`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}`,
          },
          body: JSON.stringify({
            action: 'cancel_bid',
            bidId: userBidId,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to cancel bid');
      }

      setUserBidId(null);
      fetchAuction();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="bg-gray-950 rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-800 rounded w-2/3"></div>
          <div className="h-24 bg-gray-800 rounded"></div>
          <div className="h-48 bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="bg-gray-950 rounded-xl p-6">
        <p className="text-red-400">Auction not found</p>
      </div>
    );
  }

  const isPreview = auction.status === 'scheduled' || auction.status === 'preview';
  const isActive = auction.status === 'active' || auction.status === 'extended';
  const isEnded = auction.status === 'ended' || auction.status === 'settled';
  const canBid = isActive && userId && auction.seller_id !== userId;

  return (
    <div className="bg-gray-950 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              {auction.title || 'Scheduled Auction'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {auction.shares_offered} {auction.shares_offered === 1 ? 'share' : 'shares'} offered
            </p>
          </div>

          {/* Status Badge */}
          <div
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              auction.status === 'active' || auction.status === 'extended'
                ? 'bg-green-900/50 text-green-400 border border-green-700'
                : auction.status === 'settled'
                ? 'bg-blue-900/50 text-blue-400 border border-blue-700'
                : auction.status === 'ended'
                ? 'bg-gray-700 text-gray-300'
                : 'bg-yellow-900/50 text-yellow-400 border border-yellow-700'
            }`}
          >
            {auction.status === 'extended' ? 'EXTENDED' : auction.status.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Countdown Timer */}
      {timeRemaining && !isEnded && (
        <div className="bg-gray-900 px-6 py-4 border-b border-gray-800">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">
              {isPreview ? 'Bidding Starts In' : 'Auction Ends In'}
            </p>
            <div className="flex justify-center gap-4">
              {timeRemaining.days > 0 && (
                <div className="text-center">
                  <div className="text-3xl font-bold text-white font-mono">
                    {timeRemaining.days}
                  </div>
                  <div className="text-xs text-gray-500 uppercase">Days</div>
                </div>
              )}
              <div className="text-center">
                <div className="text-3xl font-bold text-white font-mono">
                  {String(timeRemaining.hours).padStart(2, '0')}
                </div>
                <div className="text-xs text-gray-500 uppercase">Hours</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-white font-mono">
                  {String(timeRemaining.minutes).padStart(2, '0')}
                </div>
                <div className="text-xs text-gray-500 uppercase">Min</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-white font-mono">
                  {String(timeRemaining.seconds).padStart(2, '0')}
                </div>
                <div className="text-xs text-gray-500 uppercase">Sec</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settled Banner */}
      {auction.status === 'settled' && auction.final_price && (
        <div className="bg-blue-900/30 px-6 py-4 border-b border-blue-800">
          <div className="text-center">
            <p className="text-xs text-blue-400 uppercase tracking-wider mb-1">Sold For</p>
            <p className="text-2xl font-bold text-white">
              {formatCurrency(auction.final_price)}
            </p>
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Price Info */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase">Starting Price</p>
            <p className="text-lg font-semibold text-white">
              {formatCurrency(auction.starting_price)}
            </p>
          </div>

          {auction.reserve_price && (
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-xs text-gray-400 uppercase">Reserve</p>
              <p className="text-lg font-semibold text-yellow-400">
                {bidStack?.reserve_met ? '✓ Met' : 'Not Met'}
              </p>
            </div>
          )}

          {auction.buy_now_price && isActive && (
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-xs text-gray-400 uppercase">Buy Now</p>
              <p className="text-lg font-semibold text-green-400">
                {formatCurrency(auction.buy_now_price)}
              </p>
            </div>
          )}
        </div>

        {/* Schedule Info (for preview) */}
        {isPreview && (
          <div className="bg-gray-900 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-300 mb-3">Auction Schedule</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Preview Opens</span>
                <span className="text-white">{formatDate(auction.visibility_start)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Bidding Starts</span>
                <span className="text-white">{formatDate(auction.bidding_start)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Scheduled End</span>
                <span className="text-white">{formatDate(auction.scheduled_end)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Bid Stack */}
        {bidStack && (
          <CommittedBidStack
            bidStack={bidStack}
            reservePrice={auction.reserve_price || undefined}
            startingPrice={auction.starting_price}
            userBidId={userBidId || undefined}
            onPlaceBid={canBid ? () => setShowBidForm(true) : undefined}
          />
        )}

        {/* Bid Form Modal */}
        {showBidForm && canBid && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-white mb-4">
                {userBidId ? 'Update Your Bid' : 'Place Committed Bid'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Bid Amount (USD)
                  </label>
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    min={auction.starting_price / 100}
                    step="0.01"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={`Min: ${formatCurrency(auction.starting_price)}`}
                    autoFocus
                  />
                </div>

                {auction.shares_offered > 1 && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      Shares Requested
                    </label>
                    <input
                      type="number"
                      value={sharesRequested}
                      onChange={(e) => setSharesRequested(parseInt(e.target.value) || 1)}
                      min={1}
                      max={auction.shares_offered}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <p className="text-xs text-gray-500">
                  By placing a bid, you commit to purchase if you win. Your funds will be
                  reserved until the auction ends or you cancel your bid.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowBidForm(false);
                      setError(null);
                    }}
                    className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePlaceBid}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                    disabled={submitting || !bidAmount}
                  >
                    {submitting ? 'Placing...' : 'Place Bid'}
                  </button>
                </div>

                {userBidId && (
                  <button
                    onClick={handleCancelBid}
                    className="w-full py-2 text-red-400 hover:text-red-300 text-sm transition-colors"
                    disabled={submitting}
                  >
                    Cancel Existing Bid
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Description & Terms */}
        {(auction.description || auction.terms) && (
          <div className="space-y-4">
            {auction.description && (
              <div className="bg-gray-900 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">Description</h4>
                <p className="text-sm text-gray-400 whitespace-pre-wrap">
                  {auction.description}
                </p>
              </div>
            )}

            {auction.terms && (
              <div className="bg-gray-900 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">Terms & Conditions</h4>
                <p className="text-xs text-gray-500 whitespace-pre-wrap">
                  {auction.terms}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Extension Notice */}
        {auction.extension_enabled && isActive && (
          <p className="text-xs text-gray-500 text-center">
            Bids in the final {auction.extension_threshold_seconds || 300} seconds will extend
            the auction by {auction.extension_threshold_seconds || 300} seconds.
          </p>
        )}
      </div>
    </div>
  );
};

export default ScheduledAuction;
