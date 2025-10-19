/**
 * Support Vehicle Button
 * Allows users to allocate credits to a vehicle
 */

import React, { useState, useEffect } from 'react';
import { CreditsService } from '../../services/creditsService';
import { supabase } from '../../lib/supabase';

interface SupportVehicleButtonProps {
  vehicleId: string;
  vehicleName: string;
  className?: string;
}

export const SupportVehicleButton: React.FC<SupportVehicleButtonProps> = ({
  vehicleId,
  vehicleName,
  className = ''
}) => {
  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState('300'); // Default $3 (300 credits)
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBalance();
  }, []);

  const loadBalance = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const balance = await CreditsService.getUserBalance(user.id);
      setUserBalance(balance);
    }
  };

  const handleSupport = async () => {
    const credits = parseInt(amount);
    if (!credits || credits < 1) {
      alert('Minimum 1 credit');
      return;
    }

    if (credits > userBalance) {
      alert(`Insufficient credits. You have ${CreditsService.formatCredits(userBalance)}`);
      return;
    }

    setLoading(true);
    try {
      await CreditsService.supportVehicle(vehicleId, credits, message || undefined, anonymous);
      alert(`Successfully supported ${vehicleName} with ${CreditsService.formatCredits(credits)}!`);
      setShowModal(false);
      setAmount('300');
      setMessage('');
      await loadBalance();
    } catch (error) {
      console.error('Support error:', error);
      alert('Failed to support vehicle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={className || 'btn-utility'}
      >
        💸 Support
      </button>

      {showModal && (
        <div style={styles.overlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.header}>
              <h3 style={styles.title}>Support {vehicleName}</h3>
              <button onClick={() => setShowModal(false)} style={styles.closeButton}>×</button>
            </div>

            <div style={styles.content}>
              <div style={styles.balance}>
                Your balance: <span className="font-mono">{CreditsService.formatCredits(userBalance)}</span>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Amount</label>
                <div style={styles.quickAmounts}>
                  {[100, 300, 500, 1000, 5000].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setAmount(amt.toString())}
                      style={{
                        ...styles.quickButton,
                        ...(parseInt(amount) === amt ? styles.quickButtonActive : {})
                      }}
                    >
                      {CreditsService.formatCredits(amt)}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={styles.input}
                  placeholder="Custom amount in credits..."
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Message (optional)</label>
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Nice build!"
                  style={styles.input}
                  maxLength={200}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={anonymous}
                    onChange={(e) => setAnonymous(e.target.checked)}
                  />
                  <span style={styles.checkboxLabel}>Support anonymously</span>
                </label>
              </div>

              <button
                onClick={handleSupport}
                disabled={loading || !amount || parseInt(amount) < 1}
                style={styles.supportButton}
              >
                {loading ? 'Processing...' : `Support with ${CreditsService.formatCredits(parseInt(amount) || 0)}`}
              </button>
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
    maxWidth: '400px'
  },
  header: {
    background: 'var(--accent)',
    color: '#ffffff',
    padding: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px'
  },
  title: {
    margin: 0,
    fontSize: '12px',
    fontWeight: 'bold' as const
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: '#ffffff',
    fontSize: '24px',
    cursor: 'pointer',
    padding: 0
  },
  content: {
    padding: '16px'
  },
  balance: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    marginBottom: '16px'
  },
  field: {
    marginBottom: '16px'
  },
  label: {
    display: 'block',
    fontSize: '10px',
    fontWeight: 'bold' as const,
    marginBottom: '6px',
    color: 'var(--text)'
  },
  quickAmounts: {
    display: 'flex',
    gap: '6px',
    marginBottom: '8px',
    flexWrap: 'wrap' as const
  },
  quickButton: {
    padding: '4px 8px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    fontSize: '10px',
    cursor: 'pointer',
    transition: 'border-color 0.1s'
  },
  quickButtonActive: {
    borderColor: 'var(--accent)',
    background: 'var(--accent-dim)'
  },
  input: {
    width: '100%',
    height: '32px',
    padding: '0 10px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '11px',
    color: 'var(--text)',
    boxSizing: 'border-box' as const
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '10px',
    cursor: 'pointer'
  },
  checkboxLabel: {
    color: 'var(--text)'
  },
  supportButton: {
    width: '100%',
    height: '40px',
    background: 'var(--accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    transition: 'opacity 0.1s'
  }
};

