import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

type ListingStatus = 'draft' | 'active' | 'sold' | 'cancelled' | 'expired' | string;
type SaleType = 'auction' | 'live_auction';

type VehicleSummary = {
  id: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  mileage?: number | null;
};

type NativeListing = {
  id: string;
  vehicle_id: string;
  sale_type: SaleType;
  status: ListingStatus;
  list_price_cents: number;
  reserve_price_cents: number | null;
  auction_start_time: string | null;
  auction_end_time: string | null;
  current_high_bid_cents: number | null;
  bid_count: number | null;
  created_at: string | null;
};

function formatCurrencyCents(cents: number | null | undefined): string {
  const n = typeof cents === 'number' ? cents : 0;
  return `$${(n / 100).toFixed(2)}`;
}

function buildDefaultAuctionDescription(vehicle: VehicleSummary): string {
  const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const trim = vehicle.trim ? ` ${vehicle.trim}` : '';
  const header = `${ymm}${trim}`.trim() || 'Vehicle';
  // Must satisfy DB readiness check: >= 120 characters.
  return (
    `${header}. This auction listing was generated from the Nuke vehicle profile. ` +
    `Review the full photo library, documented timeline, and supporting evidence in the profile. ` +
    `Bidders should inspect the provided images and notes before placing bids.`
  );
}

