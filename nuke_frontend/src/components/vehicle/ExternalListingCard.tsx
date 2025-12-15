import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ExternalListing {
  id: string;
  platform: string;
  listing_url: string;
  listing_status: string;
  current_bid?: number;
  final_price?: number;
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
  end_date?: string;
  sold_at?: string;
  metadata?: any;
  created_at: string;
}

interface Props {
  vehicleId: string;
}

const platformNames: Record<string, string> = {
  bat: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  ebay_motors: 'eBay Motors',
  hemmings: 'Hemmings',
  autotrader: 'AutoTrader',
  facebook_marketplace: 'Facebook Marketplace'
};

const platformColors: Record<string, string> = {
  bat: '#1e40af',  // BaT blue
  cars_and_bids: '#dc2626',
  ebay_motors: '#e53e3e',
  hemmings: '#059669',
  autotrader: '#7c3aed',
  facebook_marketplace: '#1877f2'
};

const ExternalListingCard: React.FC<Props> = ({ vehicleId }) => {
  const [listings, setListings] = useState<ExternalListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExternalListings();
  }, [vehicleId]);

  const loadExternalListings = async () => {
    try {
      // Use RPC data if available (eliminates duplicate query)
      const rpcData = (window as any).__vehicleProfileRpcData;
      const rpcMatchesThisVehicle = rpcData && rpcData.vehicle_id === vehicleId;
      if (rpcMatchesThisVehicle && rpcData?.external_listings) {
        setListings(rpcData.external_listings);
        setLoading(false);
        return; // Skip fetch if provided
      }
      
      // Fallback: fetch if not in RPC data
      const { data, error } = await supabase
        .from('external_listings')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setListings(data || []);
    } catch (error) {
      console.error('Error loading external listings:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '12px', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading external listings...
      </div>
    );
  }

  if (listings.length === 0) {
    return null;
  }

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header">
        <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
          External Listings
        </h3>
      </div>
      <div className="card-body">
        {listings.map(listing => {
          const platformName = platformNames[listing.platform] || listing.platform;
          const platformColor = platformColors[listing.platform] || 'var(--accent)';
          const isActive = listing.listing_status === 'active' || listing.listing_status === 'live';
          const isSold = listing.listing_status === 'sold';
          const reserveNotMet = listing.metadata?.reserve_not_met === true;

          return (
            <div
              key={listing.id}
              style={{
                padding: '12px',
                marginBottom: '12px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: isActive ? 'var(--surface-hover)' : 'var(--surface)'
              }}
            >
              {/* Platform Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    padding: '4px 8px',
                    background: platformColor,
                    color: '#fff',
                    borderRadius: '2px',
                    fontSize: '8pt',
                    fontWeight: 700
                  }}>
                    {platformName.toUpperCase()}
                  </div>
                  <div style={{
                    padding: '4px 8px',
                    background: isActive ? 'var(--success)' : isSold ? 'var(--error)' : 'var(--text-secondary)',
                    color: '#fff',
                    borderRadius: '2px',
                    fontSize: '8pt',
                    fontWeight: 700
                  }}>
                    {listing.listing_status.toUpperCase().replace('_', ' ')}
                  </div>
                  {reserveNotMet && (
                    <div style={{
                      padding: '4px 8px',
                      background: 'var(--warning)',
                      color: '#fff',
                      borderRadius: '2px',
                      fontSize: '8pt',
                      fontWeight: 700
                    }}>
                      RESERVE NOT MET
                    </div>
                  )}
                </div>
                <a
                  href={listing.listing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-small"
                  style={{ fontSize: '8pt' }}
                >
                  View on {platformName} →
                </a>
              </div>

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginBottom: '8px' }}>
                {listing.current_bid !== null && listing.current_bid !== undefined && (
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      {reserveNotMet ? 'High Bid' : 'Current Bid'}
                    </div>
                    <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                      ${listing.current_bid.toLocaleString()}
                    </div>
                  </div>
                )}
                {listing.final_price && (
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      Sold For
                    </div>
                    <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--success)' }}>
                      ${listing.final_price.toLocaleString()}
                    </div>
                  </div>
                )}
                {listing.bid_count !== null && listing.bid_count !== undefined && (
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      Bids
                    </div>
                    <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                      {listing.bid_count}
                    </div>
                  </div>
                )}
                {listing.watcher_count !== null && listing.watcher_count !== undefined && (
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      Watchers
                    </div>
                    <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                      {listing.watcher_count.toLocaleString()}
                    </div>
                  </div>
                )}
                {listing.view_count !== null && listing.view_count !== undefined && (
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      Views
                    </div>
                    <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                      {listing.view_count.toLocaleString()}
                    </div>
                  </div>
                )}
                {listing.metadata?.comment_count && (
                  <div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      Comments
                    </div>
                    <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                      {listing.metadata.comment_count}
                    </div>
                  </div>
                )}
              </div>

              {/* End Date */}
              {listing.end_date && (
                <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  Auction ended: {new Date(listing.end_date).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                </div>
              )}

              {/* Reserve Not Met Notice */}
              {reserveNotMet && (
                <div style={{
                  marginTop: '12px',
                  padding: '8px',
                  background: 'var(--warning-dim)',
                  border: '1px solid var(--warning)',
                  borderRadius: '4px',
                  fontSize: '8pt'
                }}>
                  This vehicle did not meet its reserve price on {platformName}. It may be available for direct purchase.
                </div>
              )}

              {/* Features */}
              {listing.metadata?.features && listing.metadata.features.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                    Highlighted Features:
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {listing.metadata.features.map((feature: string, idx: number) => (
                      <span
                        key={idx}
                        style={{
                          padding: '2px 6px',
                          background: 'var(--surface-hover)',
                          border: '1px solid var(--border)',
                          borderRadius: '2px',
                          fontSize: '7pt'
                        }}
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Fair Play Notice */}
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: 'var(--accent-dim)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: 'var(--text-secondary)'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Fair Play Policy:</div>
          N-Zero displays external listings for transparency and doesn't compete with other platforms.
          We provide affiliate links and track attribution to ensure proper credit and commission distribution.
        </div>
      </div>
    </div>
  );
};

export default ExternalListingCard;

