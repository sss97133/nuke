import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type MarketFundRow = {
  id: string;
  symbol: string;
  fund_type: 'etf' | 'fund';
  status: 'active' | 'paused' | 'closed';
  nav_share_price: number;
  total_shares_outstanding: number;
  total_aum_usd: number;
  segment_id: string;
  segment?: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    manager_type: 'ai' | 'human';
  };
};

type SegmentStats = {
  vehicle_count: number;
  market_cap_usd: number;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
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

export default function MarketExchange() {
  const navigate = useNavigate();
  const [funds, setFunds] = useState<MarketFundRow[]>([]);
  const [statsBySegmentId, setStatsBySegmentId] = useState<Record<string, SegmentStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tiles = useMemo(() => {
    return funds.map((f) => {
      const seg = f.segment;
      const stats = statsBySegmentId[f.segment_id];
      const change7 = stats?.change_7d_pct ?? null;
      const marketCap = stats?.market_cap_usd ?? 0;
      const vehicleCount = stats?.vehicle_count ?? 0;
      return {
        fund: f,
        label: seg?.name || f.symbol,
        managerType: seg?.manager_type || 'ai',
        marketCap,
        vehicleCount,
        change7
      };
    });
  }, [funds, statsBySegmentId]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: fundRows, error: fundError } = await supabase
          .from('market_funds')
          .select(
            `
            id,
            symbol,
            fund_type,
            status,
            nav_share_price,
            total_shares_outstanding,
            total_aum_usd,
            segment_id,
            segment:market_segments (
              id,
              slug,
              name,
              description,
              manager_type
            )
          `
          )
          .eq('status', 'active')
          .order('symbol', { ascending: true });

        if (fundError) throw fundError;
        const rows = (fundRows || []) as any[];
        setFunds(
          rows.map((r) => ({
            id: r.id,
            symbol: r.symbol,
            fund_type: r.fund_type,
            status: r.status,
            nav_share_price: Number(r.nav_share_price),
            total_shares_outstanding: Number(r.total_shares_outstanding),
            total_aum_usd: Number(r.total_aum_usd),
            segment_id: r.segment_id,
            segment: r.segment
              ? {
                  id: r.segment.id,
                  slug: r.segment.slug,
                  name: r.segment.name,
                  description: r.segment.description,
                  manager_type: r.segment.manager_type
                }
              : undefined
          }))
        );

        // Load stats per segment via RPC (fast + centralized)
        const statsEntries = await Promise.allSettled(
          rows.map(async (r) => {
            const { data, error } = await supabase.rpc('market_segment_stats', {
              p_segment_id: r.segment_id
            });
            if (error) throw error;
            const first = Array.isArray(data) ? data[0] : data;
            return {
              segmentId: r.segment_id,
              stats: {
                vehicle_count: Number(first?.vehicle_count || 0),
                market_cap_usd: Number(first?.market_cap_usd || 0),
                change_7d_pct: first?.change_7d_pct === null ? null : Number(first?.change_7d_pct),
                change_30d_pct: first?.change_30d_pct === null ? null : Number(first?.change_30d_pct)
              } as SegmentStats
            };
          })
        );

        const next: Record<string, SegmentStats> = {};
        for (const e of statsEntries) {
          if (e.status === 'fulfilled') {
            next[e.value.segmentId] = e.value.stats;
          }
        }
        setStatsBySegmentId(next);
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




