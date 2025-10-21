import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { CashBalanceService } from '../../services/cashBalanceService';

interface BondInvestmentProps {
  vehicleId: string;
  vehicleName: string;
}

export default function BondInvestment({ vehicleId, vehicleName }: BondInvestmentProps) {
  const [amount, setAmount] = useState('1000'); // Default $10
  const [bond, setBond] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [vehicleId]);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const cashBalance = await CashBalanceService.getUserBalance(user.id);
      if (cashBalance) {
        setBalance(cashBalance.available_cents);
      }

      // Load active bond
      const { data: bondData } = await supabase
        .from('vehicle_bonds')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .in('status', ['open', 'funded'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (bondData) {
        setBond(bondData);
      }
    } catch (error) {
      console.error('Failed to load bond:', error);
    }
  };

  const handleBuyBond = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please sign in');
        return;
      }

      const amountCents = parseInt(amount);
      if (!amountCents || amountCents < 100) {
        alert('Minimum investment is $1.00');
        return;
      }

      if (balance < amountCents) {
        alert(`Insufficient funds. You have ${CashBalanceService.formatCurrency(balance)}`);
        return;
      }

      setLoading(true);

      const { error } = await supabase.rpc('buy_bond', {
        p_bond_id: bond.id,
        p_holder_id: user.id,
        p_amount_cents: amountCents
      });

      if (error) throw error;

      setAmount('1000');
      await loadData();
      alert(`✅ Purchased ${CashBalanceService.formatCurrency(amountCents)} in bonds!`);

    } catch (error) {
      console.error('Bond purchase error:', error);
      alert('Failed to purchase bond: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!bond) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '9px'
      }}>
        No active bonds available for this vehicle
      </div>
    );
  }

  const annualInterest = Math.floor(parseInt(amount) * bond.interest_rate_pct / 100);
  const totalReturn = parseInt(amount) + Math.floor(annualInterest * bond.term_months / 12);

  return (
    <div>
      {/* Bond Details */}
      <div style={{
        background: 'var(--accent-dim)',
        border: '2px solid var(--accent)',
        borderRadius: '4px',
        padding: '12px',
        marginBottom: '12px'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '12px',
          marginBottom: '8px'
        }}>
          <div>
            <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Interest Rate
            </div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent)' }}>
              {bond.interest_rate_pct}% APY
            </div>
          </div>
          <div>
            <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Term
            </div>
            <div style={{ fontSize: '11px', fontWeight: 700 }}>
              {bond.term_months} months
            </div>
          </div>
          <div>
            <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Available
            </div>
            <div style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
              {CashBalanceService.formatCurrency(bond.principal_amount_cents - bond.amount_sold_cents)}
            </div>
          </div>
        </div>

        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
          {bond.description || 'Fixed-income bond with guaranteed interest'}
        </div>
      </div>

      {/* Investment Amount */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{
          display: 'block',
          fontSize: '8px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: '4px',
          textTransform: 'uppercase'
        }}>
          Investment Amount
        </label>

        {/* Quick amounts */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
          {[1000, 5000, 10000].map(amt => (
            <button
              key={amt}
              onClick={() => setAmount(amt.toString())}
              style={{
                padding: '6px 10px',
                background: parseInt(amount) === amt ? 'var(--accent-dim)' : 'var(--surface)',
                border: `2px solid ${parseInt(amount) === amt ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '4px',
                fontSize: '9px',
                fontWeight: 600,
                cursor: 'pointer',
                color: parseInt(amount) === amt ? 'var(--accent)' : 'var(--text)'
              }}
            >
              {CashBalanceService.formatCurrency(amt)}
            </button>
          ))}
        </div>

            <input
              type="number"
              value={(parseInt(amount) / 100).toFixed(2)}
              onChange={(e) => setAmount(Math.floor(parseFloat(e.target.value) * 100).toString())}
              placeholder="10.00"
              min="1"
              step="0.01"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono, monospace)',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--bg)',
                color: 'var(--text)',
                boxSizing: 'border-box'
              }}
            />
        <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Available: {CashBalanceService.formatCurrency(balance)}
        </div>
      </div>

      {/* Return Preview */}
      {amount && parseInt(amount) >= 100 && (
        <div style={{
          background: 'var(--bg)',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          padding: '10px',
          marginBottom: '12px',
          fontSize: '9px',
          fontFamily: 'var(--font-mono, monospace)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Principal:</span>
            <span>{CashBalanceService.formatCurrency(parseInt(amount))}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Interest @ {bond.interest_rate_pct}%:</span>
            <span style={{ color: 'var(--success)' }}>
              +{CashBalanceService.formatCurrency(annualInterest)}
            </span>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: '6px',
            borderTop: '1px solid var(--border)',
            fontWeight: 700
          }}>
            <span>Total Return ({bond.term_months}mo):</span>
            <span style={{ color: 'var(--success)' }}>
              {CashBalanceService.formatCurrency(totalReturn)}
            </span>
          </div>
        </div>
      )}

      {/* Buy Button */}
      <button
        onClick={handleBuyBond}
        disabled={loading || !amount || parseInt(amount) < 100}
        style={{
          width: '100%',
          padding: '10px',
          border: '2px solid var(--accent)',
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          fontSize: '10px',
          fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer',
          borderRadius: '4px',
          opacity: (!amount || parseInt(amount) < 100) ? 0.5 : 1
        }}
      >
        {loading ? 'Processing...' : `Buy Bond`}
      </button>

      {/* Info */}
      <div style={{
        marginTop: '10px',
        padding: '10px',
        background: 'var(--accent-dim)',
        border: '2px solid var(--accent)',
        borderRadius: '4px',
        fontSize: '8px',
        color: 'var(--text-secondary)',
        lineHeight: 1.5
      }}>
        <strong style={{ color: 'var(--accent)' }}>Bond Terms</strong>
        <br />
        • Fixed {bond.interest_rate_pct}% annual interest
        <br />
        • {bond.term_months} month term
        <br />
        • Interest paid at maturity
        <br />
        • Principal returned when vehicle sells
      </div>
    </div>
  );
}

