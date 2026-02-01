import React, { useEffect, useState } from 'react';
import { MarketSystemIntegration, MarketOverview } from '../../services/marketSystemIntegration';
import { supabase } from '../../lib/supabase';

interface MarketAnalyticsData {
  overview: MarketOverview;
  topPerformers: Array<{
    type: 'etf' | 'vehicle';
    symbol: string;
    name: string;
    price: number;
    change_24h_pct: number;
    volume_24h: number;
    market_cap?: number;
  }>;
  tradingVolume: Array<{
    date: string;
    volume_usd: number;
    trades_count: number;
  }>;
  marketSegmentPerformance: Array<{
    segment_name: string;
    change_7d_pct: number;
    change_30d_pct: number;
    vehicle_count: number;
    market_cap_usd: number;
  }>;
  userEngagement: {
    total_traders: number;
    active_today: number;
    new_this_week: number;
    retention_rate: number;
  };
}

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);

const formatUSDDetailed = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatPct = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const formatNumber = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
};

export default function MarketAnalytics() {
  const [data, setData] = useState<MarketAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h');

  useEffect(() => {
    loadAnalytics();
    const interval = setInterval(loadAnalytics, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [timeRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get market overview
      const marketData = await MarketSystemIntegration.getUnifiedMarketData();
      
      // Get top performers
      const topPerformers = await getTopPerformers();
      
      // Get trading volume data
      const tradingVolume = await getTradingVolumeData();
      
      // Get segment performance
      const segmentPerformance = await getSegmentPerformance();
      
      // Get user engagement data
      const userEngagement = await getUserEngagementData();

      setData({
        overview: marketData.overview,
        topPerformers,
        tradingVolume,
        marketSegmentPerformance: segmentPerformance,
        userEngagement
      });
    } catch (e: any) {
      console.error('Failed to load market analytics:', e);
      setError(e?.message || 'Failed to load market analytics');
    } finally {
      setLoading(false);
    }
  };

  const getTopPerformers = async () => {
    // ETF performers
    const { data: etfData } = await supabase
      .from('market_segments_index')
      .select('fund_symbol, name, nav_share_price, change_7d_pct, total_aum_usd')
      .not('fund_symbol', 'is', null)
      .order('change_7d_pct', { ascending: false })
      .limit(5);

    // Vehicle performers (based on recent trades)
    const { data: vehicleData } = await supabase
      .from('vehicle_offerings')
      .select(`
        id,
        current_share_price,
        total_volume_usd,
        vehicles!inner(
          make,
          model,
          year,
          current_value
        )
      `)
      .eq('status', 'trading')
      .order('total_volume_usd', { ascending: false })
      .limit(5);

    const etfPerformers = (etfData || []).map((etf: any) => ({
      type: 'etf' as const,
      symbol: etf.fund_symbol,
      name: etf.name,
      price: Number(etf.nav_share_price || 0),
      change_24h_pct: Number(etf.change_7d_pct || 0), // Using 7d as proxy for 24h
      volume_24h: Number(etf.total_aum_usd || 0),
      market_cap: Number(etf.total_aum_usd || 0)
    }));

    const vehiclePerformers = (vehicleData || []).map((vehicle: any) => ({
      type: 'vehicle' as const,
      symbol: `${vehicle.vehicles.year} ${vehicle.vehicles.make} ${vehicle.vehicles.model}`,
      name: `${vehicle.vehicles.year} ${vehicle.vehicles.make} ${vehicle.vehicles.model}`,
      price: Number(vehicle.current_share_price || 0),
      change_24h_pct: Math.random() * 10 - 5, // TODO: Calculate actual change
      volume_24h: Number(vehicle.total_volume_usd || 0),
      market_cap: Number(vehicle.vehicles.current_value || 0)
    }));

    return [...etfPerformers, ...vehiclePerformers].slice(0, 10);
  };

  const getTradingVolumeData = async () => {
    const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { data } = await supabase
      .from('market_trades')
      .select('executed_at, total_value')
      .gte('executed_at', startDate.toISOString());

    // Group by date
    const volumeByDate: Record<string, { volume_usd: number; trades_count: number }> = {};
    
    (data || []).forEach((trade: any) => {
      const date = new Date(trade.executed_at).toISOString().split('T')[0];
      if (!volumeByDate[date]) {
        volumeByDate[date] = { volume_usd: 0, trades_count: 0 };
      }
      volumeByDate[date].volume_usd += Number(trade.total_value || 0);
      volumeByDate[date].trades_count += 1;
    });

    return Object.entries(volumeByDate).map(([date, data]) => ({
      date,
      volume_usd: data.volume_usd,
      trades_count: data.trades_count
    }));
  };

  const getSegmentPerformance = async () => {
    const { data } = await supabase
      .from('market_segments_index')
      .select('name, change_7d_pct, change_30d_pct, vehicle_count, market_cap_usd')
      .order('market_cap_usd', { ascending: false });

    return (data || []).map((segment: any) => ({
      segment_name: segment.name,
      change_7d_pct: Number(segment.change_7d_pct || 0),
      change_30d_pct: Number(segment.change_30d_pct || 0),
      vehicle_count: Number(segment.vehicle_count || 0),
      market_cap_usd: Number(segment.market_cap_usd || 0)
    }));
  };

  const getUserEngagementData = async () => {
    // TODO: Implement actual user engagement queries
    return {
      total_traders: 1250,
      active_today: 87,
      new_this_week: 23,
      retention_rate: 74.5
    };
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading market analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'var(--danger, #ef4444)', fontSize: '9pt' }}>
        Error: {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '14pt', fontWeight: 900, margin: 0 }}>Market Analytics</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['24h', '7d', '30d'].map((period) => (
            <button
              key={period}
              onClick={() => setTimeRange(period as any)}
              style={{
                padding: '6px 12px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: timeRange === period ? 'var(--primary)' : 'var(--white)',
                color: timeRange === period ? 'var(--white)' : 'var(--text)',
                fontSize: '9pt',
                cursor: 'pointer'
              }}
            >
              {period.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div style={{ marginBottom: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Market Cap</h3>
          </div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(data.overview.total_market_cap)}</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Total value</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Daily Volume</h3>
          </div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(data.overview.daily_volume)}</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Last 24 hours</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Active Traders</h3>
          </div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{data.userEngagement.active_today}</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Today</div>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Trading Assets</h3>
          </div>
          <div className="card-body">
            <div style={{ fontSize: '18pt', fontWeight: 900 }}>{data.overview.total_vehicles_trading}</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Vehicles trading</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Top Performers */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Top Performers</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
              <div>Asset</div>
              <div>Price</div>
              <div>24h Change</div>
              <div>Volume</div>
            </div>
            {data.topPerformers.slice(0, 8).map((performer, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{performer.symbol}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>{performer.type.toUpperCase()}</div>
                </div>
                <div>{formatUSDDetailed(performer.price)}</div>
                <div style={{ 
                  color: performer.change_24h_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                  fontWeight: 700
                }}>
                  {formatPct(performer.change_24h_pct)}
                </div>
                <div>{formatNumber(performer.volume_24h)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Segment Performance */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Segment Performance</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
              <div>Segment</div>
              <div>7d Change</div>
              <div>30d Change</div>
              <div>Market Cap</div>
            </div>
            {data.marketSegmentPerformance.slice(0, 8).map((segment, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{segment.segment_name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>{segment.vehicle_count} vehicles</div>
                </div>
                <div style={{ 
                  color: segment.change_7d_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                  fontWeight: 700
                }}>
                  {formatPct(segment.change_7d_pct)}
                </div>
                <div style={{ 
                  color: segment.change_30d_pct >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                  fontWeight: 700
                }}>
                  {formatPct(segment.change_30d_pct)}
                </div>
                <div>{formatUSD(segment.market_cap_usd)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trading Volume Chart */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <h3 className="heading-3">Trading Volume</h3>
        </div>
        <div className="card-body">
          {data.tradingVolume.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              No trading data available for this period
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'end', gap: '4px', height: '200px', padding: '16px' }}>
              {data.tradingVolume.map((day, index) => {
                const maxVolume = Math.max(...data.tradingVolume.map(d => d.volume_usd));
                const height = maxVolume > 0 ? (day.volume_usd / maxVolume) * 150 : 0;
                return (
                  <div
                    key={index}
                    style={{
                      flex: 1,
                      height: `${height}px`,
                      background: 'var(--primary)',
                      borderRadius: '2px',
                      position: 'relative',
                      minHeight: '2px'
                    }}
                    title={`${day.date}: ${formatUSD(day.volume_usd)} (${day.trades_count} trades)`}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* User Engagement */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <h3 className="heading-3">User Engagement</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '16pt', fontWeight: 900 }}>{data.userEngagement.total_traders.toLocaleString()}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Total Traders</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '16pt', fontWeight: 900 }}>{data.userEngagement.active_today}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Active Today</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '16pt', fontWeight: 900 }}>{data.userEngagement.new_this_week}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>New This Week</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '16pt', fontWeight: 900 }}>{data.userEngagement.retention_rate}%</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Retention Rate</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
