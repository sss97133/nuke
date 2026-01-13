import { useState, useEffect } from 'react';
import { useAuctionSubscription } from '../../hooks/useAuctionSubscription';
import { AuctionService } from '../../services/auctionService';
import AuctionPaymentService from '../../services/auctionPaymentService';
import { useAuth } from '../../hooks/useAuth';
import PaymentMethodSetup from './PaymentMethodSetup';
import '../../design-system.css';

interface AuctionBiddingInterfaceProps {
  listingId: string;
  onBidPlaced?: () => void;
}

export default function AuctionBiddingInterface({
  listingId,
  onBidPlaced,
}: AuctionBiddingInterfaceProps) {
  const { user } = useAuth();
  const paymentsEnabled = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  const [maxBid, setMaxBid] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [minimumBid, setMinimumBid] = useState<number | null>(null);
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  const [showPaymentSetup, setShowPaymentSetup] = useState(false);
  const [depositAmount, setDepositAmount] = useState<number>(0);

  // Real-time subscription
  const {
    currentHighBid,
    bidCount,
    auctionEndTime,
    isExtended,
    softCloseResetSeconds,
  } = useAuctionSubscription(listingId);

  useEffect(() => {
    loadMinimumBid();
    if (user && paymentsEnabled) {
      checkPaymentMethod();
    }
    if (!paymentsEnabled) {
      setHasPaymentMethod(false);
      setShowPaymentSetup(false);
      setDepositAmount(0);
    }
  }, [listingId, currentHighBid, user, paymentsEnabled]);

  useEffect(() => {
    if (paymentsEnabled && maxBid && listingId) {
      calculateDeposit();
    }
  }, [maxBid, listingId, paymentsEnabled]);

  const loadMinimumBid = async () => {
    const min = await AuctionService.getMinimumBid(listingId);
    setMinimumBid(min);
  };

  const checkPaymentMethod = async () => {
    const hasPayment = await AuctionPaymentService.hasPaymentMethod();
    setHasPaymentMethod(hasPayment);
  };

  const calculateDeposit = async () => {
    const bidAmount = parseFloat(maxBid);
    if (isNaN(bidAmount) || bidAmount <= 0) return;

    const deposit = await AuctionPaymentService.calculateDepositAmount(
      listingId,
      Math.floor(bidAmount * 100)
    );
    setDepositAmount(deposit);
  };

  const handlePlaceBid = async () => {
    if (!user) {
      setError('Please log in to place a bid');
      return;
    }

    // If payments are enabled, require payment method setup first.
    if (paymentsEnabled && !hasPaymentMethod) {
      setShowPaymentSetup(true);
      return;
    }

    const bidAmount = parseFloat(maxBid);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      setError('Please enter a valid bid amount');
      return;
    }

    if (minimumBid && bidAmount * 100 < minimumBid) {
      setError(`Minimum bid is $${(minimumBid / 100).toFixed(2)}`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const bidCents = Math.floor(bidAmount * 100);

      const result = paymentsEnabled
        ? await AuctionPaymentService.placeBidWithDeposit(
            listingId,
            bidCents,
            bidCents // Using same amount for proxy max for simplicity
          )
        : await AuctionService.placeBid(listingId, bidCents, 'web');

      if (result.success) {
        setSuccess(true);
        setMaxBid('');
        if (onBidPlaced) onBidPlaced();
        
        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(result.error || 'Failed to place bid');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSetupComplete = async () => {
    setShowPaymentSetup(false);
    setHasPaymentMethod(true);
    // Automatically try to place bid again
    await handlePlaceBid();
  };

  const formatCurrency = (cents: number | null) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatTimeRemaining = (endTime: Date | null) => {
    if (!endTime) return 'N/A';
    const now = new Date();
    const diff = endTime.getTime() - now.getTime();

    if (diff <= 0) return 'Ended';

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    // Show mm:ss in the high-intensity window.
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!user) {
    return (
      <div className="p-6 border border-gray-200 rounded">
        <p className="text-gray-600">Please log in to place a bid</p>
      </div>
    );
  }

  return (
    <>
      {showPaymentSetup && (
        <PaymentMethodSetup
          onSuccess={handlePaymentSetupComplete}
          onCancel={() => setShowPaymentSetup(false)}
        />
      )}
      
    <div className="p-6 border border-gray-200 rounded space-y-4">
      {/* Current Status */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Current High Bid:</span>
          <span className="text-2xl font-bold">
            {formatCurrency(currentHighBid)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Total Bids:</span>
          <span className="font-medium">{bidCount}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Time Remaining:</span>
          <span className="font-medium">{formatTimeRemaining(auctionEndTime)}</span>
        </div>
        {isExtended && (
          <div className="text-yellow-600 text-sm font-medium">
            Auction extended due to recent bid
            {typeof softCloseResetSeconds === 'number'
              ? ` (reset to ${Math.floor(softCloseResetSeconds / 60)}:${(softCloseResetSeconds % 60).toString().padStart(2, '0')})`
              : ''}
          </div>
        )}
      </div>

      {/* Bidding Form */}
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Enter Your Maximum Bid (Proxy Bidding)
          </label>
          <p className="text-xs text-gray-500 mb-2">
            We'll automatically bid for you up to this amount. Your maximum bid is kept secret.
          </p>
          <div className="flex gap-2">
            <span className="text-gray-500 self-center">$</span>
            <input
              type="number"
              value={maxBid}
              onChange={(e) => setMaxBid(e.target.value)}
              placeholder={minimumBid ? (minimumBid / 100).toFixed(2) : '0.00'}
              min={minimumBid ? minimumBid / 100 : 0}
              step="0.01"
              className="flex-1 px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {minimumBid && (
            <p className="text-xs text-gray-500 mt-1">
              Minimum bid: {formatCurrency(minimumBid)}
            </p>
          )}
          {paymentsEnabled && depositAmount > 0 && (
            <p className="text-xs text-blue-600 mt-1 font-medium">
              Deposit hold: {formatCurrency(depositAmount)} 
              ({AuctionPaymentService.calculateDepositPercentage(parseFloat(maxBid) * 100, depositAmount)}% - refunded if outbid)
            </p>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
            Bid placed successfully!
          </div>
        )}

        <button
          onClick={handlePlaceBid}
          disabled={loading || !maxBid}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading
            ? 'Placing Bid...'
            : paymentsEnabled
              ? (hasPaymentMethod ? 'Place Bid' : 'Add Payment & Bid')
              : 'Place Bid'}
        </button>
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
        <p className="font-medium mb-1">How Proxy Bidding Works:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Enter the maximum amount you're willing to pay</li>
          <li>We'll automatically bid for you up to that amount</li>
          <li>Your maximum bid is kept secret from other bidders</li>
          <li>If someone outbids you, we'll bid again automatically (up to your max)</li>
        </ul>
      </div>

      {/* Deposit Info */}
      {paymentsEnabled && depositAmount > 0 && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          <p className="font-medium mb-1">About Bid Deposits:</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>We'll hold {formatCurrency(depositAmount)} on your card when you place this bid</li>
            <li>If you're outbid, the hold is released immediately</li>
            <li>If you win, the hold is captured and the remainder is charged</li>
            <li>No charges if the auction doesn't meet reserve</li>
          </ul>
        </div>
      )}
    </div>
    </>
  );
}

