import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';
import type { CashBalance } from '../services/cashBalanceService';
import '../design-system.css';

export default function PortfolioWithdraw() {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<CashBalance | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadBalance = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate(`/login?returnUrl=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
        return;
      }

      const userBalance = await CashBalanceService.getUserBalance(user.id);
      if (!userBalance) {
        setBalance(null);
        setError('Unable to load your cash balance.');
        return;
      }
      setBalance(userBalance);
    } catch (err: any) {
      setBalance(null);
      setError(err?.message || 'Failed to load balance.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBalance();
  }, []);

  const handleWithdraw = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const amountUsd = Number(amount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setError('Enter a valid withdrawal amount.');
      return;
    }

    if (!balance) {
      setError('Balance unavailable. Please reload and try again.');
      return;
    }

    const amountCents = Math.round(amountUsd * 100);
    if (amountCents > balance.available_cents) {
      setError('Withdrawal amount exceeds available balance.');
      return;
    }

    try {
      setSubmitting(true);
      await CashBalanceService.withdrawCash(amountUsd);
      setSuccess('Withdrawal submitted. You will see the payout once it clears.');
      setAmount('');
      await loadBalance();
    } catch (err: any) {
      setError(err?.message || 'Withdrawal failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="layout">
      <div className="container">
        <div className="main" style={{ padding: '24px' }}>
          <div className="card" style={{ maxWidth: '520px', margin: '0 auto' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Withdraw Cash</span>
              <button
                className="button button-secondary"
                style={{ fontSize: '8pt' }}
                onClick={() => navigate('/portfolio')}
              >
                Back to Portfolio
              </button>
            </div>
            <div className="card-body">
              {loading && <p className="text-small text-muted">Loading balance...</p>}
              {!loading && balance && (
                <div style={{ marginBottom: '16px' }}>
                  <div className="text-small text-muted">Available balance</div>
                  <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--accent)' }}>
                    {CashBalanceService.formatCurrency(balance.available_cents)}
                  </div>
                </div>
              )}

              {error && (
                <div className="alert alert-error" style={{ marginBottom: '12px' }}>
                  {error}
                </div>
              )}
              {success && (
                <div className="alert alert-success" style={{ marginBottom: '12px' }}>
                  {success}
                </div>
              )}

              <form onSubmit={handleWithdraw}>
                <label className="text-small font-bold" htmlFor="withdraw-amount">
                  Amount (USD)
                </label>
                <input
                  id="withdraw-amount"
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={loading || submitting}
                  style={{ marginTop: '6px', marginBottom: '16px' }}
                />
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={loading || submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit Withdrawal'}
                </button>
              </form>
              <p className="text-small text-muted" style={{ marginTop: '12px' }}>
                Withdrawals are processed via Stripe payouts and may take several days.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
