/**
 * Deposit Cash Button
 * Opens Stripe checkout to add cash to trading balance
 */

import React, { useState } from 'react';
import { CashBalanceService } from '../../services/cashBalanceService';
import { supabase } from '../../lib/supabase';

interface BuyCreditsButtonProps {
  presetAmounts?: number[];
  className?: string;
}

export const BuyCreditsButton: React.FC<BuyCreditsButtonProps> = ({
  presetAmounts = [3, 10, 25, 50, 100],
  className = ''
}) => {
  const [showModal, setShowModal] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDeposit = async (amount: number) => {
    try {
      // Require authentication before starting checkout
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${redirect}`;
        return;
      }

      setLoading(true);
      const checkoutUrl = await CashBalanceService.depositCash(amount);
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        alert('Failed to create checkout session');
      }
    } catch (error) {
      console.error('Deposit error:', error);
      alert('Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={className || 'btn-utility'}
        disabled={loading}
      >
        Deposit Cash
      </button>

      {showModal && (
        <div style={styles.overlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.header}>
              <h3 style={styles.title}>Deposit Cash</h3>
              <button onClick={() => setShowModal(false)} style={styles.closeButton}>×</button>
            </div>

            <div style={styles.content}>
              <p style={styles.description}>
                Add cash to your trading balance. Use it to buy shares, trade vehicles, and build your portfolio.
                Platform fee: 2% on trades.
              </p>

              <div style={styles.presets}>
                {presetAmounts.map(amount => (
                  <button
                    key={amount}
                    onClick={() => handleDeposit(amount)}
                    disabled={loading}
                    style={styles.presetButton}
                  >
                    ${amount}
                    <span style={styles.creditCount}>USD</span>
                  </button>
                ))}
              </div>

              <div style={styles.divider}>or</div>

              <div style={styles.customAmount}>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="Custom amount..."
                  style={styles.input}
                />
                <button
                  onClick={() => handleDeposit(parseInt(customAmount) || 0)}
                  disabled={loading || !customAmount || parseInt(customAmount) < 1}
                  style={styles.buyButton}
                >
                  Deposit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  },
  modal: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    width: '90%',
    maxWidth: '400px',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  header: {
    padding: '12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--border)'
  },
  title: {
    margin: 0,
    fontSize: '11px',
    fontWeight: 500 as const
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text)',
    fontSize: '18px',
    cursor: 'pointer',
    padding: 0,
    width: '20px',
    height: '20px'
  },
  content: {
    padding: '12px'
  },
  description: {
    fontSize: '10px',
    color: 'var(--text-secondary)',
    marginBottom: '16px',
    lineHeight: 1.4
  },
  presets: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    marginBottom: '16px'
  },
  presetButton: {
    padding: '8px 6px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: 500 as const,
    transition: 'border-color 0.1s',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '2px',
    color: 'var(--text)'
  },
  creditCount: {
    fontSize: '8px',
    color: 'var(--text-secondary)',
    fontWeight: 400 as const
  },
  divider: {
    textAlign: 'center' as const,
    fontSize: '10px',
    color: 'var(--text-secondary)',
    margin: '12px 0'
  },
  customAmount: {
    display: 'flex',
    gap: '8px'
  },
  input: {
    flex: 1,
    height: '32px',
    padding: '0 10px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    fontSize: '10px',
    color: 'var(--text)'
  },
  buyButton: {
    height: '32px',
    padding: '0 12px',
    background: 'var(--accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 500 as const,
    cursor: 'pointer'
  }
};

