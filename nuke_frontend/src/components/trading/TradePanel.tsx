import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { CashBalanceService } from '../../services/cashBalanceService';

interface TradePanelProps {
  vehicleId: string;
  vehicleName: string;
  currentSharePrice?: number;
  totalShares?: number;
}

export default function TradePanel({ 
  vehicleId, 
  vehicleName,
  currentSharePrice = 0,
  totalShares = 1000
}: TradePanelProps) {
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState<string>('');
  const [price, setPrice] = useState<string>(currentSharePrice.toFixed(2));
  const [balance, setBalance] = useState<number>(0);
  const [userShares, setUserShares] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUserData();
  }, [vehicleId]);

  useEffect(() => {
    setPrice(currentSharePrice.toFixed(2));
  }, [currentSharePrice]);

  const loadUserData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Load cash balance
      const cashBalance = await CashBalanceService.getUserBalance(user.id);
      if (cashBalance) {
        setBalance(cashBalance.available_cents);
      }

      // Load user's shares in this vehicle
      const { data: holdings } = await supabase
        .from('share_holdings')
        .select('shares_owned')
        .eq('holder_id', user.id)
        .eq('offering_id', vehicleId) // Note: This assumes offering_id = vehicle_id
        .single();

      if (holdings) {
        setUserShares(holdings.shares_owned);
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
        if (balance < totalCost) {
          alert(`Insufficient funds. You have ${CashBalanceService.formatCurrency(balance)}, need ${CashBalanceService.formatCurrency(totalCost)}`);
          return;
        }
      } else {
        if (userShares < numShares) {
          alert(`Insufficient shares. You own ${userShares} shares, trying to sell ${numShares}`);
          return;
        }
      }

      setLoading(true);

      // TODO: Call auctionMarketEngine.placeOrder() when market system is deployed
      // For now, show confirmation
      const confirmed = confirm(
        `${tradeType.toUpperCase()} ORDER\n\n` +
        `${numShares} shares @ $${numPrice}\n` +
        `Total: ${CashBalanceService.formatCurrency(totalCost)}\n\n` +
        `This will be submitted to the order book.\n` +
        `Continue?`
      );

      if (confirmed) {
        alert('Market system deployment pending. Order book coming soon!');
        // TODO: Implement actual order placement
        // await AuctionMarketEngine.placeOrder(vehicleId, user.id, tradeType, numShares, numPrice);
      }

    } catch (error) {
      console.error('Trade error:', error);
      alert('Trade failed: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const totalCost = shares && price ? Math.floor(parseInt(shares) * parseFloat(price) * 100) : 0;
  const platformFee = Math.floor(totalCost * 0.02); // 2% fee
  const netAmount = tradeType === 'sell' ? totalCost - platformFee : totalCost;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '8px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '2px solid var(--border)'
      }}>
        <h3 style={{
          fontSize: '16px',
          fontWeight: 700,
          margin: 0,
          marginBottom: '4px'
        }}>
          Trade Shares
        </h3>
        <div style={{
          fontSize: '11px',
          color: 'var(--text-secondary)'
        }}>
          {vehicleName}
        </div>
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
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            Current Share Price
          </div>
          <div style={{
            fontSize: '18px',
            fontWeight: 700,
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono, monospace)'
          }}>
            ${currentSharePrice.toFixed(2)}
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
              ? `You can afford ${Math.floor(balance / (parseFloat(price) * 100))} shares`
              : `You own ${userShares} shares`
            }
          </div>
        </div>

        {/* Price Input */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{
            display: 'block',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '6px',
            textTransform: 'uppercase'
          }}>
            Price Per Share (USD)
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
            {tradeType === 'sell' && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '4px'
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>Platform Fee (2%):</span>
                <span style={{ color: 'var(--error)' }}>
                  -{CashBalanceService.formatCurrency(platformFee)}
                </span>
              </div>
            )}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              paddingTop: '8px',
              borderTop: '1px solid var(--border)',
              fontWeight: 700
            }}>
              <span style={{ color: 'var(--text)' }}>
                {tradeType === 'buy' ? 'You Pay:' : 'You Receive:'}
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
            border: '2px solid var(--accent)',
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
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
          {loading ? 'Processing...' : `${tradeType === 'buy' ? 'Place Buy Order' : 'Place Sell Order'}`}
        </button>

        {/* Info */}
        <div style={{
          marginTop: '12px',
          padding: '12px',
          background: 'var(--accent-dim)',
          border: '2px solid var(--accent)',
          borderRadius: '4px',
          fontSize: '10px',
          color: 'var(--text-secondary)',
          lineHeight: 1.5
        }}>
          <strong style={{ color: 'var(--accent)' }}>How Trading Works</strong>
          <br />
          • Orders are placed in the order book
          <br />
          • Matched instantly if price crosses
          <br />
          • Platform fee: 2% on all trades
          <br />
          • {tradeType === 'buy' ? 'Cash reserved until filled' : 'Shares locked until sold'}
        </div>
      </div>
    </div>
  );
}

