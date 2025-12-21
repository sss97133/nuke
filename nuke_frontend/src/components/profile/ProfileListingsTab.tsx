/**
 * Profile Listings Tab
 * Displays listings (BaT-style) for user or organization
 */

import React from 'react';
import { Link } from 'react-router-dom';
import VehicleThumbnail from '../VehicleThumbnail';

interface Listing {
  id: string;
  bat_listing_url?: string;
  bat_listing_title?: string;
  auction_start_date?: string;
  auction_end_date?: string;
  sale_price?: number;
  listing_status?: string;
  vehicle?: any;
  auction_start_time?: string;
  auction_end_time?: string;
  current_high_bid_cents?: number;
}

interface ProfileListingsTabProps {
  listings: Listing[];
  profileType: 'user' | 'organization';
}

export const ProfileListingsTab: React.FC<ProfileListingsTabProps> = ({ listings, profileType }) => {
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

  const getStatusBadge = (status: string | null | undefined) => {
    if (!status) return null;
    const statusMap: Record<string, { label: string; color: string }> = {
      active: { label: 'Live Now', color: 'var(--success)' },
      ended: { label: 'Ended', color: 'var(--text-muted)' },
      sold: { label: 'Sold', color: 'var(--success)' },
      no_sale: { label: 'No Sale', color: 'var(--warning)' },
      cancelled: { label: 'Cancelled', color: 'var(--danger)' },
    };
    const statusInfo = statusMap[status] || { label: status, color: 'var(--text-muted)' };
    return (
      <span style={{
        fontSize: '7pt',
        padding: '2px 6px',
        background: statusInfo.color,
        color: 'var(--white)',
        borderRadius: '2px',
        fontWeight: 'bold',
      }}>
        {statusInfo.label}
      </span>
    );
  };

  if (listings.length === 0) {
    return (
      <div style={{
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '8pt',
      }}>
        No listings yet
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
    }}>
      {listings.map((listing) => {
        const vehicle = listing.vehicle;
        const vehicleName = vehicle
          ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
          : listing.bat_listing_title || 'Unknown Vehicle';

        return (
          <div
            key={listing.id}
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              transition: 'all 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-hover)';
              e.currentTarget.style.borderColor = 'var(--border-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--surface)';
              e.currentTarget.style.borderColor = 'var(--border)';
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
                      listing.bat_listing_url ? (
                        <a
                          href={listing.bat_listing_url}
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
                    {listing.auction_start_date && listing.auction_end_date && (
                      <>
                        {formatDate(listing.auction_start_date)} - {formatDate(listing.auction_end_date)}
                      </>
                    )}
                    {listing.auction_start_time && listing.auction_end_time && (
                      <>
                        {formatDate(listing.auction_start_time)} - {formatDate(listing.auction_end_time)}
                      </>
                    )}
                  </div>
                </div>
                {getStatusBadge(listing.listing_status)}
              </div>

              {/* Price */}
              <div style={{
                fontSize: '9pt',
                fontWeight: 'bold',
                color: 'var(--text)',
              }}>
                {listing.sale_price
                  ? formatPrice(listing.sale_price)
                  : listing.current_high_bid_cents
                  ? formatPrice(listing.current_high_bid_cents / 100)
                  : 'No Price'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

