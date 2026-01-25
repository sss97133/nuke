/**
 * Committed Bid Stack Component
 *
 * Displays the visible stack of committed bids for a scheduled auction.
 * Shows anonymized bid information in a professional format.
 */

import React from 'react';

export interface CommittedBid {
  id: string;
  bid_amount: number;
  shares_requested: number;
  created_at: string;
  bidder_display?: string; // Anonymized: "Bidder #1", "Bidder #2", etc.
}

export interface BidStackData {
  bid_count: number;
  total_committed: number;
  high_bid: number | null;
  reserve_met: boolean;
  bids: CommittedBid[];
}

interface CommittedBidStackProps {
  bidStack: BidStackData;
  reservePrice?: number;
  startingPrice: number;
  userBidId?: string; // Highlight user's own bid
  onPlaceBid?: () => void;
  loading?: boolean;
}

export const CommittedBidStack: React.FC<CommittedBidStackProps> = ({
  bidStack,
  reservePrice,
  startingPrice,
  userBidId,
  onPlaceBid,
  loading = false,
}) => {
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
          <div className="h-8 bg-gray-700 rounded"></div>
          <div className="h-8 bg-gray-700 rounded"></div>
          <div className="h-8 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  const { bid_count, total_committed, high_bid, reserve_met, bids } = bidStack;

  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden">
      {/* Header Summary */}
      <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Committed Bids</h3>
          <span className="text-xs text-gray-400">
            {bid_count} {bid_count === 1 ? 'offer' : 'offers'}
          </span>
        </div>

        {bid_count > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Total Committed</span>
              <p className="text-white font-medium">{formatCurrency(total_committed)}</p>
            </div>
            <div>
              <span className="text-gray-400">High Bid</span>
              <p className="text-green-400 font-medium">
                {high_bid ? formatCurrency(high_bid) : '-'}
              </p>
            </div>
          </div>
        )}

        {/* Reserve Status */}
        {reservePrice && (
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                reserve_met
                  ? 'bg-green-900/50 text-green-400 border border-green-700'
                  : 'bg-yellow-900/50 text-yellow-400 border border-yellow-700'
              }`}
            >
              {reserve_met ? '✓ Reserve Met' : 'Reserve Not Met'}
            </span>
          </div>
        )}
      </div>

      {/* Bid List */}
      <div className="divide-y divide-gray-800">
        {bids.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-gray-400 text-sm">No bids yet</p>
            <p className="text-gray-500 text-xs mt-1">
              Starting price: {formatCurrency(startingPrice)}
            </p>
            {onPlaceBid && (
              <button
                onClick={onPlaceBid}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Place First Bid
              </button>
            )}
          </div>
        ) : (
          bids.map((bid, index) => {
            const isUserBid = bid.id === userBidId;
            const isHighBid = bid.bid_amount === high_bid;

            return (
              <div
                key={bid.id}
                className={`px-4 py-3 flex items-center justify-between ${
                  isUserBid ? 'bg-blue-900/20 border-l-2 border-blue-500' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Rank Badge */}
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isHighBid
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    {index + 1}
                  </div>

                  {/* Bid Info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">
                        {formatCurrency(bid.bid_amount)}
                      </span>
                      {isHighBid && (
                        <span className="text-xs text-green-400">HIGH</span>
                      )}
                      {isUserBid && (
                        <span className="text-xs text-blue-400">YOUR BID</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {bid.shares_requested} {bid.shares_requested === 1 ? 'share' : 'shares'} •{' '}
                      {bid.bidder_display || `Bidder #${index + 1}`}
                    </div>
                  </div>
                </div>

                {/* Time */}
                <div className="text-xs text-gray-500">
                  {formatTime(bid.created_at)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Place Bid Button (if bids exist) */}
      {bids.length > 0 && onPlaceBid && (
        <div className="px-4 py-3 bg-gray-800 border-t border-gray-700">
          <button
            onClick={onPlaceBid}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {userBidId ? 'Update Your Bid' : 'Place a Bid'}
          </button>
        </div>
      )}
    </div>
  );
};

export default CommittedBidStack;
