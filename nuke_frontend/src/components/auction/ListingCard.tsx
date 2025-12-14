import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { UnifiedListing } from '../../services/myAuctionsService';
import '../../design-system.css';
import { AuctionPlatformBadge, AuctionStatusBadge, ParticipantBadge } from './AuctionBadges';

interface ListingCardProps {
  listing: UnifiedListing;
  onSync?: (listingId: string, listingSource: 'native' | 'external' | 'export', platform: string) => void;
}

const ListingCard: React.FC<ListingCardProps> = ({ listing, onSync }) => {
  const navigate = useNavigate();

  const platformNames: Record<string, string> = {
    nzero: 'n-zero',
    bat: 'Bring a Trailer',
    ebay: 'eBay Motors',
    cars_and_bids: 'Cars & Bids',
    hemmings: 'Hemmings',
    autotrader: 'AutoTrader',
    facebook_marketplace: 'Facebook Marketplace',
    craigslist: 'Craigslist',
    carscom: 'Cars.com',
  };

  const getStatus = (status: string, soldAt?: string, endDate?: string, meta?: any): { status: any; title?: string } => {
    const reserveNotMet = meta?.reserve_not_met === true || String(meta?.outcome || '').toLowerCase() === 'reserve_not_met';
    if (reserveNotMet) return { status: 'reserve_not_met', title: 'Reserve not met' };
    if (status === 'sold' || soldAt) return { status: 'sold' };
    if (status === 'cancelled') return { status: 'cancelled' };
    if (status === 'pending') return { status: 'pending' };
    if (status === 'expired' || (status === 'ended' && !soldAt)) return { status: 'expired' };
    if (status === 'active') {
      if (endDate) {
        const timeRemaining = new Date(endDate).getTime() - Date.now();
        if (timeRemaining < 24 * 60 * 60 * 1000) return { status: 'ending_soon', title: 'Ending within 24 hours' };
      }
      return { status: 'active' };
    }
    return { status: 'ended' };
  };

  const formatTimeRemaining = (endDate?: string) => {
    if (!endDate) return null;
    const now = Date.now();
    const end = new Date(endDate).getTime();
    const diff = end - now;

    if (diff <= 0) return 'Ended';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatCurrency = (value?: number) => {
    if (!value) return 'N/A';
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  const statusBadge = getStatus(listing.listing_status, listing.sold_at, listing.end_date, listing.metadata);
  const timeRemaining = formatTimeRemaining(listing.end_date);
  const platformName = platformNames[listing.platform] || listing.platform;
  const externalFaviconUrl = listing.external_url || (listing.platform === 'bat' ? 'https://bringatrailer.com' : undefined);

  const seller = (() => {
    // Prefer explicit seller usernames (BaT), then org context, then personal context.
    if (listing.seller_nzero_user_id) {
      return {
        label: listing.seller_username || 'Seller',
        href: `/profile/${listing.seller_nzero_user_id}`,
        iconUrl: externalFaviconUrl,
        kind: 'user' as const,
      };
    }
    if (listing.seller_username) {
      return {
        label: listing.seller_username,
        href: listing.platform === 'bat' ? undefined : undefined,
        iconUrl: externalFaviconUrl,
        kind: 'bat_user' as const,
      };
    }
    if (listing.scope === 'organization' && listing.organization_id) {
      return {
        label: listing.organization_name || 'Organization',
        href: `/organizations/${listing.organization_id}`,
        iconUrl: undefined,
        kind: 'organization' as const,
      };
    }
    return {
      label: 'You',
      href: `/profile/${listing.user_id}`,
      iconUrl: undefined,
      kind: 'user' as const,
    };
  })();

  const buyer = (() => {
    if (listing.buyer_nzero_user_id) {
      return {
        label: listing.buyer_username || 'Buyer',
        href: `/profile/${listing.buyer_nzero_user_id}`,
        iconUrl: externalFaviconUrl,
        kind: 'user' as const,
      };
    }
    if (listing.buyer_username) {
      return {
        label: listing.buyer_username,
        href: undefined,
        iconUrl: externalFaviconUrl,
        kind: 'bat_user' as const,
      };
    }
    // Some ingests use `metadata.buyer`
    if (listing.metadata?.buyer) {
      return {
        label: String(listing.metadata.buyer),
        href: undefined,
        iconUrl: externalFaviconUrl,
        kind: 'bat_user' as const,
      };
    }
    return null;
  })();

  const highBidder = (() => {
    const bidder = listing.metadata?.high_bidder || listing.metadata?.bidder || null;
    if (!bidder) return null;
    return {
      label: String(bidder),
      href: undefined,
      iconUrl: externalFaviconUrl,
      kind: 'bat_user' as const,
    };
  })();

  return (
    <div
      className="card"
      style={{
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
      onClick={() => {
        if (listing.external_url) {
          window.open(listing.external_url, '_blank');
        } else if (listing.listing_source === 'native') {
          navigate(`/vehicle/${listing.vehicle_id}`);
        }
      }}
    >
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AuctionPlatformBadge platform={listing.platform} urlForFavicon={externalFaviconUrl} label={platformName} />
          <AuctionStatusBadge status={statusBadge.status} title={statusBadge.title} />
        </div>
        {onSync && listing.platform === 'bat' && listing.listing_source === 'external' && (
          <button
            className="cursor-button"
            style={{
              padding: '4px 8px',
              fontSize: '10px',
              backgroundColor: '#666',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSync(listing.listing_id, listing.listing_source, listing.platform);
            }}
          >
            SYNC
          </button>
        )}
      </div>

      <div className="card-body">
        {/* Vehicle Image & Info */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          {listing.vehicle?.primary_image_url ? (
            <img
              src={listing.vehicle.primary_image_url}
              alt={`${listing.vehicle.year} ${listing.vehicle.make} ${listing.vehicle.model}`}
              style={{
                width: '120px',
                height: '80px',
                objectFit: 'cover',
                borderRadius: '4px',
              }}
            />
          ) : (
            <div
              style={{
                width: '120px',
                height: '80px',
                backgroundColor: '#ddd',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                color: '#666',
              }}
            >
              No Image
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h3 className="heading-3" style={{ margin: 0, fontSize: '16px', marginBottom: '4px' }}>
              {listing.vehicle
                ? `${listing.vehicle.year} ${listing.vehicle.make} ${listing.vehicle.model}`
                : 'Unknown Vehicle'}
            </h3>
            {listing.vehicle?.trim && (
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                {listing.vehicle.trim}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
              <span style={{ fontSize: '10px', color: '#666' }}>Seller:</span>
              <ParticipantBadge kind={seller.kind} label={seller.label} href={seller.href} leadingIconUrl={seller.iconUrl} />
            </div>
          </div>
        </div>

        {/* Auction Details */}
        <div
          style={{
            padding: '8px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            marginBottom: '12px',
          }}
        >
          {listing.current_bid ? (
            <div style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '10px', color: '#666' }}>
                Current Bid{highBidder ? ' by' : ''}
              </div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                {formatCurrency(listing.current_bid)}
              </div>
              {highBidder ? (
                <div style={{ marginTop: '6px' }}>
                  <ParticipantBadge kind={highBidder.kind} label={highBidder.label} href={highBidder.href} leadingIconUrl={highBidder.iconUrl} />
                </div>
              ) : null}
            </div>
          ) : listing.final_price ? (
            <div style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '10px', color: '#666' }}>
                Sold For{buyer ? ' to' : ''}
              </div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                {formatCurrency(listing.final_price)}
              </div>
              {buyer ? (
                <div style={{ marginTop: '6px' }}>
                  <ParticipantBadge kind={buyer.kind} label={buyer.label} href={buyer.href} leadingIconUrl={buyer.iconUrl} />
                </div>
              ) : null}
            </div>
          ) : null}

          {listing.reserve_price ? (
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
              Reserve: {formatCurrency(listing.reserve_price)}
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
              No Reserve
            </div>
          )}

          {timeRemaining && (
            <div style={{ fontSize: '11px', color: '#666' }}>
              Ends: {timeRemaining}
            </div>
          )}
        </div>

        {/* Performance Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            marginBottom: '12px',
            fontSize: '11px',
          }}
        >
          {listing.bid_count !== undefined && (
            <div>
              <div style={{ color: '#666' }}>Bids</div>
              <div style={{ fontWeight: 'bold' }}>{listing.bid_count}</div>
            </div>
          )}
          {listing.view_count !== undefined && (
            <div>
              <div style={{ color: '#666' }}>Views</div>
              <div style={{ fontWeight: 'bold' }}>{listing.view_count.toLocaleString()}</div>
            </div>
          )}
          {listing.watcher_count !== undefined && (
            <div>
              <div style={{ color: '#666' }}>Watchers</div>
              <div style={{ fontWeight: 'bold' }}>{listing.watcher_count}</div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {listing.external_url ? (
            <button
              className="cursor-button"
              style={{
                flex: 1,
                padding: '6px 12px',
                fontSize: '11px',
                backgroundColor: '#0000ff',
              }}
              onClick={(e) => {
                e.stopPropagation();
                window.open(listing.external_url, '_blank');
              }}
            >
              VIEW ON {platformName.toUpperCase()}
            </button>
          ) : listing.listing_source === 'native' ? (
            <button
              className="cursor-button"
              style={{
                flex: 1,
                padding: '6px 12px',
                fontSize: '11px',
                backgroundColor: '#0000ff',
              }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/vehicle/${listing.vehicle_id}`);
              }}
            >
              VIEW LISTING
            </button>
          ) : null}
        </div>

        {/* Listed Date */}
        <div style={{ fontSize: '10px', color: '#999', marginTop: '8px', textAlign: 'right' }}>
          Listed {new Date(listing.listed_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
};

export default ListingCard;



