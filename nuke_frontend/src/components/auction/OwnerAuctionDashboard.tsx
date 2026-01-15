import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuctionSubscription } from '../../hooks/useAuctionSubscription';
import { AuctionService, type AuctionListing, type AuctionBid } from '../../services/auctionService';
import '../../design-system.css';

interface OwnerAuctionDashboardProps {
  listingId: string;
  onClose?: () => void;
}

export default function OwnerAuctionDashboard({ listingId, onClose }: OwnerAuctionDashboardProps) {
  const [listing, setListing] = useState<AuctionListing | null>(null);
  const [bids, setBids] = useState<AuctionBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<any>(null);

  // Real-time subscription
  const {
    currentHighBid,
    bidCount,
    auctionEndTime,
    isExtended,
  } = useAuctionSubscription(listingId);

  useEffect(() => {
    loadAuctionData();
  }, [listingId]);

  const loadAuctionData = async () => {
    try {
      setLoading(true);
      
      // Load listing
      const listingData = await AuctionService.getListing(listingId);
      if (!listingData) {
        setError('Auction not found');
        return;
      }
      setListing(listingData);

      // Load vehicle details
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', listingData.vehicle_id)
        .single();
      setVehicle(vehicleData);

      // Load bids
      const bidsData = await AuctionService.getBids(listingId);
      setBids(bidsData);
    } catch (err) {
      console.error('Error loading auction data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load auction data');
    } finally {
      setLoading(false);
    }
  };

  const handleStartAuction = async () => {
    if (!listing) return;
    
    if (!confirm('Start this auction now?')) return;

    try {
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('activate_auction_listing', {
        p_listing_id: listingId,
        p_use_scheduled_time: false,
    });

      if (rpcError) throw rpcError;

      if (data?.success) {
        await loadAuctionData();
    } else {
        const readinessIssues = Array.isArray(data?.readiness?.issues) ? data.readiness.issues : [];
        const issueSummary = readinessIssues
          .filter((i: any) => String(i?.severity || '') === 'error')
          .map((i: any) => String(i?.message || ''))
          .filter(Boolean)
          .slice(0, 5)
          .join(' · ');
        setError(data?.error || issueSummary || 'Failed to start auction');
      }
    } catch (err) {
      console.error('Error starting auction:', err);
      setError(err instanceof Error ? err.message : 'Failed to start auction');
    }
  };

  const handleCancelAuction = async () => {
    if (!confirm('Are you sure you want to cancel this auction?')) return;

    const { success, error: updateError } = await AuctionService.updateListing(listingId, {
      status: 'cancelled',
    });

    if (success) {
      setListing({ ...listing, status: 'cancelled' });
    } else {
      setError(updateError || 'Failed to cancel auction');
    }
  };

  const formatCurrency = (cents: number | null) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatTimeRemaining = (endTime: string | null) => {
    if (!endTime) return 'N/A';
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return 'Ended';

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">Loading auction data...</div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="p-6">
        <div className="text-red-600">{error || 'Auction not found'}</div>
      </div>
    );
  }

  const isActive = listing.status === 'active';
  const reserveMet = listing.reserve_price_cents
    ? (currentHighBid || 0) >= listing.reserve_price_cents
    : true;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Auction Management</h2>
          {vehicle && (
            <p className="text-gray-600">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        )}
      </div>

      {/* Status Badge */}
      <div className="flex items-center gap-4">
        <span
          className={`px-3 py-1 rounded text-sm font-medium ${
            listing.status === 'active'
              ? 'bg-green-100 text-green-800'
              : listing.status === 'draft'
              ? 'bg-gray-100 text-gray-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {listing.status.toUpperCase()}
        </span>
        {isExtended && (
          <span className="px-3 py-1 rounded text-sm font-medium bg-yellow-100 text-yellow-800">
            Auction Extended
          </span>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 border border-gray-200 rounded">
          <div className="text-sm text-gray-600">Current High Bid</div>
          <div className="text-2xl font-bold">
            {formatCurrency(currentHighBid || listing.current_high_bid_cents)}
          </div>
        </div>
        <div className="p-4 border border-gray-200 rounded">
          <div className="text-sm text-gray-600">Total Bids</div>
          <div className="text-2xl font-bold">{bidCount || listing.bid_count}</div>
        </div>
        <div className="p-4 border border-gray-200 rounded">
          <div className="text-sm text-gray-600">Reserve Price</div>
          <div className="text-2xl font-bold">
            {formatCurrency(listing.reserve_price_cents)}
          </div>
          {listing.reserve_price_cents && (
            <div className={`text-xs mt-1 ${reserveMet ? 'text-green-600' : 'text-red-600'}`}>
              {reserveMet ? 'Met' : 'Not Met'}
            </div>
          )}
        </div>
        <div className="p-4 border border-gray-200 rounded">
          <div className="text-sm text-gray-600">Time Remaining</div>
          <div className="text-2xl font-bold">
            {formatTimeRemaining(auctionEndTime?.toISOString() || listing.auction_end_time || null)}
          </div>
        </div>
      </div>

      {/* Actions */}
      {listing.status === 'draft' && (
        <div className="flex gap-4">
          <button
            onClick={handleStartAuction}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Start Auction
          </button>
          <button
            onClick={handleCancelAuction}
            className="px-6 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors"
          >
            Cancel Auction
          </button>
        </div>
      )}

      {isActive && (
        <div>
          <button
            onClick={handleCancelAuction}
            className="px-6 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors"
          >
            Cancel Auction
          </button>
        </div>
      )}

      {/* Bids List */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Bid History</h3>
        {bids.length === 0 ? (
          <div className="text-gray-500 text-center py-8">No bids yet</div>
        ) : (
          <div className="space-y-2">
            {bids.map((bid) => (
              <div
                key={bid.id}
                className="p-4 border border-gray-200 rounded flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">
                    {formatCurrency(bid.displayed_bid_cents)}
                  </div>
                  <div className="text-sm text-gray-600">
                    {new Date(bid.created_at).toLocaleString()}
                  </div>
                </div>
                {bid.is_winning && (
                  <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                    Winning
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auction Settings */}
      <div className="p-4 border border-gray-200 rounded">
        <h3 className="text-lg font-semibold mb-4">Auction Settings</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Auction Type:</span>
            <span className="font-medium">
              {listing.sale_type === 'live_auction' ? 'Live Auction' : 'Standard Auction'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Duration:</span>
            <span className="font-medium">
              {listing.auction_duration_minutes} minutes
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Sniping Protection:</span>
            <span className="font-medium">
              {listing.sniping_protection_minutes || 2} minutes
            </span>
          </div>
          {listing.auction_start_time && (
            <div className="flex justify-between">
              <span className="text-gray-600">Start Time:</span>
              <span className="font-medium">
                {new Date(listing.auction_start_time).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

