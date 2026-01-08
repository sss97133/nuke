import React from 'react';
import '../../design-system.css';
import { AuctionPlatformBadge, AuctionStatusBadge, ParticipantBadge } from '../auction/AuctionBadges';

type PublicAuctionListing = {
  id: string;
  platform?: string | null;
  listing_url?: string | null;
  bat_listing_url?: string | null;
  listing_status?: string | null;
  sale_price?: number | null;
  final_bid?: number | null;
  bid_count?: number | null;
  view_count?: number | null;
  auction_end_date?: string | null;
  seller_username?: string | null;
  buyer_username?: string | null;
  vehicle?: {
    id: string;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    primary_image_url?: string | null;
    bat_sale_date?: string | null;
  } | null;
  seller_identity?: {
    handle?: string | null;
    profile_url?: string | null;
    claimed_by_user_id?: string | null;
  } | null;
};

interface Props {
  listings?: PublicAuctionListing[] | null;
  loading?: boolean;
  profileName?: string | null;
}

const formatCurrency = (value?: number | null) => {
  const v = Number(value || 0);
  if (!v) return '$0';
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
};

const sanitizeListings = (raw?: PublicAuctionListing[] | null) => {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const clean: PublicAuctionListing[] = [];
  for (const entry of list) {
    const url = entry.bat_listing_url || entry.listing_url || entry.id;
    if (seen.has(url)) continue;
    seen.add(url);
    clean.push(entry);
  }
  return clean;
};

export const PublicAuctionTrackRecord: React.FC<Props> = ({ listings, loading = false, profileName }) => {
  const records = React.useMemo(() => {
    return sanitizeListings(
      (listings || []).filter((listing) => {
        const platform = (listing.platform || '').toLowerCase();
        const url = (listing.bat_listing_url || listing.listing_url || '').toLowerCase();
        if (platform) return platform.includes('bat');
        return url.includes('bringatrailer.com');
      })
    );
  }, [listings]);

  const stats = React.useMemo(() => {
    return records.reduce(
      (acc, listing) => {
        acc.totalAuctions += 1;
        acc.totalViews += listing.view_count || 0;
        acc.totalBids += listing.bid_count || 0;
        const sale = listing.sale_price ?? listing.final_bid ?? 0;
        acc.totalGross += sale || 0;
        return acc;
      },
      { totalAuctions: 0, totalViews: 0, totalBids: 0, totalGross: 0 },
    );
  }, [records]);

  if (loading && records.length === 0) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>
          Loading auction track record...
        </div>
      </div>
    );
  }

  if (!loading && records.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--fs-11)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            No verified BaT auctions linked yet
          </div>
          <p style={{ fontSize: 'var(--fs-10)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
            {profileName ? `${profileName}'s` : 'This'} track record only shows listings that are tied to a verified BaT identity.
            Claim your BaT handle to publish your auction history once it’s proven.
          </p>
          <a className="cursor-button" href="/claim-identity?platform=bat" style={{ fontSize: '10px' }}>
            Claim BaT Identity
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className="heading-2" style={{ marginBottom: 'var(--space-2)' }}>
          Auction Track Record
        </h2>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Pulls directly from Bring a Trailer telemetry that’s been linked to this profile. If a source can’t be verified, it stays out.
        </p>
      </div>

      <div
        className="card"
        style={{
          marginBottom: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>Total Auctions</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.totalAuctions}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>Total Views</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.totalViews.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>Total Bids</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.totalBids.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>Gross Sold Value</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{formatCurrency(stats.totalGross)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
        {records.map((listing) => {
          const vehicle = listing.vehicle || null;
          const vehicleTitle = vehicle
            ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
            : 'Untitled Listing';
          const saleDate = vehicle?.bat_sale_date || listing.auction_end_date || null;
          const salePrice = listing.sale_price ?? listing.final_bid ?? null;
          const listingUrl = listing.bat_listing_url || listing.listing_url || null;
          const platformLabel = (listing.platform || 'bat').toLowerCase() === 'bat' ? 'BaT' : listing.platform || 'Auction';
          const seller = listing.seller_username || listing.seller_identity?.handle || null;
          const buyer = listing.buyer_username || null;
          const status = listing.listing_status || (salePrice ? 'sold' : 'ended');

          return (
            <div
              key={listing.id}
              className="card"
              style={{ cursor: listingUrl ? 'pointer' : 'default' }}
              onClick={() => {
                if (listingUrl) window.open(listingUrl, '_blank');
              }}
            >
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <AuctionPlatformBadge platform={platformLabel} urlForFavicon="https://bringatrailer.com" label={platformLabel} />
                <AuctionStatusBadge status={status} />
              </div>
              <div className="card-body">
                {(seller || buyer) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                    {seller && (
                      <>
                        <span style={{ fontSize: '10px', color: '#666' }}>Seller:</span>
                        <ParticipantBadge kind="bat_user" label={String(seller)} leadingIconUrl="https://bringatrailer.com" />
                      </>
                    )}
                    {buyer && (
                      <>
                        <span style={{ fontSize: '10px', color: '#666' }}>Buyer:</span>
                        <ParticipantBadge kind="bat_user" label={String(buyer)} leadingIconUrl="https://bringatrailer.com" />
                      </>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  {vehicle?.primary_image_url ? (
                    <img
                      src={vehicle.primary_image_url}
                      alt={vehicleTitle}
                      style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '4px' }}
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
                    <div className="heading-3" style={{ margin: 0, fontSize: '16px', marginBottom: '4px' }}>
                      {vehicleTitle}
                    </div>
                    {vehicle?.trim ? (
                      <div style={{ fontSize: '11px', color: '#666' }}>{vehicle.trim}</div>
                    ) : null}
                    {saleDate ? (
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>
                        Sale date: {new Date(saleDate).toLocaleDateString()}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div style={{ padding: '8px', backgroundColor: 'var(--bg)', borderRadius: '4px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '10px', color: '#666' }}>Sold For</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{formatCurrency(salePrice)}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: '11px' }}>
                  <div>
                    <div style={{ color: '#666' }}>Bids</div>
                    <div style={{ fontWeight: 'bold' }}>{(listing.bid_count || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ color: '#666' }}>Views</div>
                    <div style={{ fontWeight: 'bold' }}>{(listing.view_count || 0).toLocaleString()}</div>
                  </div>
                </div>

                {listingUrl && (
                  <div style={{ marginTop: '12px' }}>
                    <button className="cursor-button" style={{ width: '100%', fontSize: '11px', backgroundColor: '#0000ff' }}>
                      VIEW ON BAT
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PublicAuctionTrackRecord;


