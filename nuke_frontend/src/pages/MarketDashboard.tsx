import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const EXCHANGE_API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-v1-exchange`;

interface FundSummary {
  id: string;
  symbol: string;
  nav_share_price: number;
  total_aum_usd: number;
  segment?: {
    name: string;
    description: string | null;
  };
  stats: {
    vehicle_count: number;
    market_cap_usd: number;
    change_7d_pct: number | null;
    change_30d_pct: number | null;
  };
}

const formatPct = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return null;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const formatLargeUSD = (value: number) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const formatCount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
};

function SkeletonCard() {
  return (
    <div style={{
      border: '2px solid var(--border)',
      borderRadius: '6px',
      padding: '18px',
      background: 'var(--surface)',
      animation: 'pulse 1.5s ease-in-out infinite',
    }}>
      <div style={{ height: '14px', background: 'var(--border)', borderRadius: '3px', marginBottom: '10px', width: '40%' }} />
      <div style={{ height: '24px', background: 'var(--border)', borderRadius: '3px', marginBottom: '8px', width: '60%' }} />
      <div style={{ height: '10px', background: 'var(--border)', borderRadius: '3px', width: '80%' }} />
    </div>
  );
}

export default function MarketDashboard() {
  const navigate = useNavigate();
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        };
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(`${EXCHANGE_API}?action=funds`, { headers });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setFunds(json.funds || []);
      } catch (e: any) {
        setError(e?.message || 'Failed to load market data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalPlatformAUM = funds.reduce((sum, f) => sum + (f.stats.market_cap_usd || 0), 0);
  const totalVehicles = funds.reduce((sum, f) => sum + (f.stats.vehicle_count || 0), 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '32px'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 'var(--fs-12)', fontWeight: 900 }}>Market Exchange</h1>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>
              Collector vehicle segment ETFs — AI-managed, data-driven
            </p>
          </div>
          <button className="button button-secondary" onClick={() => navigate('/')}>
            Back
          </button>
        </div>

        {/* Platform Stats Strip */}
        {!loading && !error && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '10px',
            marginBottom: '28px'
          }}>
            {[
              { label: 'Platform AUM', value: formatLargeUSD(totalPlatformAUM) },
              { label: 'Vehicles Indexed', value: formatCount(totalVehicles) },
              { label: 'Active Funds', value: `${funds.length}` },
              { label: 'Structure', value: 'Segment ETFs' },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  padding: '14px 16px',
                  border: '2px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--surface)',
                }}
              >
                <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {label}
                </div>
                <div style={{ fontSize: 'var(--fs-12)', fontWeight: 900 }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Fund Cards */}
        <div style={{ marginBottom: '16px', fontSize: 'var(--fs-9)', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Funds
        </div>

        {error && (
          <div style={{
            padding: '16px',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--surface)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-9)',
            marginBottom: '20px'
          }}>
            Unable to load market data. Try refreshing.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px', marginBottom: '32px' }}>
          {loading ? (
            [1, 2, 3, 4].map(i => <SkeletonCard key={i} />)
          ) : (
            funds.map((fund) => {
              const pct7d = formatPct(fund.stats.change_7d_pct);
              const pct30d = formatPct(fund.stats.change_30d_pct);
              const isUp7d = (fund.stats.change_7d_pct ?? 0) > 0;
              const isDown7d = (fund.stats.change_7d_pct ?? 0) < 0;

              return (
                <button
                  key={fund.id}
                  onClick={() => navigate(`/market/exchange/${fund.symbol}`)}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '18px',
                    border: '2px solid var(--border)',
                    borderRadius: '6px',
                    background: isUp7d
                      ? 'rgba(22, 130, 93, 0.06)'
                      : isDown7d
                        ? 'rgba(209, 52, 56, 0.06)'
                        : 'var(--surface)',
                    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                    display: 'block',
                    width: '100%',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {/* Symbol + type */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 900, fontSize: 'var(--fs-12)' }}>{fund.symbol}</span>
                    <span style={{
                      fontSize: 'var(--fs-8)',
                      color: 'var(--text-secondary)',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      padding: '1px 5px',
                      borderRadius: '3px',
                    }}>
                      ETF
                    </span>
                  </div>

                  {/* Name */}
                  <div style={{ fontSize: 'var(--fs-9)', fontWeight: 600, marginBottom: '12px' }}>
                    {fund.segment?.name || fund.symbol}
                  </div>

                  {/* NAV + market cap */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: 'var(--fs-11)', fontWeight: 800 }}>
                      ${fund.nav_share_price.toFixed(4)}
                    </div>
                    <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      NAV per share
                    </div>
                  </div>

                  {/* Stats row */}
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
                        {formatLargeUSD(fund.stats.market_cap_usd)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>7d</div>
                      <div style={{
                        fontSize: 'var(--fs-9)',
                        fontWeight: 700,
                        color: pct7d
                          ? isUp7d ? 'var(--success)' : isDown7d ? 'var(--error)' : 'var(--text)'
                          : 'var(--text-secondary)',
                      }}>
                        {pct7d ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>Vehicles</div>
                      <div style={{ fontSize: 'var(--fs-9)', fontWeight: 700 }}>
                        {formatCount(fund.stats.vehicle_count)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-secondary)' }}>30d</div>
                      <div style={{
                        fontSize: 'var(--fs-9)',
                        fontWeight: 700,
                        color: pct30d
                          ? (fund.stats.change_30d_pct ?? 0) > 0
                            ? 'var(--success)'
                            : (fund.stats.change_30d_pct ?? 0) < 0 ? 'var(--error)' : 'var(--text)'
                          : 'var(--text-secondary)',
                      }}>
                        {pct30d ?? '—'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* CTA Section */}
        <div style={{
          padding: '24px',
          border: '2px solid var(--border)',
          borderRadius: '6px',
          background: 'var(--surface)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 'var(--fs-10)', fontWeight: 800, marginBottom: '6px' }}>
              Invest in the Collector Vehicle Market
            </div>
            <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Segment ETFs backed by real auction data.
              Awaiting SEC Reg A+ filing.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              className="button button-primary"
              onClick={() => navigate('/market/exchange')}
            >
              View Exchange
            </button>
            <button
              className="button button-secondary"
              onClick={() => navigate('/market/portfolio')}
            >
              My Portfolio
            </button>
            <button
              className="button button-secondary"
              onClick={() => navigate('/market/competitors')}
            >
              vs. Competition
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