function getLocalDateInputValue(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLocalTimeInputValue(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function VehicleAuctionQuickStartCard(props: {
  vehicle: VehicleSummary;
  canManage: boolean;
}) {
  const { vehicle, canManage } = props;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState<NativeListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [saleType, setSaleType] = useState<SaleType>('auction');
  const [startingBidUsd, setStartingBidUsd] = useState<string>('');
  const [hasReserve, setHasReserve] = useState(false);
  const [reserveUsd, setReserveUsd] = useState<string>('');
  const [durationDays, setDurationDays] = useState<number>(7);
  const [durationMinutes, setDurationMinutes] = useState<number>(2);
  const [startMode, setStartMode] = useState<'now' | 'schedule'>('now');
  const [scheduledDate, setScheduledDate] = useState<string>(() => getLocalDateInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [scheduledTime, setScheduledTime] = useState<string>(() => getLocalTimeInputValue(new Date(Date.now() + 60 * 60 * 1000)));

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [readinessIssues, setReadinessIssues] = useState<Array<{ severity?: string; message?: string; code?: string }> | null>(null);

  const defaultDescription = useMemo(() => buildDefaultAuctionDescription(vehicle), [vehicle]);

  // Prevent background scroll while modal is open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!showModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [showModal]);

  const loadLatestListing = useCallback(async () => {
    if (!vehicle?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qError } = await supabase
        .from('vehicle_listings')
        .select(
          'id, vehicle_id, sale_type, status, list_price_cents, reserve_price_cents, auction_start_time, auction_end_time, current_high_bid_cents, bid_count, created_at'
        )
        .eq('vehicle_id', vehicle.id)
        .in('sale_type', ['auction', 'live_auction'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (qError) throw qError;
      const row = Array.isArray(data) && data.length > 0 ? (data[0] as any) : null;
      setListing(row ? (row as NativeListing) : null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load auction status');
      setListing(null);
    } finally {
      setLoading(false);
    }
  }, [vehicle?.id]);

  useEffect(() => {
    loadLatestListing();
  }, [loadLatestListing]);

  const openListing = (listingId: string) => {
    navigate(`/auction/${listingId}`);
  };

  const openModalWithDefaults = () => {
    setSubmitError(null);
    setReadinessIssues(null);

    // Defaults for quick-start: 2-minute live auction with a sane starting bid.
    setSaleType('live_auction');
    setStartingBidUsd('1000');
    setHasReserve(false);
    setReserveUsd('');
    setDurationDays(7);
    setDurationMinutes(2);
    setStartMode('now');

    // If the user switches to scheduling, default to ~1 hour from now.
    const d = new Date(Date.now() + 60 * 60 * 1000);
    setScheduledDate(getLocalDateInputValue(d));
    setScheduledTime(getLocalTimeInputValue(d));

    setShowModal(true);
  };

  const handleStartExistingDraft = async () => {
    if (!listing?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    setReadinessIssues(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('activate_auction_listing', {
        p_listing_id: listing.id,
        p_use_scheduled_time: false,
      });
      if (rpcError) throw rpcError;
      if (data?.success) {
        await loadLatestListing();
        openListing(listing.id);
        return;
      }
      const issues = Array.isArray(data?.readiness?.issues) ? data.readiness.issues : [];
      setReadinessIssues(issues);
      setSubmitError(data?.error || 'Auction not ready to start');
    } catch (e: any) {
      setSubmitError(e?.message || 'Failed to start auction');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAndMaybeStart = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setReadinessIssues(null);
    try {
      const { data: userResp, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const userId = userResp?.user?.id;
      if (!userId) throw new Error('Not signed in');

      const startingBid = Number(startingBidUsd);
      if (!Number.isFinite(startingBid) || startingBid <= 0) {
        throw new Error('Starting bid is required');
      }

      const reserveBid = Number(reserveUsd);
      const reserveCents =
        hasReserve && Number.isFinite(reserveBid) && reserveBid > 0 ? Math.floor(reserveBid * 100) : null;

      const durationMins = saleType === 'live_auction' ? Math.max(1, Math.floor(durationMinutes)) : Math.max(1, Math.floor(durationDays) * 24 * 60);

      let startTimeIso: string | null = null;
      if (startMode === 'schedule') {
        if (!scheduledDate || !scheduledTime) throw new Error('Scheduled date and time are required');
        const dt = new Date(`${scheduledDate}T${scheduledTime}`);
        if (Number.isNaN(dt.getTime())) throw new Error('Invalid scheduled time');
        startTimeIso = dt.toISOString();
      } else {
        startTimeIso = new Date().toISOString();
      }

      const endTimeIso = new Date(new Date(startTimeIso).getTime() + durationMins * 60 * 1000).toISOString();

      const { data: inserted, error: insertError } = await supabase
        .from('vehicle_listings')
        .insert({
          vehicle_id: vehicle.id,
          seller_id: userId,
          sale_type: saleType,
          status: 'draft',
          list_price_cents: Math.floor(startingBid * 100),
          reserve_price_cents: reserveCents,
          auction_start_time: startTimeIso,
          auction_end_time: endTimeIso,
          auction_duration_minutes: durationMins,
          sniping_protection_minutes: 2,
          description: defaultDescription,
          auto_start_enabled: startMode === 'schedule',
          auto_start_armed_at: startMode === 'schedule' ? new Date().toISOString() : null,
          schedule_strategy: startMode === 'schedule' ? 'auto' : 'manual',
          metadata: {
            created_via: 'vehicle_profile_quick_start',
            start_mode: startMode,
          },
        })
        .select('id')
        .single();

      if (insertError) {
        const status = (insertError as any)?.status;
        const code = String((insertError as any)?.code || '');
        // Unique violation (e.g. draft already exists). Open the existing draft/active listing instead of failing.
        if (status === 409 || code === '23505') {
          const { data: existing, error: qErr } = await supabase
            .from('vehicle_listings')
            .select('id, status')
            .eq('vehicle_id', vehicle.id)
            .in('status', ['draft', 'active'])
            .order('created_at', { ascending: false })
            .limit(1);
          if (!qErr) {
            const row = Array.isArray(existing) && existing.length > 0 ? (existing[0] as any) : null;
            const existingId = String(row?.id || '');
            if (existingId) {
              setShowModal(false);
              await loadLatestListing();
              openListing(existingId);
              return;
            }
          }
        }
        throw insertError;
      }
      const listingId = String((inserted as any)?.id || '');
      if (!listingId) throw new Error('Failed to create listing');

      if (startMode === 'now') {
        const { data, error: rpcError } = await supabase.rpc('activate_auction_listing', {
          p_listing_id: listingId,
          p_use_scheduled_time: false,
        });
        if (rpcError) throw rpcError;

        if (!data?.success) {
          const issues = Array.isArray(data?.readiness?.issues) ? data.readiness.issues : [];
          setReadinessIssues(issues);
          setSubmitError(data?.error || 'Auction not ready to start');
          // Keep the draft listing; user can fix the profile and start later.
          await loadLatestListing();
          return;
        }
      }

      setShowModal(false);
      await loadLatestListing();
      openListing(listingId);
    } catch (e: any) {
      setSubmitError(e?.message || 'Failed to create auction');
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = listing ? String(listing.status || '').toUpperCase() : 'NONE';
  const canOpen = Boolean(listing?.id);
  const isDraft = listing?.status === 'draft';
  const isActive = listing?.status === 'active';
  const canCreateNew = !isDraft && !isActive;

  const modalNode = showModal ? (
    // Render the modal in a portal to avoid "position: fixed" being scoped by transformed ancestors,
    // which can cause major flicker/clipping on complex pages.
    <div
      className="modal-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0, 0, 0, 0.35)' }}
      onClick={() => !submitting && setShowModal(false)}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Start Auction</div>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="vehicle-detail">
              <span>Auction Type</span>
              <select
                value={saleType}
                onChange={(e) => setSaleType(e.target.value as SaleType)}
                style={{ padding: '6px', fontSize: '9pt' }}
                disabled={submitting}
              >
                <option value="auction">Standard auction (days)</option>
                <option value="live_auction">Live auction (minutes)</option>
              </select>
            </div>

            <div className="vehicle-detail">
              <span>Starting Bid (USD)</span>
              <input
                type="number"
                min={1}
                step={1}
                value={startingBidUsd}
                onChange={(e) => setStartingBidUsd(e.target.value)}
                placeholder="1000"
                disabled={submitting}
                style={{ padding: '6px', fontSize: '9pt' }}
              />
            </div>

            <div className="vehicle-detail">
              <span>Reserve</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={hasReserve}
                  onChange={(e) => setHasReserve(e.target.checked)}
                  disabled={submitting}
                />
                <span className="text text-muted" style={{ fontSize: '9pt' }}>
                  Enable reserve
                </span>
              </label>
            </div>

            {hasReserve ? (
              <div className="vehicle-detail">
                <span>Reserve Price (USD)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={reserveUsd}
                  onChange={(e) => setReserveUsd(e.target.value)}
                  placeholder="25000"
                  disabled={submitting}
                  style={{ padding: '6px', fontSize: '9pt' }}
                />
              </div>
            ) : null}

            {saleType === 'live_auction' ? (
              <div className="vehicle-detail">
                <span>Duration (minutes)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  disabled={submitting}
                  style={{ padding: '6px', fontSize: '9pt' }}
                />
              </div>
            ) : (
              <div className="vehicle-detail">
                <span>Duration (days)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(Number(e.target.value))}
                  disabled={submitting}
                  style={{ padding: '6px', fontSize: '9pt' }}
                />
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="startMode"
                    checked={startMode === 'now'}
                    onChange={() => setStartMode('now')}
                    disabled={submitting}
                  />
                  <span style={{ fontSize: '9pt' }}>Start now</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="radio"
                    name="startMode"
                    checked={startMode === 'schedule'}
                    onChange={() => setStartMode('schedule')}
                    disabled={submitting}
                  />
                  <span style={{ fontSize: '9pt' }}>Schedule</span>
                </label>
              </div>

              {startMode === 'schedule' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <div>
                    <div className="text text-muted" style={{ fontSize: '9pt', marginBottom: 4 }}>Date</div>
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      disabled={submitting}
                      style={{ padding: '6px', fontSize: '9pt', width: '100%' }}
                    />
                  </div>
                  <div>
                    <div className="text text-muted" style={{ fontSize: '9pt', marginBottom: 4 }}>Time</div>
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      disabled={submitting}
                      style={{ padding: '6px', fontSize: '9pt', width: '100%' }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {submitError ? (
              <div className="text" style={{ fontSize: '9pt', color: 'var(--error-text, #dc2626)' }}>
                {submitError}
              </div>
            ) : null}

            {readinessIssues && readinessIssues.length > 0 ? (
              <div style={{ border: '1px solid var(--border-light)', padding: 10, background: 'var(--grey-50)' }}>
                <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: 6 }}>Readiness issues</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '9pt' }}>
                  {readinessIssues.slice(0, 6).map((i, idx) => (
                    <li key={idx}>
                      <span style={{ fontWeight: 700 }}>{String(i?.severity || 'info').toUpperCase()}:</span>{' '}
                      {String(i?.message || i?.code || '')}
                    </li>
                  ))}
                </ul>
                <div className="text text-muted" style={{ fontSize: '9pt', marginTop: 6 }}>
                  Fix the profile data gaps (images, description, etc.) and try again.
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modal-footer">
          <button className="button" disabled={submitting} onClick={() => setShowModal(false)}>
            Cancel
          </button>
          <button className="button button-primary" disabled={submitting} onClick={handleCreateAndMaybeStart}>
            {submitting ? 'Working...' : startMode === 'schedule' ? 'Schedule Auction' : 'Start Auction'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>AUCTION</span>
        <span className={`badge ${isActive ? 'badge-success' : isDraft ? 'badge-secondary' : 'badge-secondary'}`}>
          {statusLabel || 'AUCTION'}
        </span>
      </div>
      <div className="card-body">
        {loading ? (
          <div className="text text-muted" style={{ fontSize: '9pt' }}>Loading auction status...</div>
        ) : error ? (
          <div className="text" style={{ fontSize: '9pt', color: 'var(--error-text, #dc2626)' }}>{error}</div>
        ) : listing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="vehicle-detail">
              <span>Type</span>
              <span style={{ fontWeight: 700 }}>{String(listing.sale_type || '').toUpperCase()}</span>
            </div>
            <div className="vehicle-detail">
              <span>Starting Bid</span>
              <span style={{ fontWeight: 700 }}>{formatCurrencyCents(listing.list_price_cents)}</span>
            </div>
            <div className="vehicle-detail">
              <span>High Bid</span>
              <span style={{ fontWeight: 700 }}>{formatCurrencyCents(listing.current_high_bid_cents)}</span>
            </div>
            <div className="vehicle-detail">
              <span>Bids</span>
              <span style={{ fontWeight: 700 }}>{String(listing.bid_count ?? 0)}</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 4 }}>
              <button
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
                disabled={!canOpen}
                onClick={() => listing?.id && openListing(listing.id)}
              >
                Open Auction
              </button>
              {canManage && isDraft ? (
                <button
                  className="button button-primary"
                  style={{ fontSize: '9pt' }}
                  disabled={submitting}
                  onClick={handleStartExistingDraft}
                >
                  {submitting ? 'Starting...' : 'Start Now'}
                </button>
              ) : null}
              {canManage ? (
                <button
                  className="button"
                  style={{ fontSize: '9pt' }}
                  disabled={!canCreateNew}
                  title={
                    canCreateNew
                      ? 'Create a new auction'
                      : 'You already have a draft or active auction. Open it (or cancel it) before creating a new one.'
                  }
                  onClick={() => canCreateNew && openModalWithDefaults()}
                >
                  New Auction
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="text text-muted" style={{ fontSize: '9pt' }}>
              Auctions are a culmination of your profile data. Starting runs a readiness scan and blocks if required
              info is missing.
            </div>
            {canManage ? (
              <button
                className="button button-primary"
                style={{ fontSize: '9pt', width: 'fit-content' }}
                onClick={() => {
                  openModalWithDefaults();
                }}
              >
                Auction This Vehicle
              </button>
            ) : (
              <div className="text text-muted" style={{ fontSize: '9pt' }}>
                Claim or verify ownership to start an auction.
              </div>
            )}
          </div>
        )}

        {typeof document !== 'undefined' && modalNode ? createPortal(modalNode, document.body) : null}
      </div>
    </div>
  );
}

