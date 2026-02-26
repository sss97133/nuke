import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type FundWithStats = {
  id: string;
  symbol: string;
  fund_type: string;
  status: string;
  nav_share_price: number;
  total_shares_outstanding: number;
  total_aum_usd: number;
  segment_id: string;
  segment?: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    manager_type: string;
  };
  stats: {
    vehicle_count: number;
    market_cap_usd: number;
    change_7d_pct: number | null;
    change_30d_pct: number | null;
    stats_updated_at: string | null;
  };
};

const formatUSD0 = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const EXCHANGE_API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-v1-exchange`;

export default function MarketExchange() {
  const navigate = useNavigate();
  const [funds, setFunds] = useState<FundWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tiles = useMemo(() => {
    return funds.map((f) => ({
      fund: f,
      label: f.segment?.name || f.symbol,
      managerType: f.segment?.manager_type || 'ai',
      marketCap: f.stats.market_cap_usd,
      vehicleCount: f.stats.vehicle_count,
      change7: f.stats.change_7d_pct
    }));
  }, [funds]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Single call to api-v1-exchange — returns funds with cached stats (no slow RPC)
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(`${EXCHANGE_API}?action=funds`, { headers });
        if (!res.ok) throw new Error(`Exchange API error: ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);

        setFunds(json.funds || []);
      } catch (e: any) {
        console.error('Failed to load market exchange:', e);
        setError(e?.message || 'Failed to load market exchange');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tileBg = (pct: number | null) => {
    if (pct === null) return 'rgba(0,0,0,0.03)';
    if (pct > 0) return 'rgba(16, 185, 129, 0.14)';
    if (pct < 0) return 'rgba(220, 38, 38, 0.14)';
    return 'rgba(0,0,0,0.03)';
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading markets...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '12pt', margin: 0 }}>Market Exchange</h1>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Segment ETFs (AI-managed and human-managed) you can invest into.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
              Portfolio
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/competitors')}>
              vs. Competition
            </button>
            <button className="button button-secondary" onClick={() => navigate('/')}>
              Back
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: '16px', padding: '12px', border: '2px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>Error</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{error}</div>
          </div>
        )}

        <div style={{ marginTop: '18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
          {tiles.map((t) => (
            <button
              key={t.fund.id}
              onClick={() => navigate(`/market/exchange/${t.fund.symbol}`)}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                padding: '14px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: tileBg(t.change7),
                transition: 'transform 0.12s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline' }}>
                <div style={{ fontWeight: 800 }}>{t.fund.symbol}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{t.managerType.toUpperCase()}</div>
              </div>
              <div style={{ marginTop: '6px', fontWeight: 700 }}>{t.label}</div>
              <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                {t.vehicleCount.toLocaleString()} vehicles • {formatUSD0(t.marketCap)} market cap
              </div>
              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>7d</div>
                <div style={{ fontWeight: 800 }}>{formatPct(t.change7)}</div>
              </div>
              <div style={{ marginTop: '8px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                NAV {t.fund.nav_share_price.toFixed(2)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}







