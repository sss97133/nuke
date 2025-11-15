import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [showTrade, setShowTrade] = useState(false);
  const [showOwnerCard, setShowOwnerCard] = useState(false);
  const [ownerProfile, setOwnerProfile] = useState<any | null>(null);
  const [ownerStats, setOwnerStats] = useState<{ contributions: number; vehicles: number } | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [priceMenuOpen, setPriceMenuOpen] = useState(false);
  const priceMenuRef = useRef<HTMLDivElement | null>(null);

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
        const v = await VehicleValuationService.getValuation(vehicle.id);
        setValuation(v);
      } catch {
        setValuation(null);
      } finally {
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

  // Close price popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!priceMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!priceMenuRef.current) return;
      if (!priceMenuRef.current.contains(event.target as Node)) {
        setPriceMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPriceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [priceMenuOpen]);

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

  const formatVinStub = (vin?: string | null) => {
    if (!vin) return 'VIN pending';
    if (vin.length <= 8) return vin.toUpperCase();
    return `${vin.slice(0, 4).toUpperCase()}···${vin.slice(-4).toUpperCase()}`;
  };

  const formatShortDate = (value?: string | null) => {
    if (!value) return undefined;
    try {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
    } catch {
      return undefined;
    }
  };

  const fieldSource = (field: string, fallback?: string) => (vehicle as any)?.[`${field}_source`] || fallback;
  const fieldConfidence = (field: string) => {
    const value = (vehicle as any)?.[`${field}_confidence`];
    return typeof value === 'number' ? value : undefined;
  };

  type PriceEntry = {
    id: string;
    label: string;
    amount: number;
    source?: string;
    date?: string | null;
    confidence?: number;
    note?: string;
  };

  const priceEntries = useMemo<PriceEntry[]>(() => {
    if (!vehicle) return [];
    const entries: PriceEntry[] = [];
    const pushEntry = (entry: Omit<PriceEntry, 'amount'> & { amount?: number | null }) => {
      if (typeof entry.amount === 'number' && !Number.isNaN(entry.amount) && entry.amount > 0) {
        entries.push({ ...entry, amount: entry.amount });
      }
    };

    const saleDate = (vehicle as any)?.sale_date || (vehicle as any)?.bat_sale_date || null;
    pushEntry({
      id: 'sale',
      label: 'Recorded Sale',
      amount: vehicle.sale_price,
      date: saleDate,
      source: fieldSource('sale_price', (vehicle as any)?.platform_source || 'Vehicle record'),
      confidence: fieldConfidence('sale_price')
    });

    const batSale = (vehicle as any)?.bat_sold_price;
    if (typeof batSale === 'number' && batSale !== vehicle.sale_price) {
      pushEntry({
        id: 'bat_sale',
        label: 'Bring a Trailer Result',
        amount: batSale,
        date: (vehicle as any)?.bat_sale_date || saleDate,
        source: 'Bring a Trailer',
        confidence: fieldConfidence('bat_sold_price')
      });
    }

    pushEntry({
      id: 'asking',
      label: 'Asking Price',
      amount: vehicle.asking_price,
      date: (vehicle as any)?.asking_price_date || null,
      source: fieldSource('asking_price', 'Seller provided'),
      confidence: fieldConfidence('asking_price')
    });

    pushEntry({
      id: 'auction',
      label: vehicle.auction_source ? `${vehicle.auction_source} Bid` : 'Current Bid',
      amount: vehicle.current_bid,
      date: vehicle.auction_end_date || null,
      source: vehicle.auction_source || undefined,
      note: vehicle.bid_count ? `${vehicle.bid_count} bids` : undefined
    });

    pushEntry({
      id: 'purchase',
      label: 'Purchase Price',
      amount: vehicle.purchase_price,
      date: (vehicle as any)?.purchase_date || null,
      source: fieldSource('purchase_price', 'Owner provided'),
      confidence: fieldConfidence('purchase_price')
    });

    const estimatedValue = valuation && typeof valuation.estimatedValue === 'number'
      ? valuation.estimatedValue
      : (vehicle.current_value || null);
    pushEntry({
      id: 'estimate',
      label: 'Estimated Value',
      amount: estimatedValue as number,
      date: valuation?.lastUpdated || null,
      source: valuation?.dataSources?.length ? valuation.dataSources[0] : 'Valuation engine',
      confidence: valuation?.confidence
    });

    pushEntry({
      id: 'msrp',
      label: 'Original MSRP',
      amount: vehicle.msrp,
      date: vehicle.year ? `${vehicle.year}` : undefined,
      source: 'Factory data'
    });

    const order = ['sale', 'bat_sale', 'asking', 'auction', 'estimate', 'purchase', 'msrp'];
    const priority = (id: string) => {
      const idx = order.indexOf(id);
      return idx === -1 ? order.length : idx;
    };
    return entries
      .filter((entry, index, self) =>
        entry && typeof entry.amount === 'number' &&
        self.findIndex(s => s.label === entry.label && s.amount === entry.amount) === index
      )
      .sort((a, b) => priority(a.id) - priority(b.id));
  }, [vehicle, valuation]);

  const primaryPrice = getDisplayValue();
  const primaryAmount = typeof primaryPrice.amount === 'number' ? primaryPrice.amount : null;
  const primaryLabel = primaryPrice.label || 'Price pending';
  const priceText = primaryAmount !== null ? formatCurrency(primaryAmount) : 'Set a price';

  const saleDate = (vehicle as any)?.sale_date || (vehicle as any)?.bat_sale_date || null;
  const statusText = vehicle.is_for_sale
    ? 'For sale'
    : saleDate
      ? `Sold ${formatShortDate(saleDate)}`
      : 'Not listed';

  const metaRows = [
    { label: 'VIN', value: formatVinStub(vehicle.vin) },
    { label: computeResponsibleLabel(), value: responsibleName || 'Unassigned' },
    { label: 'Status', value: statusText },
    trendPct30d !== null ? { label: '30d Δ', value: `${trendPct30d >= 0 ? '+' : ''}${trendPct30d.toFixed(1)}%` } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const baseTextColor = 'var(--text)';
  const mutedTextColor = 'var(--text-muted)';

  const handleViewValuation = () => {
    setPriceMenuOpen(false);
    onPriceClick();
  };

  const handleTradeClick = () => {
    setPriceMenuOpen(false);
    setShowTrade(true);
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
        borderBottom: '1px solid var(--border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16 }}>
        {/* Vehicle identity */}
        <div style={{ flex: '1 1 320px', minWidth: 0, color: baseTextColor }}>
          <div style={{ fontSize: '8pt', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            Vehicle
          </div>
          <div style={{ fontSize: '8pt', fontWeight: 600, marginTop: 4 }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {metaRows.map((row) => {
              const isResponsibleRow = row.label === computeResponsibleLabel();
              return (
                <div key={`${row.label}-${row.value}`} style={{ fontSize: '8pt', display: 'flex', gap: 6, alignItems: 'baseline', position: isResponsibleRow ? 'relative' : 'static' }}>
                  <span style={{ color: mutedTextColor, minWidth: 64 }}>
                    {row.label}
                  </span>
                  <span
                    style={{
                      color: baseTextColor,
                      fontWeight: isResponsibleRow ? 600 : 400,
                      cursor: isResponsibleRow && responsibleName ? 'pointer' : 'default'
                    }}
                    onClick={async (e) => {
                      if (!isResponsibleRow || !responsibleName) return;
                      e.preventDefault();
                      if (showOwnerCard) {
                        window.location.href = `/profile/${(vehicle as any).uploaded_by || (vehicle as any).user_id || ''}`;
                      } else {
                        setShowOwnerCard(true);
                      }
                    }}
                  >
                    {row.value}
                  </span>
                  {isResponsibleRow && showOwnerCard && ownerProfile && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '120%',
                        left: 0,
                        background: 'white',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                        padding: 12,
                        width: 260,
                        zIndex: 50
                      }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                        {ownerProfile.avatar_url && (
                          <img src={ownerProfile.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)' }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '8pt' }}>
                            {ownerProfile.full_name || ownerProfile.username || 'Profile'}
                          </div>
                          <div style={{ fontSize: '7pt', color: mutedTextColor }}>
                            @{ownerProfile.username || ownerProfile.id.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                      {ownerStats && (
                        <div style={{ display: 'flex', gap: 12, fontSize: '7pt', color: mutedTextColor }}>
                          <span>{ownerStats.contributions} contributions</span>
                          <span>{ownerStats.vehicles} vehicles</span>
                        </div>
                      )}
                      <button
                        className="button button-small"
                        style={{ width: '100%', marginTop: 8, fontSize: '8pt' }}
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
                      >
                        {isFollowing ? 'Following' : 'Follow'}
                      </button>
                      <div style={{ fontSize: '7pt', color: mutedTextColor, marginTop: 6, textAlign: 'center' }}>
                        Click name again to open full profile
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isOwnerLike && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '7pt', color: mutedTextColor }}>
                Responsible label
              </label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={responsibleMode}
                  onChange={(e) => persistResponsibleSettings(e.target.value as any)}
                  className="form-select"
                  style={{ fontSize: '8pt', padding: '2px 4px' }}
                >
                  <option value="auto">Auto</option>
                  <option value="owner">Owner</option>
                  <option value="consigner">Consigner</option>
                  <option value="uploader">Uploader</option>
                  <option value="listed_by">Listed by</option>
                  <option value="custom">Custom</option>
                </select>
                {responsibleMode === 'custom' && (
                  <input
                    value={responsibleCustom}
                    onChange={(e) => persistResponsibleSettings('custom', e.target.value)}
                    placeholder="Label"
                    className="form-input"
                    style={{ fontSize: '8pt', padding: '2px 4px' }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Price band */}
        <div ref={priceMenuRef} style={{ flex: '0 0 auto', minWidth: 220, textAlign: 'right' }}>
          <button
            type="button"
            onClick={() => setPriceMenuOpen((open) => !open)}
            style={{
              width: '100%',
              background: 'white',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              padding: '10px 12px',
              cursor: 'pointer'
            }}
          >
            <div style={{ fontSize: '12pt', fontWeight: 700, color: baseTextColor }}>
              {priceText}
            </div>
            <div style={{ fontSize: '8pt', color: mutedTextColor, marginTop: 2 }}>
              {primaryLabel}
            </div>
          </button>

          {priceMenuOpen && (
            <div
              style={{
                marginTop: 8,
                background: 'white',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                boxShadow: '0 12px 24px rgba(15, 23, 42, 0.15)',
                padding: 12,
                fontSize: '8pt',
                color: baseTextColor
              }}
            >
              <div style={{ fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                Price timeline
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {priceEntries.length === 0 && (
                  <div style={{ color: mutedTextColor }}>
                    No price data has been recorded yet. Add a receipt, BaT link, or asking price to populate this list.
                  </div>
                )}
                {priceEntries.map((entry) => (
                  <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ textAlign: 'left', flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{entry.label}</div>
                      <div style={{ color: mutedTextColor }}>
                        {entry.source || 'Unverified'}
                        {entry.date && ` · ${formatShortDate(entry.date)}`}
                      </div>
                      {entry.note && (
                        <div style={{ color: mutedTextColor }}>{entry.note}</div>
                      )}
                      {typeof entry.confidence === 'number' && (
                        <div style={{ color: mutedTextColor }}>
                          Confidence {entry.confidence}%
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, minWidth: 90, textAlign: 'right' }}>
                      {formatCurrency(entry.amount)}
                    </div>
                  </div>
                ))}
              </div>

              {isOwnerLike && (
                <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontWeight: 600 }}>Display price</div>
                  <select
                    value={displayMode}
                    onChange={(e) => persistDisplayMode(e.target.value as any)}
                    className="form-select"
                    style={{ fontSize: '8pt', padding: '2px 4px' }}
                  >
                    <option value="auto">Auto</option>
                    <option value="estimate">Estimate</option>
                    <option value="auction">Auction Bid</option>
                    <option value="asking">Asking</option>
                    <option value="sale">Sale</option>
                    <option value="purchase">Purchase</option>
                    <option value="msrp">MSRP</option>
                  </select>
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  type="button"
                  className="button button-small"
                  style={{ fontSize: '8pt' }}
                  onClick={handleViewValuation}
                >
                  View valuation details
                </button>
                <button
                  type="button"
                  className="button button-small"
                  style={{ fontSize: '8pt' }}
                  onClick={handleTradeClick}
                >
                  Trade shares
                </button>
              </div>
            </div>
          )}
        </div>
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