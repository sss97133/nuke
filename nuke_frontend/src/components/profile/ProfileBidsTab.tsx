/**
 * Profile Bids Tab
 * Displays bids (BaT-style) for user or organization
 */

import React from 'react';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';

interface Bid {
  id: string;
  bid_amount_cents?: number;
  created_at?: string;
  auction?: any;
  vehicle?: any;
  bidder?: any;
  bat_listing_url?: string;
  bat_listing_title?: string;
  auction_end_date?: string;
  sale_price?: number;
  listing_status?: string;
}

interface ProfileBidsTabProps {
  bids: Bid[];
  profileType: 'user' | 'organization';
}

export const ProfileBidsTab: React.FC<ProfileBidsTabProps> = ({ bids, profileType }) => {
  const formatPrice = (price: number | null | undefined) => {
    if (!price) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (bids.length === 0) {
    return (
      <div style={{
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '8pt',
      }}>
        No bids yet
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      {bids.map((bid) => {
        const vehicle = bid.vehicle || bid.auction?.vehicle;
        const vehicleName = vehicle
          ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
          : bid.bat_listing_title || 'Unknown Vehicle';

        const bidAmount = bid.bid_amount_cents
          ? bid.bid_amount_cents / 100
          : bid.sale_price || null;

        const isWinner = bid.listing_status === 'sold' && bidAmount === bid.sale_price;

        return (
          <div
            key={bid.id}
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: isWinner ? 'var(--success-light)' : 'var(--surface)',
              border: `1px solid ${isWinner ? 'var(--success)' : 'var(--border)'}`,
              borderRadius: '4px',
              transition: 'all 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isWinner ? 'var(--success-light)' : 'var(--surface-hover)';
              e.currentTarget.style.borderColor = isWinner ? 'var(--success)' : 'var(--border-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isWinner ? 'var(--success-light)' : 'var(--surface)';
              e.currentTarget.style.borderColor = isWinner ? 'var(--success)' : 'var(--border)';
            }}
          >
            {/* Thumbnail */}
            <div style={{ flexShrink: 0, width: '120px', height: '80px' }}>
              {vehicle?.id ? (
                <Link to={`/vehicle/${vehicle.id}`}>
                  <VehicleThumbnail vehicleId={vehicle.id} />
                </Link>
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  background: 'var(--surface-hover)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '7pt',
                  color: 'var(--text-muted)',
                }}>
                  No Image
                </div>
              )}
            </div>

            {/* Details */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <div>
                  <h3 style={{
                    fontSize: '9pt',
                    fontWeight: 'bold',
                    margin: 0,
                    marginBottom: '4px',
                  }}>
                    {vehicle?.id ? (
                      <Link
                        to={`/vehicle/${vehicle.id}`}
                        style={{ color: 'var(--text)', textDecoration: 'none' }}
                      >
                        {vehicleName}
                      </Link>
                    ) : (
                      bid.bat_listing_url ? (
                        <a
                          href={bid.bat_listing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--text)', textDecoration: 'none' }}
                        >
                          {vehicleName}
                        </a>
                      ) : (
                        vehicleName
                      )
                    )}
                  </h3>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                    {formatDate(bid.created_at || bid.auction_end_date)}
                  </div>
                </div>
                {isWinner && (
                  <span style={{
                    fontSize: '7pt',
                    padding: '2px 6px',
                    background: 'var(--success)',
                    color: 'var(--white)',
                    borderRadius: '2px',
                    fontWeight: 'bold',
                  }}>
                    Winner
                  </span>
                )}
              </div>

              {/* Bid Amount */}
              <div style={{
                fontSize: '9pt',
                fontWeight: 'bold',
                color: isWinner ? 'var(--success)' : 'var(--text)',
              }}>
                {bidAmount ? formatPrice(bidAmount) : 'No Amount'}
                {isWinner && ' - Won'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

