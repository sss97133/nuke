import React, { useEffect, useState } from 'react';
import type { VehicleHeaderProps } from './types';
import { computePrimaryPrice, computeDelta, formatCurrency } from '../../services/priceSignalService';
import { supabase } from '../../lib/supabase';
// Deprecated modals (history/analysis/tag review) intentionally removed from UI
import { VehicleValuationService } from '../../services/vehicleValuationService';
import TradePanel from '../../components/trading/TradePanel';

const VehicleHeader: React.FC<VehicleHeaderProps> = ({
  vehicle,
  session,
  permissions,
  responsibleName,
  onPriceClick
}) => {
  const { isVerifiedOwner, contributorRole } = permissions;
  const [rpcSignal, setRpcSignal] = useState<any | null>(null);
  const [trendPct30d, setTrendPct30d] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useState<'auto'|'estimate'|'auction'|'asking'|'sale'|'purchase'|'msrp'>('auto');
  const [responsibleMode, setResponsibleMode] = useState<'auto'|'owner'|'consigner'|'uploader'|'listed_by'|'custom'>('auto');
  const [responsibleCustom, setResponsibleCustom] = useState<string>('');
  const [valuation, setValuation] = useState<any | null>(null);
  const [loadingValuation, setLoadingValuation] = useState(false);
  const [latestInsight, setLatestInsight] = useState<any | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showTrade, setShowTrade] = useState(false);
  const [showOwnerCard, setShowOwnerCard] = useState(false);
  const [ownerProfile, setOwnerProfile] = useState<any | null>(null);
  const [ownerStats, setOwnerStats] = useState<{ contributions: number; vehicles: number } | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) { setRpcSignal(null); return; }
        const { data, error } = await supabase.rpc('vehicle_price_signal', { vehicle_ids: [vehicle.id] });
        if (!error && Array.isArray(data) && data.length > 0) {
          setRpcSignal(data[0]);
        } else {
          setRpcSignal(null);
        }
      } catch {
        setRpcSignal(null);
      }
    })();
  }, [vehicle?.id]);

  // Load valuation for Crown Jewel display
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) { setValuation(null); return; }
        setLoadingValuation(true);
        const v = await VehicleValuationService.getValuation(vehicle.id);
        setValuation(v);
      } catch {
        setValuation(null);
      } finally {
        setLoadingValuation(false);
      }
    })();
  }, [vehicle?.id]);

  // Load owner's preferred display settings (if the table/columns exist)
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) return;
        const { data, error } = await supabase
          .from('vehicle_sale_settings')
          .select('display_price_mode, display_responsible_mode, display_responsible_custom')
          .eq('vehicle_id', vehicle.id)
          .maybeSingle();
        if (!error && data) {
          if (typeof (data as any).display_price_mode === 'string') {
            setDisplayMode(((data as any).display_price_mode as any) || 'auto');
          }
          if (typeof (data as any).display_responsible_mode === 'string') {
            setResponsibleMode(((data as any).display_responsible_mode as any) || 'auto');
          }
          if (typeof (data as any).display_responsible_custom === 'string') {
            setResponsibleCustom((data as any).display_responsible_custom || '');
          }
        }
      } catch {
        // ignore if table/column missing
      }
    })();
  }, [vehicle?.id]);

  // Load 30d trend from price history (prefer current/asking/sale types)
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) { setTrendPct30d(null); return; }
        const { data, error } = await supabase
          .from('vehicle_price_history')
          .select('price_type,value,as_of')
          .eq('vehicle_id', vehicle.id)
          .in('price_type', ['current','asking','sale'])
          .order('as_of', { ascending: false })
          .limit(50);
        if (error || !Array.isArray(data) || data.length < 2) {
          setTrendPct30d(null);
          return;
        }
        const now = Date.now();
        const since = now - 30 * 24 * 60 * 60 * 1000;
        const within30 = (data as any[]).filter(d => new Date(d.as_of).getTime() >= since);
        const arr = within30.length >= 2 ? within30 : (data as any[]);
        if (arr.length < 2) { setTrendPct30d(null); return; }
        const latest = arr[0];
        const baseline = arr[arr.length - 1];
        if (!latest?.value || !baseline?.value || baseline.value === 0) { setTrendPct30d(null); return; }
        const pct = ((latest.value - baseline.value) / baseline.value) * 100;
        setTrendPct30d(pct);
      } catch {
        setTrendPct30d(null);
      }
    })();
  }, [vehicle?.id]);

  // Load latest AI image insight for status chips
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) { setLatestInsight(null); return; }
        const { data } = await supabase
          .from('profile_image_insights')
          .select('summary, condition_score, condition_label, confidence, checklist, summary_date')
          .eq('vehicle_id', vehicle.id)
          .order('summary_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        setLatestInsight(data || null);
      } catch {
        setLatestInsight(null);
      }
    })();
  }, [vehicle?.id]);

  // Load owner profile and stats when owner card opens
  useEffect(() => {
    if (!showOwnerCard) return;
    (async () => {
      try {
        const ownerId = (vehicle as any)?.uploaded_by || (vehicle as any)?.user_id;
        if (!ownerId) return;
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .eq('id', ownerId)
          .maybeSingle();
        setOwnerProfile(profile || null);
        const { count: contribCount } = await supabase
          .from('user_contributions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', ownerId);
        const { count: vehicleCount } = await supabase
          .from('vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', ownerId);
        setOwnerStats({ contributions: contribCount || 0, vehicles: vehicleCount || 0 });
        if (session?.user?.id) {
          const { data: follow } = await supabase
            .from('user_follows')
            .select('id')
            .eq('follower_id', session.user.id)
            .eq('following_id', ownerId)
            .maybeSingle();
          setIsFollowing(!!follow);
        }
      } catch (err) {
        console.warn('Owner card load failed:', err);
      }
    })();
  }, [showOwnerCard, vehicle, session?.user?.id]);

  const smallChipStyle: React.CSSProperties = {
    background: '#f3f4f6',
    border: '1px solid #c0c0c0',
    padding: '1px 4px',
    borderRadius: '2px',
    fontSize: '8pt',
    color: '#374151'
  };

  const getAutoDisplay = () => {
    if (!vehicle) return { amount: null as number | null, label: '' };
    // Auction current bid
    if (vehicle.auction_source && vehicle.bid_count && typeof vehicle.current_bid === 'number') {
      return { amount: vehicle.current_bid, label: 'Current Bid' };
    }
    // Asking
    if (vehicle.is_for_sale && typeof vehicle.asking_price === 'number') {
      return { amount: vehicle.asking_price, label: 'Asking' };
    }
    // Sold
    if (typeof vehicle.sale_price === 'number') {
      return { amount: vehicle.sale_price, label: 'Sold for' };
    }
    // Estimate
    if (typeof vehicle.current_value === 'number') {
      return { amount: vehicle.current_value, label: 'Estimated Value' };
    }
    // Purchase
    if (typeof vehicle.purchase_price === 'number') {
      return { amount: vehicle.purchase_price, label: 'Purchase Price' };
    }
    // MSRP
    if (typeof vehicle.msrp === 'number') {
      return { amount: vehicle.msrp, label: 'Original MSRP' };
    }
    return { amount: null, label: '' };
  };

  const getDisplayValue = () => {
    if (!vehicle) return { amount: null as number | null, label: '' };
    const mode = displayMode || 'auto';
    if (mode === 'auto') {
      // Prefer computed valuation if available
      if (valuation && typeof valuation.estimatedValue === 'number' && valuation.estimatedValue > 0) {
        return { amount: valuation.estimatedValue, label: 'Estimated Value' };
      }
      return getAutoDisplay();
    }
    if (mode === 'estimate') {
      // Prefer unified valuation service
      if (valuation && typeof valuation.estimatedValue === 'number' && valuation.estimatedValue > 0) {
        return { amount: valuation.estimatedValue, label: 'Estimated Value' };
      }
      // Fallback to RPC/primary price heuristic
      if (rpcSignal && typeof rpcSignal.primary_value === 'number' && rpcSignal.primary_label) {
        return { amount: rpcSignal.primary_value, label: rpcSignal.primary_label };
      }
      const pi = computePrimaryPrice({
        msrp: (vehicle as any).msrp,
        current_value: (vehicle as any).current_value,
        purchase_price: (vehicle as any).purchase_price,
        asking_price: (vehicle as any).asking_price,
        sale_price: (vehicle as any).sale_price,
        is_for_sale: (vehicle as any).is_for_sale,
      } as any);
      return { amount: typeof pi.amount === 'number' ? pi.amount : null, label: pi.label || 'Estimated Value' };
    }
    if (mode === 'auction') return { amount: typeof vehicle.current_bid === 'number' ? vehicle.current_bid : null, label: 'Current Bid' };
    if (mode === 'asking') return { amount: typeof vehicle.asking_price === 'number' ? vehicle.asking_price : null, label: 'Asking Price' };
    if (mode === 'sale') return { amount: typeof vehicle.sale_price === 'number' ? vehicle.sale_price : null, label: 'Sold for' };
    if (mode === 'purchase') return { amount: typeof vehicle.purchase_price === 'number' ? vehicle.purchase_price : null, label: 'Purchase Price' };
    if (mode === 'msrp') return { amount: typeof vehicle.msrp === 'number' ? vehicle.msrp : null, label: 'Original MSRP' };
    return getAutoDisplay();
  };

  const persistDisplayMode = async (mode: typeof displayMode) => {
    setDisplayMode(mode);
    try {
      if (!vehicle?.id) return;
      await supabase
        .from('vehicle_sale_settings')
        .upsert({ vehicle_id: vehicle.id, display_price_mode: mode, updated_at: new Date().toISOString() } as any, { onConflict: 'vehicle_id' });
    } catch (e) {
      console.debug('Display mode persistence skipped/failed:', e);
    }
  };

  const persistResponsibleSettings = async (mode: typeof responsibleMode, custom?: string) => {
    setResponsibleMode(mode);
    if (typeof custom === 'string') setResponsibleCustom(custom);
    try {
      if (!vehicle?.id) return;
      await supabase
        .from('vehicle_sale_settings')
        .upsert({
          vehicle_id: vehicle.id,
          display_responsible_mode: mode,
          display_responsible_custom: typeof custom === 'string' ? custom : responsibleCustom,
          updated_at: new Date().toISOString()
        } as any, { onConflict: 'vehicle_id' });
    } catch (e) {
      console.debug('Responsible mode persistence skipped/failed:', e);
    }
  };

  const isRowOwner = !!(session?.user?.id && (vehicle as any)?.user_id && session?.user?.id === (vehicle as any).user_id);
  const isUploaderAsTempOwner = !!(session?.user?.id && !((vehicle as any)?.user_id) && session?.user?.id === vehicle.uploaded_by);
  const isOwnerLike = isVerifiedOwner || contributorRole === 'owner' || isRowOwner || isUploaderAsTempOwner;

  const computeResponsibleLabel = (): string => {
    const mode = responsibleMode || 'auto';
    if (mode === 'custom' && responsibleCustom.trim()) return responsibleCustom.trim();
    if (mode === 'owner') return 'Owner';
    if (mode === 'consigner') return 'Consigner';
    if (mode === 'uploader') return 'Uploader';
    if (mode === 'listed_by') return 'Listed by';
    // auto
    return ((isRowOwner || isVerifiedOwner || contributorRole === 'owner' || isUploaderAsTempOwner) && 'Owner')
      || (contributorRole === 'consigner' && 'Consigner')
      || (session?.user?.id === vehicle.uploaded_by && 'Uploader')
      || 'Listed by';
  };

  const getPriceLabel = () => {
    if (!vehicle) return '';

    // Active auction
    if (vehicle.auction_source && vehicle.bid_count && typeof vehicle.current_bid === 'number') {
      return `Current Bid (${vehicle.bid_count} bids)`;
    }

    // For sale
    if (vehicle.is_for_sale && typeof vehicle.asking_price === 'number') {
      return 'Asking Price';
    }

    // Sold
    if (typeof vehicle.sale_price === 'number') {
      return 'Sold for';
    }

    // Current value
    if (typeof vehicle.current_value === 'number') {
      return 'Estimated Value';
    }

    if (typeof vehicle.purchase_price === 'number') {
      return 'Purchase Price';
    }

    // MSRP
    if (typeof vehicle.msrp === 'number') {
      return 'Original MSRP';
    }
    return '';
  };

  return (
    <div
      className="vehicle-price-header"
      style={{
        background: 'var(--white)',
        border: 'none',
        padding: '12px 16px',
        margin: '0',
        fontFamily: 'Arial, sans-serif',
        position: 'sticky',
        top: 48,
        zIndex: 10,
        borderBottom: '1px solid #e5e5e5',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}
    >
      {/* Combined single-row layout (wraps on narrow screens) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* Price block (far left) */}
        {(() => {
          const { amount, label } = getDisplayValue();
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div onClick={onPriceClick} title="Click to view price analysis" style={{ display: 'flex', alignItems: 'baseline', gap: 6, cursor: 'pointer' }}>
                <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text)' }}>
                  {typeof amount === 'number' ? `$${amount.toLocaleString()}` : 'Price not available'}
                </div>
                {label && <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{label}</span>}
              </div>
              <button
                onClick={() => setShowTrade(true)}
                className="button button-small button-primary"
                style={{ fontSize: '8pt', borderRadius: 0 }}
                title="Trade shares for this vehicle"
              >
                Trade Shares
              </button>
              {isOwnerLike && (
                <select
                  value={displayMode}
                  onChange={(e) => persistDisplayMode(e.target.value as any)}
                  title="Select display price"
                  className="form-select"
                  style={{ fontSize: '10px' }}
                >
                  <option value="auto">Auto</option>
                  <option value="estimate">Estimate</option>
                  <option value="auction">Auction Bid</option>
                  <option value="asking">Asking</option>
                  <option value="sale">Sale</option>
                  <option value="purchase">Purchase</option>
                  <option value="msrp">MSRP</option>
                </select>
              )}
            </div>
          );
        })()}

        {/* Title */}
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)' }}>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </div>

        {/* Sources popover toggler */}
        {valuation && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSources(s => !s)}
              className="button button-small"
              title="Show valuation sources"
              style={{ fontSize: '8pt', borderRadius: 0 }}
            >
              Sources
            </button>
            {showSources && (
              <div
                style={{
                  position: 'absolute',
                  top: '120%',
                  left: 0,
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  padding: 8,
                  width: 260,
                  zIndex: 50,
                  fontSize: '10px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong>Valuation Sources</strong>
                  <span style={{ color: '#6b7280' }}>{Math.round(valuation.confidence || 0)}% conf</span>
                </div>
                {Array.isArray(valuation.dataSources) && valuation.dataSources.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {valuation.dataSources.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ color: '#6b7280' }}>No sources listed</div>
                )}
                <div style={{ borderTop: '1px solid var(--border-light)', marginTop: 6, paddingTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={{ color: '#6b7280' }}>Invested</div>
                    <div style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                      {typeof valuation.totalInvested === 'number' ? `$${Math.round(valuation.totalInvested).toLocaleString()}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280' }}>Labor (h)</div>
                    <div style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                      {typeof valuation.laborHours === 'number' ? valuation.laborHours.toFixed(1) : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280' }}>Range</div>
                    <div style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                      {valuation.marketLow && valuation.marketHigh
                        ? `$${Math.round(valuation.marketLow).toLocaleString()}–$${Math.round(valuation.marketHigh).toLocaleString()}`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280' }}>Updated</div>
                    <div style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                      {valuation.lastUpdated ? new Date(valuation.lastUpdated).toLocaleDateString() : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status chips removed per design feedback; details shown in Sources popover */}

        {/* Sale badge */}
        {vehicle.is_for_sale && (
          <div className="badge badge-success" style={{ background: '#166534', color: 'white', fontWeight: 'bold' }}>
            FOR SALE
          </div>
        )}

        {/* Responsible badge + owner controls */}
        {responsibleName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
            <div
              className="badge badge-primary"
              title="Click for profile preview"
              style={{ textDecoration: 'none', cursor: 'pointer' }}
              onClick={async (e) => {
                e.preventDefault();
                if (showOwnerCard) {
                  window.location.href = `/profile/${(vehicle as any).uploaded_by || (vehicle as any).user_id || ''}`;
                } else {
                  setShowOwnerCard(true);
                }
              }}
            >
              {computeResponsibleLabel()}: {responsibleName}
            </div>
            {showOwnerCard && ownerProfile && (
              <div
                style={{
                  position: 'absolute',
                  top: '120%',
                  left: 0,
                  background: 'white',
                  border: '2px solid var(--border)',
                  borderRadius: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  padding: 12,
                  width: 280,
                  zIndex: 100,
                  fontSize: '9pt'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  {ownerProfile.avatar_url && (
                    <img src={ownerProfile.avatar_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)' }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{ownerProfile.full_name || ownerProfile.username || 'User'}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>@{ownerProfile.username || ownerProfile.id.slice(0,8)}</div>
                  </div>
                </div>
                {ownerStats && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: '8pt', color: 'var(--text-muted)' }}>
                    <span>{ownerStats.contributions} contributions</span>
                    <span>{ownerStats.vehicles} vehicles</span>
                  </div>
                )}
                <button
                  className="button button-primary button-small"
                  onClick={async () => {
                    if (!session?.user?.id) return;
                    const ownerId = ownerProfile.id;
                    if (isFollowing) {
                      await supabase.from('user_follows').delete().eq('follower_id', session.user.id).eq('following_id', ownerId);
                      setIsFollowing(false);
                    } else {
                      await supabase.from('user_follows').insert({ follower_id: session.user.id, following_id: ownerId });
                      setIsFollowing(true);
                    }
                  }}
                  style={{ fontSize: '8pt', width: '100%' }}
                  disabled={!session?.user?.id}
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </button>
                <div style={{ marginTop: 6, fontSize: '7pt', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Click badge again to view full profile
                </div>
              </div>
            )}
            {isOwnerLike && (
              <>
                <select
                  value={responsibleMode}
                  onChange={(e) => persistResponsibleSettings(e.target.value as any)}
                  title="Select responsible label"
                  className="form-select"
                  style={{ fontSize: '10px' }}
                >
                  <option value="auto">Auto</option>
                  <option value="owner">Owner</option>
                  <option value="consigner">Consigner</option>
                  <option value="uploader">Uploader</option>
                  <option value="listed_by">Listed by</option>
                  <option value="custom">Custom…</option>
                </select>
                {responsibleMode === 'custom' && (
                  <input
                    value={responsibleCustom}
                    onChange={(e) => persistResponsibleSettings('custom', e.target.value)}
                    placeholder="Label"
                    className="form-input"
                    style={{ fontSize: '10px' }}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Deprecated actions removed: History / Analysis / Review Tags */}
      </div>
      {/* Trade Modal */}
      {showTrade && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setShowTrade(false)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '520px', maxWidth: '95vw' }}>
            <TradePanel
              vehicleId={vehicle.id}
              vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              currentSharePrice={(valuation && typeof valuation.sharePrice === 'number') ? valuation.sharePrice : 1.00}
              totalShares={1000}
            />
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button className="button button-small" onClick={() => setShowTrade(false)} style={{ fontSize: '8pt' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Valuation Crown Jewel REMOVED - Redundant with VehiclePricingWidget below */}
    </div>
  );
};

export default VehicleHeader;