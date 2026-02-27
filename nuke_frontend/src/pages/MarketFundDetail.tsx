import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { CashBalanceService } from '../services/cashBalanceService';

type FundRow = {
  id: string;
  symbol: string;
  nav_share_price: number;
  total_shares_outstanding: number;
  total_aum_usd: number;
  segment_id: string;
  segment?: {
    name: string;
    description: string | null;
    manager_type: string;
    year_min: number | null;
    year_max: number | null;
    makes: string[] | null;
    model_keywords: string[] | null;
  };
  stats?: {
    vehicle_count: number;
    market_cap_usd: number;
    change_7d_pct: number | null;
    change_30d_pct: number | null;
    stats_updated_at: string | null;
  };
};

const EXCHANGE_API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-v1-exchange`;

const formatUSD0 = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

const formatUSD2 = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

export default function MarketFundDetail() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  // useAuth reads from global AuthContext — synchronous, no getSession() call needed
  const { session, user } = useAuth();

  const [fund, setFund] = useState<FundRow | null>(null);
  const [cashCents, setCashCents] = useState<number>(0);
  const [amount, setAmount] = useState<string>('100');
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const parsedAmountUSD = useMemo(() => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  }, [amount]);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setSuccess(null);

        if (!symbol) return;

        // Use api-v1-exchange for fund data + cached stats (avoids slow market_segment_stats RPC)
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(`${EXCHANGE_API}?action=fund&symbol=${encodeURIComponent(symbol)}`, { headers });
        if (!res.ok) throw new Error(`Exchange API error: ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        if (!json.fund) {
          setFund(null);
          return;
        }

        setFund(json.fund);
        if (user?.id) {
          const bal = await CashBalanceService.getUserBalance(user.id);
          setCashCents(bal?.available_cents || 0);
        }
      } catch (e: any) {
        console.error('Failed to load market fund:', e);
        setError(e?.message || 'Failed to load market fund');
      }
    })();
  }, [symbol, session]);

  const handleBuy = async () => {
    if (!fund) return;
    if (!parsedAmountUSD) {
      setError('Enter a valid amount');
      return;
    }

    const amountCents = Math.round(parsedAmountUSD * 100);
    if (amountCents > cashCents) {
      setError(`Insufficient balance. You have ${formatUSD2(cashCents / 100)} available.`);
      return;
    }

    try {
      setBuying(true);
      setError(null);
      setSuccess(null);

      const { data, error } = await supabase.rpc('market_fund_buy', {
        p_fund_id: fund.id,
        p_amount_cents: amountCents
      });
      if (error) throw error;

      const first = Array.isArray(data) ? data[0] : data;
      setSuccess(
        `Invested ${formatUSD2(amountCents / 100)} into ${fund.symbol}. Shares issued: ${Number(first?.shares_issued || 0).toFixed(6)}`
      );

      // Refresh cash balance using user from context
      if (user?.id) {
        const bal = await CashBalanceService.getUserBalance(user.id);
        setCashCents(bal?.available_cents || 0);
      }
    } catch (e: any) {
      console.error('Fund buy failed:', e);
      setError(e?.message || 'Buy failed');
    } finally {
      setBuying(false);
    }
  };

  if (!fund) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Fund not found.
        <div style={{ marginTop: '10px' }}>
          <button className="button button-secondary" onClick={() => navigate('/market/exchange')}>
            Back to Exchange
          </button>
        </div>
      </div>
    );
  }

  const seg = fund.segment;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '14pt' }}>{fund.symbol}</h1>
              <div style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>
                {seg?.manager_type ? seg.manager_type.toUpperCase() : 'AI'} • NAV {fund.nav_share_price.toFixed(2)}
              </div>
            </div>
            <div style={{ marginTop: '6px', fontWeight: 800 }}>{seg?.name || 'Market Fund'}</div>
            {seg?.description && (
              <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>{seg.description}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/exchange')}>
              Back
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
              Portfolio
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Market Stats</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Vehicles</span>
                <strong>{(fund?.stats?.vehicle_count || 0).toLocaleString()}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Market Cap</span>
                <strong>{formatUSD0(fund?.stats?.market_cap_usd || 0)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>7d</span>
                <strong>{formatPct(fund?.stats?.change_7d_pct ?? null)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>30d</span>
                <strong>{formatPct(fund?.stats?.change_30d_pct ?? null)}</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Rules</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '8px', fontSize: '9pt' }}>
              <div>
                <strong>Year</strong>: {seg?.year_min ?? '—'} to {seg?.year_max ?? '—'}
              </div>
              <div>
                <strong>Makes</strong>: {seg?.makes?.length ? seg.makes.join(', ') : 'Any'}
              </div>
              <div>
                <strong>Keywords</strong>: {seg?.model_keywords?.length ? seg.model_keywords.join(', ') : 'None'}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Invest</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: '10px' }}>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                Available cash: <strong>{formatUSD2(cashCents / 100)}</strong>
              </div>
              <div style={{ display: 'grid', gap: '6px' }}>
                <label style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Amount (USD)</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{
                    border: '2px solid var(--border)',
                    padding: '8px',
                    borderRadius: '4px',
                    background: 'var(--white)',
                    color: 'var(--text)'
                  }}
                  inputMode="decimal"
                />
              </div>
              <button className="button button-primary" disabled={buying} onClick={handleBuy}>
                {buying ? 'Investing...' : 'Invest'}
              </button>
              <div style={{ fontSize: '8.5pt', color: 'var(--text-muted)' }}>
                MVP: shares are issued at current NAV. NAV updates can be automated later (nightly/real-time).
              </div>
              {error && <div style={{ fontSize: '9pt', color: 'var(--danger, #b91c1c)' }}>{error}</div>}
              {success && <div style={{ fontSize: '9pt', color: 'var(--text)' }}>{success}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}







