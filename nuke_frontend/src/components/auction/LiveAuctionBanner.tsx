import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import AuctionBiddingInterface from './AuctionBiddingInterface';

interface LiveAuctionBannerProps {
  vehicleId: string;
}

interface AuctionListing {
  id: string;
  sale_type: string;
  status: string;
  current_high_bid_cents: number | null;
  bid_count: number;
  auction_end_time: string | null;
  reserve_price_cents: number | null;
  auction_start_time: string | null;
}

const LiveAuctionBanner: React.FC<LiveAuctionBannerProps> = ({ vehicleId }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listing, setListing] = useState<AuctionListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBidInterface, setShowBidInterface] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    loadActiveListing();
  }, [vehicleId]);

  useEffect(() => {
    if (!listing?.auction_end_time) return;

    const updateTimer = () => {
      const now = new Date();
      const endTime = new Date(listing.auction_end_time!);
      const diff = endTime.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining('Ended');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        setTimeRemaining(`${days}d ${hours}h ${minutes}m`);
      } else if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`);
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s`);
      } else {
        setTimeRemaining(`${seconds}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [listing?.auction_end_time]);

  const loadActiveListing = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vehicle_listings')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active')
        .in('sale_type', ['auction', 'live_auction'])
        .gt('auction_end_time', new Date().toISOString())
        .maybeSingle();

      if (error) {
        console.error('Error loading auction listing:', error);
        setListing(null);
      } else {
        setListing(data);
      }
    } catch (error) {
      console.error('Error loading auction listing:', error);
      setListing(null);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (cents: number | null) => {
    if (!cents) return 'No bids yet';
    return `$${(cents / 100).toLocaleString()}`;
  };

  const handleBidNow = () => {
    if (!user) {
      navigate('/login?redirect=' + encodeURIComponent(window.location.pathname));
      return;
    }
    setShowBidInterface(true);
  };

  const handleViewAuction = () => {
    navigate(`/auction/${listing?.id}`);
  };

  if (loading) {
    return null;
  }

  if (!listing) {
    return null;
  }

  const isLive = listing.auction_start_time 
    ? new Date(listing.auction_start_time) <= new Date()
    : true;

  return (
    <>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          padding: '8px 12px',
          marginBottom: '12px',
          borderRadius: '4px',
          fontSize: '8pt',
          lineHeight: '1.4'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#dc2626',
                flexShrink: 0
              }}
            />
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Live Auction</span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {timeRemaining || 'Loading...'}
            </span>
          </div>
          <button
            onClick={handleBidNow}
            style={{
              padding: '4px 12px',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              fontSize: '8pt',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.12s ease',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            BID NOW
          </button>
        </div>
        
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '8pt', color: 'var(--text-muted)' }}>
          <span>
            <strong style={{ color: 'var(--text)' }}>Bid:</strong> {formatCurrency(listing.current_high_bid_cents)}
          </span>
          <span>
            <strong style={{ color: 'var(--text)' }}>Bids:</strong> {listing.bid_count || 0}
          </span>
          {listing.reserve_price_cents && (
            <span>
              <strong style={{ color: 'var(--text)' }}>Reserve:</strong> {formatCurrency(listing.reserve_price_cents)}
            </span>
          )}
          <button
            onClick={handleViewAuction}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--primary)',
              fontSize: '8pt',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              marginLeft: 'auto'
            }}
          >
            View Details →
          </button>
        </div>
      </div>

      {/* Bidding Interface Modal */}
      {showBidInterface && listing && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowBidInterface(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '14pt', fontWeight: 700 }}>Place Your Bid</h2>
              <button
                onClick={() => setShowBidInterface(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#6b7280',
                  padding: '4px 8px'
                }}
              >
                ×
              </button>
            </div>
            <AuctionBiddingInterface
              listingId={listing.id}
              onBidPlaced={() => {
                setShowBidInterface(false);
                loadActiveListing();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default LiveAuctionBanner;

