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

const formatLargeUSD = (value: number) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const EXCHANGE_API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-v1-exchange`;

function FundSkeleton() {
  return (
    <div style={{
      padding: '18px',
      border: '2px solid var(--border)',
      borderRadius: '6px',
      background: 'var(--surface)',
      animation: 'pulse 1.5s ease-in-out infinite',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ height: '18px', width: '60px', background: 'var(--border)', borderRadius: '3px' }} />
        <div style={{ height: '14px', width: '30px', background: 'var(--border)', borderRadius: '3px' }} />
      </div>
      <div style={{ height: '14px', width: '80%', background: 'var(--border)', borderRadius: '3px', marginBottom: '12px' }} />
      <div style={{ height: '12px', width: '100%', background: 'var(--border)', borderRadius: '3px', marginBottom: '6px' }} />
      <div style={{ height: '16px', width: '40%', background: 'var(--border)', borderRadius: '3px' }} />
    </div>
  );
}

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
      change7: f.stats.change_7d_pct,
      change30: f.stats.change_30d_pct,
    }));
  }, [funds]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
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
    if (pct === null) return 'var(--surface)';
    if (pct > 0) return 'rgba(22, 130, 93, 0.06)';
    if (pct < 0) return 'rgba(209, 52, 56, 0.06)';
    return 'var(--surface)';
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: 'var(--fs-12)', margin: 0, fontWeight: 900 }}>Market Exchange</h1>
              <span style={{
                fontSize: 'var(--fs-8)',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '3px',
                border: '1.5px solid var(--border)',
                color: 'var(--text-secondary)',
                letterSpacing: '0.05em',
              }}>
                BETA
              </span>
            </div>
            <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Collector vehicle segment ETFs — AI-managed, data-driven
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/portfolio')}>
              My Portfolio
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/competitors')}>
              vs. Competition
            </button>
            <button className="button button-secondary" onClick={() => navigate('/')}>
              Back
            </button>
          </div>
        </div>

        {/* Error state — generic, no technical details */}
        {error && (
          <div style={{
            marginBottom: '16px',
            padding: '14px 16px',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--surface)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}>
            <div>
              <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700, marginBottom: '4px' }}>
                Unable to load market data
              </div>
              <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>
                The market data service may be temporarily unavailable. Try refreshing.
              </div>
            </div>
            <button
              className="button button-secondary"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        )}

        {/* Fund grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
          gap: '12px',
          marginBottom: '32px',
        }}>
          {loading ? (
            [1, 2, 3, 4].map(i => <FundSkeleton key={i} />)
          ) : (
            tiles.map((t) => (
              <button
                key={t.fund.id}
                onClick={() => navigate(`/market/exchange/${t.fund.symbol}`)}
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: '18px',
                  border: '2px solid var(--border)',
                  borderRadius: '6px',
                  background: tileBg(t.change7),
                  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                  display: 'block',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {/* Symbol + type badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 900, fontSize: 'var(--fs-12)' }}>{t.fund.symbol}</span>
                  <span style={{
                    fontSize: 'var(--fs-8)',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    padding: '1px 5px',
                    borderRadius: '3px',
                  }}>
                    {t.managerType.toUpperCase()}
                  </span>
                </div>

                {/* Name */}
                <div style={{ fontSize: 'var(--fs-9)', fontWeight: 600, marginBottom: '12px' }}>
                  {t.label}
                </div>

                {/* NAV */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: 'var(--fs-11)', fontWeight: 800 }}>
                    ${t.fund.nav_share_price.toFixed(4)}
                  </div>
                  <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    NAV per share
                  </div>
                </div>

                {/* Stats */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  paddingTop: '10px',
                  borderTop: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>Market Cap</div>
                    <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700 }}>
                      {formatLargeUSD(t.marketCap)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>7d</div>
                    <div style={{
                      fontSize: 'var(--fs-9)',
                      fontWeight: 700,
                      color: t.change7 === null
                        ? 'var(--text-secondary)'
                        : t.change7 > 0 ? 'var(--success)' : t.change7 < 0 ? 'var(--error)' : 'var(--text)',
                    }}>
                      {formatPct(t.change7)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>Vehicles</div>
                    <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700 }}>
                      {t.vehicleCount.toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>30d</div>
                    <div style={{
                      fontSize: 'var(--fs-9)',
                      fontWeight: 700,
                      color: t.change30 === null
                        ? 'var(--text-secondary)'
                        : t.change30 > 0 ? 'var(--success)' : t.change30 < 0 ? 'var(--error)' : 'var(--text)',
                    }}>
                      {formatPct(t.change30)}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Regulatory notice — clean, not alarming */}
        <div style={{
          padding: '14px 16px',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          background: 'var(--surface)',
          fontSize: 'var(--fs-8)',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--text)' }}>Note:</strong> The Nuke Market Exchange is in beta.
          Live trading is pending SEC Reg A+ filing (estimated 12-18 months). NAV data is updated every 15 minutes from verified auction records.
        </div>
      </div>
    </div>
  );
}
