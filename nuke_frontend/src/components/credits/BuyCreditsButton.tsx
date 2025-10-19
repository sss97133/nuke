/**
 * Buy Credits Button
 * Opens Stripe checkout to purchase platform credits
 */

import React, { useState } from 'react';
import { CreditsService } from '../../services/creditsService';

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

  const handleBuyCredits = async (amount: number) => {
    setLoading(true);
    try {
      const checkoutUrl = await CreditsService.buyCredits(amount);
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        alert('Failed to create checkout session');
      }
    } catch (error) {
      console.error('Buy credits error:', error);
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
        💰 Buy Credits
      </button>

      {showModal && (
        <div style={styles.overlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.header}>
              <h3 style={styles.title}>Buy Credits</h3>
              <button onClick={() => setShowModal(false)} style={styles.closeButton}>×</button>
            </div>

            <div style={styles.content}>
              <p style={styles.description}>
                Credits let you support vehicle builds. $1 = 100 credits.
                Platform takes 1% fee. Builders receive 99%.
              </p>

              <div style={styles.presets}>
                {presetAmounts.map(amount => (
                  <button
                    key={amount}
                    onClick={() => handleBuyCredits(amount)}
                    disabled={loading}
                    style={styles.presetButton}
                  >
                    ${amount}
                    <span style={styles.creditCount}>{amount * 100} credits</span>
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
                  onClick={() => handleBuyCredits(parseInt(customAmount) || 0)}
                  disabled={loading || !customAmount || parseInt(customAmount) < 1}
                  style={styles.buyButton}
                >
                  Buy
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
    borderRadius: '8px',
    width: '90%',
    maxWidth: '400px',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  header: {
    background: 'var(--accent)',
    color: '#ffffff',
    padding: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 'bold' as const
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: '#ffffff',
    fontSize: '24px',
    cursor: 'pointer',
    padding: 0,
    width: '24px',
    height: '24px'
  },
  content: {
    padding: '16px'
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
    padding: '12px 8px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 'bold' as const,
    transition: 'border-color 0.1s',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px'
  },
  creditCount: {
    fontSize: '8px',
    color: 'var(--text-secondary)',
    fontWeight: 'normal' as const
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
    height: '36px',
    padding: '0 12px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '11px',
    color: 'var(--text)'
  },
  buyButton: {
    height: '36px',
    padding: '0 16px',
    background: 'var(--accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 'bold' as const,
    cursor: 'pointer'
  }
};

