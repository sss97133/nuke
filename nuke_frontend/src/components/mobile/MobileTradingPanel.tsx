/**
 * Mobile Trading Panel
 * 
 * Buy/sell interface for fractional vehicle ownership
 * - Real-time cash balance display
 * - Order cost calculation with 2% commission
 * - Professional order confirmation flow
 */

import React, { useState, useEffect } from 'react';
import { TradingService } from '../../services/tradingService';
import { OrderConfirmationModal } from '../trading/OrderConfirmationModal';

interface MobileTradingPanelProps {
  vehicleId: string;
  offeringId: string;
  currentSharePrice: number;
  vehicleName: string;
  session: any;
}

export const MobileTradingPanel: React.FC<MobileTradingPanelProps> = ({
  vehicleId,
  offeringId,
  currentSharePrice,
  vehicleName,
  session
}) => {
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState<number>(10);
  const [pricePerShare, setPricePerShare] = useState<number>(currentSharePrice);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [shareHolding, setShareHolding] = useState<number>(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session?.user?.id) {
      loadUserData();
    }
  }, [session?.user?.id, offeringId]);

  const loadUserData = async () => {
    if (!session?.user?.id) return;
    
    setLoading(true);
    try {
      const [balance, holding] = await Promise.all([
        TradingService.getCashBalance(session.user.id),
        TradingService.getShareHolding(session.user.id, offeringId)
      ]);

      setCashBalance(balance?.availableCents || 0);
      setShareHolding(holding?.sharesOwned || 0);
    } catch (error) {
      console.error('[MobileTradingPanel] Failed to load user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const { subtotal, commission, total } = TradingService.calculateOrderCost(shares, pricePerShare, orderType);

  const canAfford = orderType === 'buy' ? (cashBalance / 100) >= total : shareHolding >= shares;
  const isValid = shares > 0 && pricePerShare > 0 && canAfford;

  if (!session?.user) {
    return (
      <div style={styles.container}>
        <div style={styles.loginPrompt}>
          <div style={styles.loginText}>Sign in to trade</div>
          <a href="/login" style={styles.loginButton}>Log In</a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={styles.container}>
        {/* Buy/Sell Tabs */}
        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(orderType === 'buy' ? styles.tabActive : {})
            }}
            onClick={() => setOrderType('buy')}
          >
            BUY
          </button>
          <button
            style={{
              ...styles.tab,
              ...(orderType === 'sell' ? styles.tabActive : {})
            }}
            onClick={() => setOrderType('sell')}
          >
            SELL
          </button>
        </div>

        {/* Balance Display */}
        <div style={styles.balanceRow}>
          <div style={styles.balanceItem}>
            <div style={styles.balanceLabel}>Cash:</div>
            <div style={styles.balanceValue}>
              {loading ? '...' : TradingService.formatCurrency(cashBalance)}
            </div>
          </div>
          <div style={styles.balanceItem}>
            <div style={styles.balanceLabel}>Shares:</div>
            <div style={styles.balanceValue}>
              {loading ? '...' : shareHolding.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Shares Input */}
        <div style={styles.formRow}>
          <label style={styles.label}>Shares</label>
          <div style={styles.inputGroup}>
            <input
              type="number"
              value={shares}
              onChange={(e) => setShares(Math.max(0, parseInt(e.target.value) || 0))}
              style={styles.input}
              min="1"
            />
            <div style={styles.inputButtons}>
              <button onClick={() => setShares(s => s + 1)} style={styles.inputBtn}>+</button>
              <button onClick={() => setShares(s => Math.max(1, s - 1))} style={styles.inputBtn}>−</button>
            </div>
          </div>
        </div>

        {/* Price Input */}
        <div style={styles.formRow}>
          <label style={styles.label}>Price/Share</label>
          <div style={styles.inputGroup}>
            <input
              type="number"
              value={pricePerShare.toFixed(2)}
              onChange={(e) => setPricePerShare(parseFloat(e.target.value) || 0)}
              style={styles.input}
              step="0.01"
              min="0.01"
            />
            <div style={styles.inputButtons}>
              <button onClick={() => setPricePerShare(p => p + 0.1)} style={styles.inputBtn}>+</button>
              <button onClick={() => setPricePerShare(p => Math.max(0.01, p - 0.1))} style={styles.inputBtn}>−</button>
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div style={styles.summary}>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Subtotal:</span>
            <span style={styles.summaryValue}>${subtotal.toFixed(2)}</span>
          </div>
          {orderType === 'buy' && (
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Commission (2%):</span>
              <span style={styles.summaryValue}>${commission.toFixed(2)}</span>
            </div>
          )}
          <div style={{ ...styles.summaryRow, ...styles.summaryTotal }}>
            <span style={styles.summaryLabel}>Total:</span>
            <span style={styles.summaryValue}>${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={() => setShowConfirmation(true)}
          disabled={!isValid || loading}
          style={{
            ...styles.submitButton,
            ...(orderType === 'buy' ? styles.buyButton : styles.sellButton),
            opacity: isValid && !loading ? 1 : 0.5
          }}
        >
          {!canAfford 
            ? (orderType === 'buy' ? 'Insufficient Funds' : 'Insufficient Shares')
            : `${orderType === 'buy' ? 'BUY' : 'SELL'} ${shares} ${shares === 1 ? 'SHARE' : 'SHARES'}`
          }
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <OrderConfirmationModal
          vehicleId={vehicleId}
          offeringId={offeringId}
          orderType={orderType}
          shares={shares}
          pricePerShare={pricePerShare}
          vehicleName={vehicleName}
          onClose={() => setShowConfirmation(false)}
          onSuccess={(orderId) => {
            console.log('[MobileTradingPanel] Order placed:', orderId);
            loadUserData(); // Reload balances
            // TODO: Show success toast
          }}
        />
      )}
    </>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#c0c0c0',
    border: '2px solid #808080',
    padding: '12px',
    marginTop: '12px'
  },
  loginPrompt: {
    textAlign: 'center',
    padding: '20px'
  },
  loginText: {
    fontSize: '10pt',
    marginBottom: '12px',
    color: '#000'
  },
  loginButton: {
    display: 'inline-block',
    padding: '8px 16px',
    background: '#000080',
    color: '#fff',
    textDecoration: 'none',
    border: '2px solid #000',
    fontSize: '9pt',
    fontWeight: 'bold'
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '12px'
  },
  tab: {
    flex: 1,
    padding: '8px',
    background: '#c0c0c0',
    border: '2px solid #808080',
    fontSize: '9pt',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  tabActive: {
    background: '#000080',
    color: '#fff',
    borderColor: '#000'
  },
  balanceRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px'
  },
  balanceItem: {
    flex: 1,
    padding: '8px',
    background: '#fff',
    border: '1px solid #808080'
  },
  balanceLabel: {
    fontSize: '8pt',
    color: '#808080',
    marginBottom: '2px'
  },
  balanceValue: {
    fontSize: '10pt',
    fontWeight: 'bold'
  },
  formRow: {
    marginBottom: '12px'
  },
  label: {
    fontSize: '9pt',
    fontWeight: 'bold',
    display: 'block',
    marginBottom: '4px'
  },
  inputGroup: {
    display: 'flex',
    gap: '4px'
  },
  input: {
    flex: 1,
    padding: '8px',
    border: '2px solid #808080',
    fontSize: '10pt',
    background: '#fff'
  },
  inputButtons: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px'
  },
  inputBtn: {
    padding: '4px 8px',
    background: '#c0c0c0',
    border: '1px solid #808080',
    fontSize: '10pt',
    cursor: 'pointer',
    lineHeight: 1
  },
  summary: {
    background: '#fff',
    border: '2px solid #808080',
    padding: '8px',
    marginBottom: '12px'
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    fontSize: '9pt'
  },
  summaryTotal: {
    borderTop: '1px solid #808080',
    paddingTop: '8px',
    marginTop: '8px',
    fontWeight: 'bold',
    fontSize: '10pt'
  },
  summaryLabel: {},
  summaryValue: {},
  submitButton: {
    width: '100%',
    padding: '12px',
    fontSize: '10pt',
    fontWeight: 'bold',
    border: '2px solid #000',
    cursor: 'pointer'
  },
  buyButton: {
    background: '#008000',
    color: '#fff'
  },
  sellButton: {
    background: '#ff0000',
    color: '#fff'
  }
};

