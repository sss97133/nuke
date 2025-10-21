import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { CashBalanceService, CashBalance as CashBalanceType } from '../../services/cashBalanceService';

interface Props {
  compact?: boolean;
  showActions?: boolean;
}

export default function CashBalance({ compact = false, showActions = true }: Props) {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<CashBalanceType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBalance();
    
    // Refresh every 30 seconds
    const interval = setInterval(loadBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const userBalance = await CashBalanceService.getUserBalance(user.id);
      setBalance(userBalance);
    } catch (error) {
      console.error('Failed to load balance:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = async () => {
    const amount = prompt('Enter deposit amount (USD):');
    if (!amount) return;

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Invalid amount');
      return;
    }

    const checkoutUrl = await CashBalanceService.depositCash(amountNum);
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
    } else {
      alert('Failed to create deposit');
    }
  };

  const handleWithdraw = () => {
    navigate('/portfolio/withdraw');
  };

  if (loading) {
    return (
      <div style={{
        padding: compact ? '8px' : '16px',
        fontSize: '11px',
        color: 'var(--text-secondary)'
      }}>
        Loading balance...
      </div>
    );
  }

  if (!balance) {
    return null;
  }

  // Compact view (for headers/nav)
  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 12px',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '4px'
      }}>
        <div style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          fontWeight: 600
        }}>
          Cash
        </div>
        <div style={{
          fontSize: '14px',
          fontWeight: 700,
          color: 'var(--accent)',
          fontFamily: 'var(--font-mono, monospace)'
        }}>
          {CashBalanceService.formatCurrency(balance.available_cents)}
        </div>
      </div>
    );
  }

  // Full view
  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '8px',
      padding: '20px',
      maxWidth: '400px'
    }}>
      {/* Title */}
      <div style={{
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        marginBottom: '16px'
      }}>
        Cash Balance
      </div>

      {/* Total Balance */}
      <div style={{
        marginBottom: '12px',
        padding: '12px',
        background: 'var(--accent-dim)',
        border: '2px solid var(--accent)',
        borderRadius: '4px'
      }}>
        <div style={{
          fontSize: '8px',
          color: 'var(--text-secondary)',
          marginBottom: '4px',
          fontWeight: 600,
          textTransform: 'uppercase'
        }}>
          Total Balance
        </div>
        <div style={{
          fontSize: '14px',
          fontWeight: 700,
          color: 'var(--accent)',
          fontFamily: 'var(--font-mono, monospace)',
          lineHeight: 1
        }}>
          {CashBalanceService.formatCurrency(balance.balance_cents)}
        </div>
      </div>

      {/* Breakdown */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        marginBottom: '12px'
      }}>
        <div>
          <div style={{
            fontSize: '8px',
            color: 'var(--text-secondary)',
            marginBottom: '2px',
            textTransform: 'uppercase',
            fontWeight: 600
          }}>
            Available
          </div>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--success)',
            fontFamily: 'var(--font-mono, monospace)'
          }}>
            {CashBalanceService.formatCurrency(balance.available_cents)}
          </div>
        </div>

        <div>
          <div style={{
            fontSize: '8px',
            color: 'var(--text-secondary)',
            marginBottom: '2px',
            textTransform: 'uppercase',
            fontWeight: 600
          }}>
            Reserved
          </div>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono, monospace)'
          }}>
            {CashBalanceService.formatCurrency(balance.reserved_cents)}
          </div>
        </div>
      </div>

      {/* Actions */}
      {showActions && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px'
        }}>
          <button
            onClick={handleDeposit}
            style={{
              border: '2px solid var(--accent)',
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              padding: '10px 16px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            + Deposit
          </button>

          <button
            onClick={handleWithdraw}
            disabled={balance.available_cents === 0}
            style={{
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: balance.available_cents === 0 ? 'var(--text-secondary)' : 'var(--text)',
              padding: '10px 16px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: balance.available_cents === 0 ? 'not-allowed' : 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              opacity: balance.available_cents === 0 ? 0.5 : 1
            }}
          >
            Withdraw
          </button>
        </div>
      )}

      {/* Info */}
      {balance.reserved_cents > 0 && (
        <div style={{
          marginTop: '12px',
          fontSize: '10px',
          color: 'var(--text-secondary)',
          fontStyle: 'italic'
        }}>
          Reserved funds are held for open orders
        </div>
      )}
    </div>
  );
}

