import React, { useState, useEffect, useRef } from 'react';
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
  final_price_cents?: number | null;
  auction_start_time: string | null;
}

const LiveAuctionBanner: React.FC<LiveAuctionBannerProps> = ({ vehicleId }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listing, setListing] = useState<AuctionListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBidInterface, setShowBidInterface] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [timerExtension, setTimerExtension] = useState<{ seconds: number; visible: boolean } | null>(null);
  const endRefreshTriggeredRef = useRef(false);
  const previousEndTimeRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset end-of-auction refresh guard when listing changes
    endRefreshTriggeredRef.current = false;
  }, [listing?.id, listing?.auction_end_time]);

  useEffect(() => {
    loadActiveListing();
  }, [vehicleId]);

  // Live updates: keep banner "alive" as bids/timer change the listing row.
  useEffect(() => {
    if (!listing?.id) return;

    const listingId = listing.id;
    const channel = supabase
      .channel(`vehicle-listing:${listingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicle_listings', filter: `id=eq.${listingId}` },
        (payload) => {
          const row = (payload as any)?.new as any;
          if (!row) return;
          
          // Detect timer extension: if end_time moved forward, show indicator
          const prevEndTime = previousEndTimeRef.current;
          const newEndTime = row.auction_end_time;
          if (prevEndTime && newEndTime && prevEndTime !== newEndTime) {
            const prevTime = new Date(prevEndTime).getTime();
            const newTime = new Date(newEndTime).getTime();
            if (newTime > prevTime) {
              const extensionSeconds = Math.floor((newTime - prevTime) / 1000);
              if (extensionSeconds > 0) {
                setTimerExtension({ seconds: extensionSeconds, visible: true });
                // Auto-hide after 5 seconds
                setTimeout(() => {
                  setTimerExtension((prev) => prev ? { ...prev, visible: false } : null);
                }, 5000);
              }
            }
          }
          previousEndTimeRef.current = newEndTime;
          
          // If listing still visible to this user, update our snapshot immediately.
          setListing((prev) => {
            if (!prev) return row as any;
            if (String(prev.id) !== String(row.id)) return prev;
            return { ...(prev as any), ...(row as any) } as any;
          });
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [listing?.id]);

  // Track previous end time to detect extensions
  useEffect(() => {
    if (listing?.auction_end_time) {
      previousEndTimeRef.current = listing.auction_end_time;
    }
  }, [listing?.auction_end_time]);

  useEffect(() => {
    if (!listing?.auction_end_time) return;

    const updateTimer = () => {
      const now = new Date();
      const endTime = new Date(listing.auction_end_time!);
      const diff = endTime.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining('Ended');
        // The UI countdown ended; re-fetch to let the backend settlement hide this banner
        // (status will flip to sold/expired via scheduler).
        if (!endRefreshTriggeredRef.current) {
          endRefreshTriggeredRef.current = true;
          window.setTimeout(() => {
            try { loadActiveListing(); } catch {}
          }, 1500);
        }
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
      const nowIso = new Date().toISOString();
      // Keep a short grace window after the countdown hits 0.
      // The scheduler flips status to sold/expired on a 60s cadence; during that window the UI should still show "settling".
      const graceIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('vehicle_listings')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active')
        .in('sale_type', ['auction', 'live_auction'])
        // Treat as active if end time is in the future OR end time is missing (status governs liveness)
        // Also include just-ended auctions in a small grace window while the server settles the result.
        .or(`auction_end_time.is.null,auction_end_time.gt.${nowIso},auction_end_time.gte.${graceIso}`)
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
  const isEnded = timeRemaining === 'Ended';
  const finalPrice = typeof (listing as any)?.final_price_cents === 'number' ? (listing as any).final_price_cents : null;

  const formatExtensionTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  return (
    <>
      {/* Timer Extension Indicator */}
      {timerExtension?.visible && (
        <div
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: 'white',
            padding: '8px 12px',
            marginBottom: '8px',
            borderRadius: '4px',
            fontSize: '9pt',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <span style={{ fontSize: '14px' }}>⏱️</span>
          <span>
            Timer extended by <strong>+{formatExtensionTime(timerExtension.seconds)}</strong>
          </span>
        </div>
      )}

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
                background: isEnded ? '#94a3b8' : '#dc2626',
                flexShrink: 0
              }}
            />
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{isEnded ? 'Auction Ended' : 'Live Auction'}</span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {timeRemaining || 'Loading...'}
            </span>
          </div>
          {!isEnded ? (
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
          ) : (
            <span style={{ fontSize: '8pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              settling…
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '8pt', color: 'var(--text-muted)' }}>
          {isEnded && typeof finalPrice === 'number' && finalPrice > 0 ? (
            <span>
              <strong style={{ color: 'var(--text)' }}>Final:</strong> {formatCurrency(finalPrice)}
            </span>
          ) : null}
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
              background: 'var(--surface)',
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

