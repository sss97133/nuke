import React from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';
import { AuctionPlatformBadge, AuctionStatusBadge, ParticipantBadge } from '../auction/AuctionBadges';

type PublicAuctionVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim?: string | null;
  primary_image_url?: string | null;
  bat_auction_url?: string | null;
  bat_sold_price?: number | null;
  bat_sale_date?: string | null;
  bat_bid_count?: number | null;
  bat_view_count?: number | null;
  origin_metadata?: any;
};

interface Props {
  profileUserId: string;
}

export const PublicAuctionTrackRecord: React.FC<Props> = ({ profileUserId }) => {
  const [loading, setLoading] = React.useState(true);
  const [vehicles, setVehicles] = React.useState<PublicAuctionVehicle[]>([]);
  const [batByVehicle, setBatByVehicle] = React.useState<Record<string, any>>({});

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, year, make, model, trim, primary_image_url, bat_auction_url, bat_sold_price, bat_sale_date, bat_bid_count, bat_view_count, origin_metadata')
          .eq('user_id', profileUserId)
          .not('bat_auction_url', 'is', null)
          .order('bat_sale_date', { ascending: false, nullsFirst: false });

        if (error) throw error;
        const rows = (data as any[]) || [];
        if (!cancelled) setVehicles(rows);

        // Best-effort: enrich with canonical BaT listing participants if available
        try {
          const vehicleIds = rows.map((r) => r.id).filter(Boolean);
          if (vehicleIds.length > 0) {
            const { data: batListings } = await supabase
              .from('bat_listings')
              .select('vehicle_id, bat_listing_url, seller_username, buyer_username, seller_bat_user_id, buyer_bat_user_id, bid_count, view_count, final_bid, sale_price, listing_status')
              .in('vehicle_id', vehicleIds);

            const map: Record<string, any> = {};
            for (const r of (batListings as any[]) || []) {
              // keep the richest row per vehicle
              const prev = map[r.vehicle_id];
              const prevScore = prev ? (prev.sale_price ? 2 : 0) + (prev.buyer_username ? 1 : 0) + (prev.view_count ? 1 : 0) : -1;
              const rScore = (r.sale_price ? 2 : 0) + (r.buyer_username ? 1 : 0) + (r.view_count ? 1 : 0);
              if (!prev || rScore >= prevScore) map[r.vehicle_id] = r;
            }
            if (!cancelled) setBatByVehicle(map);
          }
        } catch {
          // ignore if bat_listings missing
        }
      } catch (e) {
        console.error('Error loading public auction track record:', e);
        if (!cancelled) setVehicles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileUserId]);

  const formatCurrency = (value?: number | null) => {
    const v = Number(value || 0);
    if (!v) return '$0';
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
    return `$${v.toLocaleString()}`;
  };

  const stats = React.useMemo(() => {
    const totalAuctions = vehicles.length;
    const totalViews = vehicles.reduce((s, v) => s + (v.bat_view_count || 0), 0);
    const totalBids = vehicles.reduce((s, v) => s + (v.bat_bid_count || 0), 0);
    const totalGross = vehicles.reduce((s, v) => s + Number(v.bat_sold_price || 0), 0);
    return { totalAuctions, totalViews, totalBids, totalGross };
  }, [vehicles]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        Loading auction track record...
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
          Public auction data derived from listing URLs and platform metadata. This does not imply personal profit; margin/payouts are not shown.
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

      {vehicles.length === 0 ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>No Public Auctions Found</div>
          <div style={{ fontSize: '14px' }}>This profile has no Bring a Trailer auctions linked yet.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
          {vehicles.map((v) => (
            <div
              key={v.id}
              className="card"
              style={{ cursor: v.bat_auction_url ? 'pointer' : 'default' }}
              onClick={() => {
                if (v.bat_auction_url) window.open(v.bat_auction_url, '_blank');
              }}
            >
              <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <AuctionPlatformBadge platform="bat" urlForFavicon="https://bringatrailer.com" label="BaT" />
                <AuctionStatusBadge status="sold" />
              </div>
              <div className="card-body">
                {(() => {
                  const b = batByVehicle[v.id];
                  const seller = b?.seller_username || v.origin_metadata?.bat_seller_username || null;
                  const buyer = b?.buyer_username || v.origin_metadata?.bat_buyer_username || null;
                  if (!seller && !buyer) return null;
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                      {seller ? (
                        <>
                          <span style={{ fontSize: '10px', color: '#666' }}>Seller:</span>
                          <ParticipantBadge kind="bat_user" label={String(seller)} leadingIconUrl="https://bringatrailer.com" />
                        </>
                      ) : null}
                      {buyer ? (
                        <>
                          <span style={{ fontSize: '10px', color: '#666' }}>Buyer:</span>
                          <ParticipantBadge kind="bat_user" label={String(buyer)} leadingIconUrl="https://bringatrailer.com" />
                        </>
                      ) : null}
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  {v.primary_image_url ? (
                    <img
                      src={v.primary_image_url}
                      alt={`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()}
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
                      {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                    </div>
                    {v.trim ? (
                      <div style={{ fontSize: '11px', color: '#666' }}>{v.trim}</div>
                    ) : null}
                    {v.bat_sale_date ? (
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>
                        Sale date: {new Date(v.bat_sale_date).toLocaleDateString()}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div style={{ padding: '8px', backgroundColor: 'var(--bg)', borderRadius: '4px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '10px', color: '#666' }}>Sold For</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{formatCurrency(v.bat_sold_price || 0)}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: '11px' }}>
                  <div>
                    <div style={{ color: '#666' }}>Bids</div>
                    <div style={{ fontWeight: 'bold' }}>{((batByVehicle[v.id]?.bid_count ?? v.bat_bid_count) || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ color: '#666' }}>Views</div>
                    <div style={{ fontWeight: 'bold' }}>{((batByVehicle[v.id]?.view_count ?? v.bat_view_count) || 0).toLocaleString()}</div>
                  </div>
                </div>

                {v.bat_auction_url ? (
                  <div style={{ marginTop: '12px' }}>
                    <button className="cursor-button" style={{ width: '100%', fontSize: '11px', backgroundColor: '#0000ff' }}>
                      VIEW ON BAT
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PublicAuctionTrackRecord;


