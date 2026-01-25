import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';
import { CashBalanceService } from '../../services/cashBalanceService';

interface TradePanelProps {
  assetType?: 'vehicle' | 'organization';
  assetId?: string;
  assetName?: string;
  offeringId?: string;
  currentPrice?: number;
  availableShares?: number;
  onClose?: () => void;
  onTrade?: () => void;
  // Legacy props for backwards compat
  vehicleId?: string;
  vehicleName?: string;
  currentSharePrice?: number;
  totalShares?: number;
}

type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

const TIME_IN_FORCE_OPTIONS: Array<{ value: TimeInForce; label: string; description: string }> = [
  { value: 'day', label: 'Day', description: 'Expires at market close' },
  { value: 'gtc', label: 'GTC', description: 'Good til cancelled' },
  { value: 'ioc', label: 'IOC', description: 'Immediate or cancel' },
  { value: 'fok', label: 'FOK', description: 'Fill or kill (all or nothing)' },
];

export default function TradePanel({
  assetType = 'vehicle',
  assetId,
  assetName,
  offeringId,
  currentPrice,
  availableShares,
  onClose,
  onTrade,
  // Legacy
  vehicleId,
  vehicleName,
  currentSharePrice = 0,
  totalShares = 1000
}: TradePanelProps) {
  // Use legacy or new props
  const finalAssetId = assetId || vehicleId || '';
  const finalAssetName = assetName || vehicleName || '';
  const finalOfferingId = offeringId || finalAssetId;
  const finalCurrentPrice = currentPrice !== undefined ? currentPrice : currentSharePrice;
  const finalTotalShares = availableShares !== undefined ? availableShares : totalShares;

  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState<string>('');
  const [price, setPrice] = useState<string>(finalCurrentPrice.toFixed(2));
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('day');
  const [balance, setBalance] = useState<number>(0);
  const [userShares, setUserShares] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [marketImpact, setMarketImpact] = useState<{ priceImpact: number; impactPct: number } | null>(null);

  const sharesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadUserData();
  }, [finalAssetId, assetType]);

  useEffect(() => {
    setPrice(finalCurrentPrice.toFixed(2));
  }, [finalCurrentPrice]);

  // Calculate market impact when shares change
  useEffect(() => {
    if (shares && parseInt(shares) > 0) {
      const numShares = parseInt(shares);
      // Simple impact model: 0.1% per 10 shares
      const impactPct = (numShares / 10) * 0.1;
      const priceImpact = finalCurrentPrice * (impactPct / 100);
      setMarketImpact({
        priceImpact: tradeType === 'buy' ? priceImpact : -priceImpact,
        impactPct: tradeType === 'buy' ? impactPct : -impactPct,
      });
    } else {
      setMarketImpact(null);
    }
  }, [shares, tradeType, finalCurrentPrice]);

  // Focus shares input on mount
  useEffect(() => {
    if (sharesInputRef.current) {
      sharesInputRef.current.focus();
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case 'Enter':
          if (!loading && shares && price) {
            handleTrade();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, shares, price]);

  const loadUserData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Load cash balance
      const cashBalance = await CashBalanceService.getUserBalance(user.id);
      if (cashBalance) {
        setBalance(cashBalance.available_cents);
      }

      // Load user's shares in this asset (vehicle or org)
      const tableName = assetType === 'organization' ? 'organization_share_holdings' : 'share_holdings';
      const { data: holdings } = await supabase
        .from(tableName)
        .select('shares_owned')
        .eq('holder_id', user.id)
        .eq('offering_id', finalOfferingId)
        .maybeSingle();

      if (holdings) {
        setUserShares(holdings.shares_owned || 0);
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  };

  const handleTrade = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please sign in to trade');
        return;
      }

      const numShares = parseInt(shares);
      const numPrice = parseFloat(price);

      if (!numShares || numShares <= 0) {
        alert('Please enter a valid number of shares');
        return;
      }

      if (!numPrice || numPrice <= 0) {
        alert('Please enter a valid price');
        return;
      }

      const totalCost = Math.floor(numShares * numPrice * 100);

      // Validate based on trade type
      if (tradeType === 'buy') {
        const requiredWithCommission = Math.floor(totalCost * 1.02);
        if (balance < requiredWithCommission) {
          alert(`Insufficient funds. You have ${CashBalanceService.formatCurrency(balance)}, need ${CashBalanceService.formatCurrency(requiredWithCommission)} (includes 2% fee)`);
          return;
        }
      } else {
        if (userShares < numShares) {
          alert(`Insufficient shares. You own ${userShares} shares, trying to sell ${numShares}`);
          return;
        }
      }

      setLoading(true);

      // Get or create offering for this vehicle if needed
      let offering: { id: string } | null = null;
      if (assetType === 'vehicle') {
        const { data: existingOffering, error: offeringError } = await supabase
          .from('vehicle_offerings')
          .select('id')
          .eq('vehicle_id', finalAssetId)
          .single();

        if (offeringError || !existingOffering) {
          // Create offering if it doesn't exist
          const { data: newOffering, error: createError } = await supabase
            .from('vehicle_offerings')
            .insert({
              vehicle_id: finalAssetId,
              seller_id: user.id,
              offering_type: 'fractional',
              total_shares: totalShares,
              initial_share_price: currentSharePrice,
              current_share_price: currentSharePrice,
              status: 'trading'
            })
            .select()
            .single();

          if (createError) throw createError;
          offering = newOffering;
        } else {
          offering = existingOffering;
        }
      } else {
        offering = { id: finalOfferingId };
      }

      // Call the place-market-order edge function
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${getSupabaseFunctionsUrl()}/place-market-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          offeringId: offering.id,
          assetType,
          orderType: tradeType,
          sharesRequested: numShares,
          pricePerShare: numPrice,
          timeInForce,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Order failed');
      }

      // Show result
      if (result.sharesFilled > 0) {
        const avgPrice = result.averageFillPrice || numPrice;

        alert(
          `Order ${result.status.toUpperCase()}!\n\n` +
          `Filled: ${result.sharesFilled}/${numShares} shares @ avg $${avgPrice.toFixed(2)}\n` +
          (result.commission ? `Commission: ${CashBalanceService.formatCurrency(result.commission * 100)}\n` : '') +
          `Order ID: ${result.orderId.substring(0, 8)}...`
        );
      } else {
        alert(
          `Order PLACED!\n\n` +
          `${numShares} shares @ $${numPrice.toFixed(2)}\n` +
          `Time in Force: ${TIME_IN_FORCE_OPTIONS.find(t => t.value === timeInForce)?.label}\n` +
          `Status: ${result.status}\n` +
          `Waiting for matching orders...`
        );
      }

      // Refresh balance and shares
      await loadUserData();

      // Clear form
      setShares('');

      // Callback
      onTrade?.();

    } catch (error) {
      console.error('Trade error:', error);
      alert('Trade failed: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const totalCost = shares && price ? Math.floor(parseInt(shares) * parseFloat(price) * 100) : 0;
  const platformFee = Math.floor(totalCost * 0.02); // 2% fee
  const netAmount = tradeType === 'sell' ? totalCost - platformFee : totalCost + platformFee;
  const maxAffordableShares = Math.floor(balance / (parseFloat(price || '1') * 102)); // Account for 2% fee

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '8px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '2px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h3 style={{
            fontSize: '10px',
            fontWeight: 700,
            margin: 0,
            marginBottom: '2px'
          }}>
            Trade Shares
          </h3>
          <div style={{
            fontSize: '9px',
            color: 'var(--text-secondary)'
          }}>
            {finalAssetName}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '16px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '20px' }}>
        {/* Buy/Sell Tabs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginBottom: '20px'
        }}>
          <button
            onClick={() => setTradeType('buy')}
            style={{
              border: '2px solid var(--border)',
              background: tradeType === 'buy' ? 'var(--success-dim)' : 'var(--surface)',
              color: tradeType === 'buy' ? 'var(--success)' : 'var(--text)',
              padding: '10px',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            Buy
          </button>

          <button
            onClick={() => setTradeType('sell')}
            style={{
              border: '2px solid var(--border)',
              background: tradeType === 'sell' ? 'var(--error-dim)' : 'var(--surface)',
              color: tradeType === 'sell' ? 'var(--error)' : 'var(--text)',
              padding: '10px',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            Sell
          </button>
        </div>

        {/* Current Price */}
        <div style={{
          background: 'var(--accent-dim)',
          border: '2px solid var(--accent)',
          borderRadius: '4px',
          padding: '12px',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
            Current Share Price
          </div>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono, monospace)'
          }}>
            ${finalCurrentPrice.toFixed(2)}
          </div>
        </div>

        {/* Shares Input */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{
            display: 'block',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '6px',
            textTransform: 'uppercase'
          }}>
            Number of Shares
          </label>
          <input
            ref={sharesInputRef}
            type="number"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="0"
            min="1"
            step="1"
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: '14px',
              fontFamily: 'var(--font-mono, monospace)',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              boxSizing: 'border-box'
            }}
          />
          <div style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            marginTop: '4px'
          }}>
            {tradeType === 'buy'
              ? `Max affordable: ${maxAffordableShares.toLocaleString()} shares`
              : `You own: ${userShares.toLocaleString()} shares`
            }
          </div>
        </div>

        {/* Price Input */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{
            display: 'block',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '6px',
            textTransform: 'uppercase'
          }}>
            Limit Price (USD)
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: '14px',
              fontFamily: 'var(--font-mono, monospace)',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--bg)',
              color: 'var(--text)',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Time in Force */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{
            display: 'block',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '6px',
            textTransform: 'uppercase'
          }}>
            Time in Force
          </label>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '4px',
          }}>
            {TIME_IN_FORCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeInForce(option.value)}
                title={option.description}
                style={{
                  padding: '8px 4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: timeInForce === option.value ? 'var(--accent-dim)' : 'var(--surface)',
                  color: timeInForce === option.value ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {TIME_IN_FORCE_OPTIONS.find(t => t.value === timeInForce)?.description}
          </div>
        </div>

        {/* Market Impact Estimate */}
        {marketImpact && (
          <div style={{
            background: 'var(--warning-dim, #fef3c7)',
            border: '1px solid var(--warning, #f59e0b)',
            borderRadius: '4px',
            padding: '8px 12px',
            marginBottom: '16px',
            fontSize: '10px',
          }}>
            <div style={{ fontWeight: 600, color: 'var(--warning, #f59e0b)', marginBottom: '4px' }}>
              Estimated Market Impact
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Price may move ~{Math.abs(marketImpact.impactPct).toFixed(2)}%
              ({marketImpact.impactPct > 0 ? '+' : ''}${marketImpact.priceImpact.toFixed(2)})
            </div>
          </div>
        )}

        {/* Order Summary */}
        {totalCost > 0 && (
          <div style={{
            background: 'var(--bg)',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono, monospace)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '4px'
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
              <span style={{ color: 'var(--text)' }}>
                {CashBalanceService.formatCurrency(totalCost)}
              </span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '4px'
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>Platform Fee (2%):</span>
              <span style={{ color: tradeType === 'sell' ? 'var(--error)' : 'var(--text-secondary)' }}>
                {tradeType === 'sell' ? '-' : '+'}{CashBalanceService.formatCurrency(platformFee)}
              </span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              paddingTop: '8px',
              borderTop: '1px solid var(--border)',
              fontWeight: 700
            }}>
              <span style={{ color: 'var(--text)' }}>
                {tradeType === 'buy' ? 'Total Cost:' : 'You Receive:'}
              </span>
              <span style={{
                color: tradeType === 'buy' ? 'var(--error)' : 'var(--success)',
                fontSize: '13px'
              }}>
                {CashBalanceService.formatCurrency(netAmount)}
              </span>
            </div>
          </div>
        )}

        {/* Execute Button */}
        <button
          onClick={handleTrade}
          disabled={loading || !shares || !price || parseInt(shares) <= 0}
          style={{
            border: '2px solid ' + (tradeType === 'buy' ? 'var(--success)' : 'var(--error)'),
            background: tradeType === 'buy' ? 'var(--success-dim)' : 'var(--error-dim)',
            color: tradeType === 'buy' ? 'var(--success)' : 'var(--error)',
            padding: '14px',
            fontSize: '14px',
            fontWeight: 700,
            fontFamily: 'Arial, sans-serif',
            cursor: loading ? 'wait' : 'pointer',
            transition: '0.12s',
            borderRadius: '4px',
            width: '100%',
            opacity: (!shares || !price || parseInt(shares) <= 0) ? 0.5 : 1
          }}
        >
          {loading ? 'Processing...' : `Place ${tradeType.toUpperCase()} Order`}
        </button>

        {/* Available Balance */}
        <div style={{
          marginTop: '12px',
          padding: '8px 12px',
          background: 'var(--bg)',
          borderRadius: '4px',
          fontSize: '10px',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>Available Balance:</span>
          <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
            {CashBalanceService.formatCurrency(balance)}
          </span>
        </div>
      </div>
    </div>
  );
}
