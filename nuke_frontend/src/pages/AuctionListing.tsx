import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import OwnerAuctionDashboard from '../components/auction/OwnerAuctionDashboard';
import AuctionBiddingInterface from '../components/auction/AuctionBiddingInterface';
import '../design-system.css';

type ListingRow = {
  id: string;
  vehicle_id: string;
  seller_id: string;
  sale_type: string;
  status: string;
  auction_start_time: string | null;
  auction_end_time: string | null;
  auction_duration_minutes: number | null;
  auto_start_enabled?: boolean | null;
  schedule_strategy?: string | null;
  premium_status?: string | null;
  premium_budget_cents?: number | null;
  premium_paid_at?: string | null;
  premium_priority?: number | null;
  readiness_last_result?: any;
  list_price_cents?: number | null;
  reserve_price_cents?: number | null;
  current_high_bid_cents?: number | null;
  bid_count?: number | null;
  created_at?: string;
};

type VehicleRow = {
  id: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  primary_image_url?: string | null;
};

function formatCurrency(cents: number | null | undefined) {
  const v = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  return `$${(v / 100).toLocaleString()}`;
}

function formatTimeRemaining(endTimeIso: string | null) {
  if (!endTimeIso) return 'N/A';
  const end = new Date(endTimeIso);
  if (!Number.isFinite(end.getTime())) return 'N/A';
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function AuctionListing() {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [listing, setListing] = useState<ListingRow | null>(null);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [premiumBudgetUsd, setPremiumBudgetUsd] = useState('');
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [premiumError, setPremiumError] = useState<string | null>(null);
  const [premiumSuccess, setPremiumSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!listingId) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: listingData, error: listingErr } = await supabase
          .from('vehicle_listings')
          .select(
            'id, vehicle_id, seller_id, sale_type, status, auction_start_time, auction_end_time, auction_duration_minutes, list_price_cents, reserve_price_cents, current_high_bid_cents, bid_count, auto_start_enabled, schedule_strategy, premium_status, premium_budget_cents, premium_paid_at, premium_priority, readiness_last_result, created_at'
          )
          .eq('id', listingId)
          .single();

        if (cancelled) return;

        if (listingErr || !listingData) {
          setListing(null);
          setVehicle(null);
          setError(listingErr?.message || 'Listing not found');
          return;
        }

        setListing(listingData as ListingRow);

        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('id, year, make, model, trim, primary_image_url')
          .eq('id', listingData.vehicle_id)
          .maybeSingle();

        if (cancelled) return;
        setVehicle((vehicleData as VehicleRow) || null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to load listing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listingId, refreshNonce]);

  const isOwner = useMemo(() => {
    if (!user || !listing) return false;
    return String(listing.seller_id) === String(user.id);
  }, [user, listing]);

  const handlePurchasePremium = async () => {
    if (!listing) return;
    setPremiumError(null);
    setPremiumSuccess(null);

    const budgetUsd = Number(premiumBudgetUsd);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      setPremiumError('Enter a valid amount');
      return;
    }

    if (!confirm(`Purchase premium timing for $${budgetUsd.toFixed(2)}?`)) return;

    setPremiumLoading(true);
    try {
      const budgetCents = Math.floor(budgetUsd * 100);
      const { data, error: rpcError } = await supabase.rpc('purchase_auction_premium_timing', {
        p_listing_id: listing.id,
        p_budget_cents: budgetCents,
      });
      if (rpcError) throw rpcError;
      if (data?.success) {
        setPremiumSuccess('Premium timing purchased');
        setPremiumBudgetUsd('');
        setRefreshNonce((n) => n + 1);
      } else {
        setPremiumError(data?.error || 'Failed to purchase premium timing');
      }
    } catch (e: any) {
      setPremiumError(e?.message || 'Failed to purchase premium timing');
    } finally {
      setPremiumLoading(false);
    }
  };

  const vehicleTitle = useMemo(() => {
    if (!vehicle) return 'Auction Listing';
    const parts = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean);
    return parts.length > 0 ? String(parts.join(' ')) : 'Auction Listing';
  }, [vehicle]);

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '12px' }}>
        Loading auction...
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div style={{ padding: '24px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Auction</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{error || 'Not found'}</div>
          <div style={{ marginTop: 12 }}>
            <button className="button button-small" onClick={() => navigate('/auctions')}>
              Back to Auctions
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-4)' }}>
        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '12pt', fontWeight: 800 }}>{vehicleTitle}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: 4 }}>
                Listing: <span style={{ fontFamily: 'monospace' }}>{listing.id}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  fontSize: '8pt',
                  fontWeight: 700,
                  borderRadius: 4,
                }}
              >
                {String(listing.status || '').toUpperCase()}
              </span>
              <Link to={`/vehicle/${listing.vehicle_id}`} className="button button-small">
                View Vehicle
              </Link>
            </div>
          </div>
          <div className="card-body" style={{ fontSize: '9pt' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Current</div>
                <div style={{ fontWeight: 800 }}>{formatCurrency(listing.current_high_bid_cents)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Bids</div>
                <div style={{ fontWeight: 800 }}>{Number(listing.bid_count || 0)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Time Remaining</div>
                <div style={{ fontWeight: 800 }}>{formatTimeRemaining(listing.auction_end_time)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Reserve</div>
                <div style={{ fontWeight: 800 }}>
                  {listing.reserve_price_cents ? formatCurrency(listing.reserve_price_cents) : 'No reserve'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {isOwner ? (
          <>
            <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="card-header" style={{ fontWeight: 800 }}>
                Premium Timing
              </div>
              <div className="card-body" style={{ fontSize: '9pt' }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Status</div>
                    <div style={{ fontWeight: 800 }}>
                      {String(listing.premium_status || 'none').toUpperCase()}
                      {typeof listing.premium_budget_cents === 'number' && listing.premium_budget_cents > 0
                        ? ` · ${formatCurrency(listing.premium_budget_cents)}`
                        : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      value={premiumBudgetUsd}
                      onChange={(e) => setPremiumBudgetUsd(e.target.value)}
                      placeholder="Budget USD"
                      min={0}
                      step="1"
                      style={{
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        fontSize: '9pt',
                        width: 140,
                      }}
                      disabled={premiumLoading}
                    />
                    <button
                      className="button button-small"
                      onClick={handlePurchasePremium}
                      disabled={premiumLoading}
                    >
                      {premiumLoading ? 'Processing...' : 'Buy Premium Timing'}
                    </button>
                  </div>
                </div>

                {premiumError && (
                  <div style={{ marginTop: 10, color: 'var(--error)', fontSize: '9pt' }}>{premiumError}</div>
                )}
                {premiumSuccess && (
                  <div style={{ marginTop: 10, color: 'var(--success)', fontSize: '9pt' }}>{premiumSuccess}</div>
                )}
                <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: '8pt' }}>
                  Premium timing is a scheduling priority rail. As we learn market patterns from ingested auction data, this budget will translate into better placement and targeted buyer outreach.
                </div>
              </div>
            </div>

            <OwnerAuctionDashboard listingId={listing.id} />
          </>
        ) : (
          <div className="card">
            <div className="card-header" style={{ fontWeight: 800 }}>Place Bid</div>
            <div className="card-body">
              <AuctionBiddingInterface listingId={listing.id} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

