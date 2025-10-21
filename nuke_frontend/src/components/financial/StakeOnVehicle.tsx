import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { CashBalanceService } from '../../services/cashBalanceService';

interface StakeOnVehicleProps {
  vehicleId: string;
  vehicleName: string;
  vehicleValue: number;
}

export default function StakeOnVehicle({ vehicleId, vehicleName, vehicleValue }: StakeOnVehicleProps) {
  const [amount, setAmount] = useState('300'); // Default $3
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [balance, setBalance] = useState(0);
  const [fundingRound, setFundingRound] = useState<any>(null);
  const [userStake, setUserStake] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [vehicleId]);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Load cash balance
      const cashBalance = await CashBalanceService.getUserBalance(user.id);
      if (cashBalance) {
        setBalance(cashBalance.available_cents);
      }

      // Load active funding round
      const { data: roundData } = await supabase
        .from('vehicle_funding_rounds')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .in('status', ['fundraising', 'funded', 'building'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (roundData) {
        setFundingRound(roundData);
      }

      // Load user's existing stake
      if (roundData) {
        const { data: stakeData } = await supabase
          .from('profit_share_stakes')
          .select('*')
          .eq('funding_round_id', roundData.id)
          .eq('staker_id', user.id)
          .single();

        if (stakeData) {
          setUserStake(stakeData);
        }
      }
    } catch (error) {
      console.error('Failed to load staking data:', error);
    }
  };

  const handleStake = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please sign in to stake');
        return;
      }

      const amountCents = parseInt(amount);
      if (!amountCents || amountCents < 300) {
        alert('Minimum stake is $3.00');
        return;
      }

      if (balance < amountCents) {
        alert(`Insufficient funds. You have ${CashBalanceService.formatCurrency(balance)}`);
        return;
      }

      if (!fundingRound) {
        alert('No active funding round for this vehicle');
        return;
      }

      setLoading(true);

      const { error } = await supabase.rpc('stake_on_vehicle', {
        p_round_id: fundingRound.id,
        p_staker_id: user.id,
        p_amount_cents: amountCents,
        p_message: message || null,
        p_anonymous: anonymous
      });

      if (error) throw error;

      setAmount('300');
      setMessage('');
      await loadData();
      alert(`✅ Staked ${CashBalanceService.formatCurrency(amountCents)} on ${vehicleName}!`);

    } catch (error) {
      console.error('Stake error:', error);
      alert('Failed to stake: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const progressPct = fundingRound 
    ? (fundingRound.raised_amount_cents / fundingRound.target_amount_cents) * 100
    : 0;

  return (
    <div>
      {/* Funding Round Info */}
      {fundingRound ? (
        <>
          <div style={{
            background: 'var(--accent-dim)',
            border: '2px solid var(--accent)',
            borderRadius: '4px',
            padding: '12px',
            marginBottom: '12px'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px'
            }}>
              <div>
                <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Funding Target
                </div>
                <div style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                  {CashBalanceService.formatCurrency(fundingRound.target_amount_cents)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Raised
                </div>
                <div style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                  {CashBalanceService.formatCurrency(fundingRound.raised_amount_cents)}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div style={{
              width: '100%',
              height: '6px',
              background: 'var(--border)',
              borderRadius: '3px',
              overflow: 'hidden',
              marginBottom: '8px'
            }}>
              <div style={{
                width: `${Math.min(progressPct, 100)}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: '0.3s'
              }} />
            </div>

            <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
              {progressPct.toFixed(1)}% funded · Profit share: {fundingRound.profit_share_pct}% to stakers
            </div>
          </div>

          {/* User's Current Stake */}
          {userStake && (
            <div style={{
              background: 'var(--success-dim)',
              border: '2px solid var(--success)',
              borderRadius: '4px',
              padding: '10px',
              marginBottom: '12px',
              fontSize: '9px'
            }}>
              <strong>Your Stake:</strong> {CashBalanceService.formatCurrency(userStake.amount_staked_cents)}
              <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>
                ({userStake.percentage_of_pool?.toFixed(2)}% of pool)
              </span>
            </div>
          )}

          {/* Stake Amount */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{
              display: 'block',
              fontSize: '8px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              textTransform: 'uppercase'
            }}>
              Stake Amount
            </label>

            {/* Quick amounts */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
              {[300, 500, 1000, 5000].map(amt => (
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
              placeholder="3.00"
              min="3"
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

          {/* Message */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{
              display: 'block',
              fontSize: '8px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              textTransform: 'uppercase'
            }}>
              Message (optional)
            </label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Good luck with the build!"
              maxLength={200}
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '9px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--bg)',
                color: 'var(--text)',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Anonymous */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '9px',
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
              />
              <span>Stake anonymously</span>
            </label>
          </div>

          {/* Stake Button */}
          <button
            onClick={handleStake}
            disabled={loading || !amount || parseInt(amount) < 300}
            style={{
              width: '100%',
              padding: '10px',
              border: '2px solid var(--accent)',
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              fontSize: '10px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: loading ? 'wait' : 'pointer',
              borderRadius: '4px',
              opacity: (!amount || parseInt(amount) < 300) ? 0.5 : 1
            }}
          >
            {loading ? 'Processing...' : `Stake ${CashBalanceService.formatCurrency(parseInt(amount) || 0)}`}
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
            <strong style={{ color: 'var(--accent)' }}>How Profit Stakes Work</strong>
            <br />
            • Your stake earns {fundingRound.profit_share_pct}% of net profit
            <br />
            • Paid when vehicle sells
            <br />
            • Higher sale price = higher returns
            <br />
            • Minimum stake: $3.00
          </div>
        </>
      ) : (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '9px'
        }}>
          No active funding round for this vehicle
        </div>
      )}
    </div>
  );
}

