import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';
import { useNavigate } from 'react-router-dom';

export const CashBalanceWidget: React.FC = () => {
  const [balance, setBalance] = useState<{ balance_cents: number; available_cents: number; reserved_cents: number } | null>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadBalance();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      if (session) {
        loadBalance();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadBalance = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      
      if (!session?.user) {
        setLoading(false);
        return;
      }

      const bal = await CashBalanceService.getUserBalance(session.user.id);
      setBalance(bal);
    } catch (error) {
      console.error('Error loading balance:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(cents / 100);
  };

  if (!session?.user || loading) {
    return null;
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        style={{
          background: 'var(--white)',
          border: '2px outset var(--border)',
          padding: '4px 8px',
          fontSize: '9pt',
          cursor: 'pointer',
          fontFamily: '"MS Sans Serif", sans-serif',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
        title="Your buying power"
      >
        <span style={{ fontSize: '8pt' }}>💰</span>
        <span style={{ fontWeight: 'bold' }}>
          {balance ? formatCurrency(balance.available_cents) : '—'}
        </span>
        <span style={{ fontSize: '7pt' }}>▼</span>
      </button>

      {showMenu && (
        <>
          {/* Backdrop to close menu */}
          <div
            onClick={() => setShowMenu(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999
            }}
          />

          {/* Dropdown menu */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: 'var(--white)',
              border: '2px outset var(--border)',
              boxShadow: '2px 2px 0 rgba(0,0,0,0.2)',
              zIndex: 1000,
              minWidth: '200px'
            }}
          >
            {/* Balance Details */}
            <div style={{ padding: '8px', borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Buying Power
              </div>
              <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '8px' }}>
                {balance ? formatCurrency(balance.available_cents) : '$0.00'}
              </div>
              
              {balance && balance.reserved_cents > 0 && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  Reserved: {formatCurrency(balance.reserved_cents)}
                </div>
              )}
              
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                Total: {balance ? formatCurrency(balance.balance_cents) : '$0.00'}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ padding: '4px' }}>
              <button
                onClick={() => {
                  setShowMenu(false);
                  navigate('/market');
                }}
                style={{
                  width: '100%',
                  background: 'var(--grey-100)',
                  border: '1px outset var(--border-light)',
                  padding: '6px 8px',
                  fontSize: '8pt',
                  cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: '2px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-200)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
              >
                💸 Invest Now
              </button>

              <button
                onClick={() => {
                  setShowMenu(false);
                  navigate('/portfolio');
                }}
                style={{
                  width: '100%',
                  background: 'var(--grey-100)',
                  border: '1px outset var(--border-light)',
                  padding: '6px 8px',
                  fontSize: '8pt',
                  cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: '2px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-200)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
              >
                📊 View Portfolio
              </button>

              <button
                onClick={() => {
                  setShowMenu(false);
                  // TODO: Implement add funds flow
                  alert('Add funds feature coming soon! Use Stripe checkout.');
                }}
                style={{
                  width: '100%',
                  background: 'var(--grey-100)',
                  border: '1px outset var(--border-light)',
                  padding: '6px 8px',
                  fontSize: '8pt',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-200)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
              >
                ➕ Add Funds
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CashBalanceWidget;

