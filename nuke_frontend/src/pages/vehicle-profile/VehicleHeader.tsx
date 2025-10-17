import React, { useEffect, useState } from 'react';
import type { VehicleHeaderProps } from './types';
import { computePrimaryPrice, computeDelta, formatCurrency } from '../../services/priceSignalService';
import { supabase } from '../../lib/supabase';
import PriceHistoryModal from '../../components/vehicle/PriceHistoryModal';
import PriceAnalysisPanel from '../../components/vehicle/PriceAnalysisPanel';

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<'auto'|'estimate'|'auction'|'asking'|'sale'|'purchase'|'msrp'>('auto');
  const [responsibleMode, setResponsibleMode] = useState<'auto'|'owner'|'consigner'|'uploader'|'listed_by'|'custom'>('auto');
  const [responsibleCustom, setResponsibleCustom] = useState<string>('');

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
    if (mode === 'auto') return getAutoDisplay();
    if (mode === 'estimate') {
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

  const isRowOwner = !!(session?.user?.id && (vehicle as any)?.user_id && session.user.id === (vehicle as any).user_id);
  const isUploaderAsTempOwner = !!(session?.user?.id && !((vehicle as any)?.user_id) && session.user.id === vehicle.uploaded_by);
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
        background: 'transparent',
        border: 'none',
        padding: '12px 16px',
        margin: '0',
        fontFamily: 'Arial, sans-serif',
        position: 'sticky',
        top: 48,
        zIndex: 10,
        borderBottom: '1px solid #e5e5e5'
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
              {isOwnerLike && (
                <select
                  value={displayMode}
                  onChange={(e) => persistDisplayMode(e.target.value as any)}
                  title="Select display price"
                  style={{ fontSize: '10px', padding: '2px 4px', border: '1px solid #d0d0d0', background: '#fff' }}
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

        {/* Price signal chips */}
        {vehicle && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(() => {
              const sig = rpcSignal;
              const priceMeta = {
                msrp: (vehicle as any).msrp,
                current_value: (vehicle as any).current_value,
                purchase_price: (vehicle as any).purchase_price,
                asking_price: (vehicle as any).asking_price,
                sale_price: (vehicle as any).sale_price,
                is_for_sale: (vehicle as any).is_for_sale,
              } as any;
              const pi = sig && sig.primary_label && typeof sig.primary_value === 'number'
                ? { label: sig.primary_label as any, amount: sig.primary_value as number }
                : computePrimaryPrice(priceMeta);
              const delta = sig && typeof sig.delta_pct === 'number' && typeof sig.delta_amount === 'number'
                ? { amount: sig.delta_amount as number, percent: sig.delta_pct as number, isPositive: (sig.delta_amount as number) >= 0 }
                : computeDelta(priceMeta);
              return (
                <>
                  {pi.label && typeof pi.amount === 'number' && (
                    <span style={smallChipStyle} title={Array.isArray(sig?.sources) ? `Sources: ${sig.sources.join(', ')}` : undefined}>{pi.label}: {formatCurrency(pi.amount)}</span>
                  )}
                  {delta && (
                    <span style={{ ...smallChipStyle, color: delta.isPositive ? '#006400' : '#800000' }} title={Array.isArray(sig?.sources) ? `Sources: ${sig.sources.join(', ')}` : undefined}>
                      {delta.isPositive ? '↑' : '↓'} {Math.abs(delta.percent).toFixed(1)}%
                    </span>
                  )}
                  {typeof trendPct30d === 'number' && (
                    <span style={{ ...smallChipStyle, color: trendPct30d >= 0 ? '#006400' : '#800000' }} title="30d trend from history">
                      {trendPct30d >= 0 ? '↗' : '↘'} {Math.abs(trendPct30d).toFixed(1)}% 30d
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Sale badge */}
        {vehicle.is_for_sale && (
          <div style={{ background: '#166534', color: 'white', padding: '2px 6px', fontSize: '7pt', fontWeight: 'bold', border: '1px solid #bdbdbd' }}>
            FOR SALE
          </div>
        )}

        {/* Responsible badge + owner controls */}
        {responsibleName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ background: '#e7e7e7', color: '#333', padding: '2px 6px', fontSize: '10px', border: '1px solid #d0d0d0' }}>
              {computeResponsibleLabel()}: {responsibleName}
            </div>
            {isOwnerLike && (
              <>
                <select
                  value={responsibleMode}
                  onChange={(e) => persistResponsibleSettings(e.target.value as any)}
                  title="Select responsible label"
                  style={{ fontSize: '10px', padding: '2px 4px', border: '1px solid #d0d0d0', background: '#fff' }}
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
                    style={{ fontSize: '10px', padding: '2px 4px', border: '1px solid #d0d0d0' }}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Actions */}
        <button className="button button-small" onClick={() => setHistoryOpen(true)}>History</button>
        <button className="button button-small" onClick={() => setAnalysisOpen(true)}>Analysis</button>
        <button 
          className="button button-small button-primary" 
          onClick={() => window.location.href = `/vehicle/${vehicle.id}/verify-tags`}
          title="Review AI-detected tags"
        >
          Review Tags
        </button>
      </div>
      {/* Price History Modal */}
      {vehicle?.id && (
        <PriceHistoryModal vehicleId={vehicle.id} isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
      )}
      {vehicle?.id && (
        <PriceAnalysisPanel vehicleId={vehicle.id} isOpen={analysisOpen} onClose={() => setAnalysisOpen(false)} />
      )}
    </div>
  );
};

export default VehicleHeader;