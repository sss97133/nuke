import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

// Platform display names and colors
// These chart colors are hardcoded hex values required by SVG stroke/fill rendering.
const PLATFORM_DISPLAY: Record<string, { name: string; color: string }> = {
  bat: { name: 'Bring a Trailer', color: '#ff6b6b' },
  pcarmarket: { name: 'PCarMarket', color: '#00d4ff' },
  cars_and_bids: { name: 'Cars & Bids', color: '#ffd93d' },
  collecting_cars: { name: 'Collecting Cars', color: '#6bcb77' },
  broad_arrow: { name: 'Broad Arrow', color: '#c77dff' },
  'rm-sothebys': { name: "RM Sotheby's", color: '#ff9f43' },
  gooding: { name: 'Gooding & Co', color: '#ee5a24' },
  mecum: { name: 'Mecum', color: '#0abde3' },
  barrettjackson: { name: 'Barrett-Jackson', color: '#e056fd' },
  hagerty: { name: 'Hagerty', color: '#10ac84' },
  sbx: { name: 'SBX', color: '#5f27cd' },
  bonhams: { name: 'Bonhams', color: '#f368e0' },
};

const SENTIMENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  hot: { bg: 'var(--error)', text: 'var(--surface-elevated)', label: 'HOT' },
  warm: { bg: 'var(--orange)', text: 'var(--surface-elevated)', label: 'WARM' },
  neutral: { bg: 'var(--text-secondary)', text: 'var(--surface-elevated)', label: 'NEUTRAL' },
  cool: { bg: 'var(--info)', text: 'var(--surface-elevated)', label: 'COOL' },
  soft: { bg: '#8b5cf6', text: 'var(--surface-elevated)', label: 'SOFT' },
};

interface PlatformStats {
  platform: string;
  active_auctions: number;
  avg_bids: number;
  avg_current_price: number;
}

interface HourlyDistribution { hour: number; endings: number; }
interface WeeklyPrice { week: string; avg_price: number; sales_count: number; }
interface TierData { tier: number; auction_count: number; avg_bids: number; avg_final_price: number; weight: number; }
interface PlatformPerf { platform: string; sold: number; total: number; sell_through_pct: number; avg_hammer: number; }
interface SegmentLeader { make: string; auctions: number; sold: number; sell_through_pct: number; avg_price: number; }
interface PriceBand { band: string; band_order: number; sales: number; avg_price: number; }
interface SupplyDemandWeek { week: string; new_listings: number; completions: number; }
interface BidDepthBand { depth: string; depth_order: number; auctions: number; avg_hammer: number; pct: number; }

interface AuctionTrendsData {
  generated_at: string;
  lookback_days: number;
  source_leaderboard: PlatformStats[];
  daily_activity_by_platform: Record<string, Array<{ day: string; count: number }>>;
  market_sentiment: {
    score: number;
    label: string;
    components: {
      bid_ratio: number; bid_score: number;
      sell_through_rate: number; sell_score: number;
      price_direction: number; price_score: number;
    };
    current_metrics: {
      avg_bids: number; historical_avg_bids: number;
      sold_count: number; unsold_count: number;
    };
    weekly_price_trend: WeeklyPrice[];
  };
  daily_activity: {
    hourly_distribution: HourlyDistribution[];
    peak_hours: number[];
    total_recent_endings: number;
  };
  tier_weighted_data: TierData[];
  platform_performance: PlatformPerf[];
  segment_leaders: SegmentLeader[];
  price_distribution: PriceBand[];
  estimate_accuracy: {
    compared: number;
    avg_hammer_pct_of_estimate: number;
    avg_error_pct: number;
    over_estimate_pct: number;
  };
  supply_demand: SupplyDemandWeek[];
  bid_depth: BidDepthBand[];
  comment_mood: {
    n: number;
    positive_pct: number;
    mixed_pct: number;
    negative_pct: number;
    avg_score: number;
    sold_avg_score: number;
    unsold_avg_score: number;
    avg_comments_sold: number;
    avg_comments_unsold: number;
  };
  market_quality: {
    total_sold: number;
    pct_competitive: number;
    pct_deep: number;
    weighted_avg_price: number;
    raw_avg_price: number;
    confidence: 'high' | 'moderate' | 'low';
  };
}

export default function AuctionTrendsDashboard() {
  const [data, setData] = useState<AuctionTrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('auction-trends-stats');
      if (fnError) throw fnError;
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load auction trends');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(Math.round(n));
  };

  const formatPrice = (n: number) => {
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
    return '$' + String(Math.round(n));
  };

  const formatHour = (hour: number) => {
    const h = hour % 12 || 12;
    return `${h}${hour < 12 ? 'AM' : 'PM'}`;
  };

  const maxActiveAuctions = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.source_leaderboard.map(p => p.active_auctions), 1);
  }, [data]);

  const maxHourlyEndings = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.daily_activity.hourly_distribution.map(h => h.endings), 1);
  }, [data]);

  const platformName = (slug: string) => PLATFORM_DISPLAY[slug]?.name || slug;
  const platformColor = (slug: string) => PLATFORM_DISPLAY[slug]?.color || '#888';

  // === SUB-COMPONENTS ===

  const SentimentGauge = ({ score, label }: { score: number; label: string }) => {
    const cfg = SENTIMENT_COLORS[label] || SENTIMENT_COLORS.neutral;
    const rotation = (score / 100) * 180 - 90;
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', width: '180px', height: '100px', margin: '0 auto', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '90px', background: 'var(--surface-hover)', opacity: 0.3 }} />
          <div style={{ position: 'absolute', bottom: '0', left: '50%', width: '4px', height: '80px', background: cfg.bg, transformOrigin: 'bottom center', transform: `translateX(-50%) rotate(${rotation}deg)`, transition: 'transform 0.5s ease-out' }} />
          <div style={{ position: 'absolute', bottom: '-8px', left: '50%', width: '20px', height: '20px', background: cfg.bg, transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ marginTop: 'var(--space-2)', padding: '4px 12px', background: cfg.bg, color: cfg.text, display: 'inline-block', fontSize: '11px', fontWeight: 700 }}>
          {cfg.label} ({score})
        </div>
      </div>
    );
  };

  const PriceTrendChart = () => {
    if (!data || !data.market_sentiment.weekly_price_trend.length) return null;
    const prices = data.market_sentiment.weekly_price_trend;
    const maxP = Math.max(...prices.map(p => p.avg_price), 1);
    const minP = Math.min(...prices.map(p => p.avg_price));
    const range = maxP - minP || 1;
    const W = 100, H = 40;
    const points = [...prices].reverse().map((p, i) => {
      const x = (i / (prices.length - 1 || 1)) * W;
      const y = H - ((p.avg_price - minP) / range) * H;
      return `${x},${y}`;
    });
    const dir = data.market_sentiment.components.price_direction;
    const color = dir >= 0 ? '#10ac84' : '#ee5a24';
    return (
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '60px' }}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`M 0,${H} L ${points.join(' L ')} L ${W},${H} Z`} fill="url(#priceGradient)" />
          <path d={`M ${points.join(' L ')}`} fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)' }}>
          <span>{prices[prices.length - 1]?.week?.slice(5) || ''}</span>
          <span style={{ color, fontWeight: 600 }}>{dir >= 0 ? '+' : ''}{dir.toFixed(1)}%</span>
          <span>{prices[0]?.week?.slice(5) || ''}</span>
        </div>
      </div>
    );
  };

  const PlatformActivityChart = () => {
    if (!data) return null;
    const allDays = new Set<string>();
    const platforms = Object.keys(data.daily_activity_by_platform);
    platforms.forEach(p => data.daily_activity_by_platform[p].forEach(d => allDays.add(d.day)));
    const sortedDays = [...allDays].sort().slice(-14);
    if (!sortedDays.length) return null;
    const W = 100, H = 60;
    const maxCount = Math.max(...platforms.flatMap(p => data.daily_activity_by_platform[p].filter(d => sortedDays.includes(d.day)).map(d => d.count)), 1);
    const paths: Array<{ platform: string; path: string; color: string }> = [];
    platforms.slice(0, 5).forEach(platform => {
      const dayMap = new Map(data.daily_activity_by_platform[platform].map(d => [d.day, d.count]));
      const pts = sortedDays.map((day, idx) => {
        const x = (idx / (sortedDays.length - 1 || 1)) * W;
        const y = H - ((dayMap.get(day) || 0) / maxCount) * H;
        return `${x},${y}`;
      });
      paths.push({ platform, path: `M ${pts.join(' L ')}`, color: platformColor(platform) });
    });
    return (
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '120px' }}>
          {paths.map(({ platform, path, color }) => (
            <path key={platform} d={path} fill="none" stroke={color} strokeWidth="1.5"
              opacity={selectedPlatform === null || selectedPlatform === platform ? 1 : 0.2}
              style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
              onMouseEnter={() => setSelectedPlatform(platform)}
              onMouseLeave={() => setSelectedPlatform(null)} />
          ))}
        </svg>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          {paths.map(({ platform, color }) => (
            <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer', opacity: selectedPlatform === null || selectedPlatform === platform ? 1 : 0.4 }}
              onMouseEnter={() => setSelectedPlatform(platform)} onMouseLeave={() => setSelectedPlatform(null)}>
              <div style={{ width: '12px', height: '3px', background: color }} />
              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{platformName(platform).split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const HourlyActivityChart = () => {
    if (!data) return null;
    const { hourly_distribution, peak_hours } = data.daily_activity;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: '80px', gap: '2px' }}>
          {hourly_distribution.map(({ hour, endings }) => (
            <div key={hour} style={{
              flex: 1, height: `${Math.max((endings / maxHourlyEndings) * 100, 2)}%`,
              background: peak_hours.includes(hour) ? 'var(--error)' : 'var(--grey-300)',
              transition: 'height 0.3s ease',
            }} title={`${formatHour(hour)}: ${endings} auctions ending`} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
          {['12AM', '6AM', '12PM', '6PM', '12AM'].map(l => (
            <span key={l} style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{l}</span>
          ))}
        </div>
        <div style={{ marginTop: 'var(--space-2)', fontSize: '11px', color: 'var(--text-muted)' }}>
          Peak hours: {peak_hours.map(h => formatHour(h)).join(', ')} (UTC)
        </div>
      </div>
    );
  };

  // === DEPTH SECTIONS ===

  const PlatformPerformanceSection = () => {
    if (!data?.platform_performance?.length) return null;
    const maxTotal = Math.max(...data.platform_performance.map(p => p.total), 1);
    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
          Platform Sell-Through (30d)
        </div>
        {data.platform_performance.map(p => (
          <div key={p.platform} style={{ marginBottom: 'var(--space-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
              <span style={{ color: 'var(--text-muted)' }}>{platformName(p.platform)}</span>
              <span>
                <span style={{ fontWeight: 600, color: p.sell_through_pct >= 60 ? 'var(--success)' : p.sell_through_pct >= 40 ? 'var(--text)' : 'var(--error)' }}>
                  {p.sell_through_pct}%
                </span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--space-2)', fontSize: '9px' }}>
                  {p.sold}/{p.total} sold{p.avg_hammer > 0 ? ` · ${formatPrice(p.avg_hammer)} avg` : ''}
                </span>
              </span>
            </div>
            <div style={{ height: '4px', background: 'var(--grey-100)', overflow: 'hidden', position: 'relative' }}>
              <div style={{ height: '100%', width: `${(p.total / maxTotal) * 100}%`, background: 'var(--grey-300)' }} />
              <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${(p.sold / maxTotal) * 100}%`, background: platformColor(p.platform) }} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const SegmentLeadersSection = () => {
    if (!data?.segment_leaders?.length) return null;
    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
          Segment Leaders (30d)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '2px 8px', fontSize: '9px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-muted)', paddingBottom: 'var(--space-1)' }}>MAKE</span>
          <span style={{ fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>AUCTIONS</span>
          <span style={{ fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>SELL%</span>
          <span style={{ fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>AVG $</span>
          <span style={{ fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>SOLD</span>
          {data.segment_leaders.slice(0, 10).map((s: SegmentLeader & { density?: string }) => (
            <React.Fragment key={s.make}>
              <span style={{ color: 'var(--text)' }}>
                {s.make}
                {s.density && <span style={{ marginLeft: 'var(--space-1)', fontSize: '8px', color: s.density === 'deep' ? 'var(--success)' : s.density === 'moderate' ? 'var(--text-muted)' : 'var(--error)', fontWeight: 400 }}>
                  {s.density === 'sparse' ? '(sparse)' : ''}
                </span>}
              </span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{s.auctions}</span>
              <span style={{ textAlign: 'right', fontWeight: 600, color: s.sell_through_pct >= 60 ? 'var(--success)' : s.sell_through_pct >= 40 ? 'var(--text)' : 'var(--error)' }}>
                {s.sell_through_pct}%
              </span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatPrice(s.avg_price)}</span>
              <span style={{ textAlign: 'right', color: 'var(--text)' }}>{s.sold}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const PriceDistributionSection = () => {
    if (!data?.price_distribution?.length) return null;
    const maxSales = Math.max(...data.price_distribution.map(b => b.sales), 1);
    const totalSales = data.price_distribution.reduce((s, b) => s + b.sales, 0);
    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
          Price Distribution (30d sold)
        </div>
        {data.price_distribution.map(b => {
          const pct = totalSales > 0 ? Math.round((b.sales / totalSales) * 100) : 0;
          return (
            <div key={b.band} style={{ marginBottom: 'var(--space-1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '2px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{b.band}</span>
                <span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{b.sales}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--space-1)' }}>({pct}%)</span>
                </span>
              </div>
              <div style={{ height: '4px', background: 'var(--grey-100)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(b.sales / maxSales) * 100}%`, background: 'var(--text)', transition: 'width 0.3s' }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const EstimateAccuracySection = () => {
    if (!data?.estimate_accuracy?.compared) return null;
    const ea = data.estimate_accuracy;
    const hammerPct = ea.avg_hammer_pct_of_estimate;
    const bias = hammerPct > 100 ? 'under-estimating' : hammerPct < 100 ? 'over-estimating' : 'calibrated';
    const biasColor = hammerPct > 110 ? 'var(--error)' : hammerPct > 100 ? 'var(--orange)' : hammerPct >= 90 ? 'var(--success)' : 'var(--info)';
    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
          Estimate vs Hammer (30d)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', fontSize: '9px' }}>
          <div style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Compared</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '12px' }}>{formatNumber(ea.compared)}</div>
          </div>
          <div style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Hammer/Est</div>
            <div style={{ fontWeight: 600, color: biasColor, fontSize: '12px' }}>{hammerPct}%</div>
          </div>
          <div style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Avg Error</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '12px' }}>{ea.avg_error_pct}%</div>
          </div>
          <div style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Beat Est</div>
            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '12px' }}>{ea.over_estimate_pct}%</div>
          </div>
        </div>
        <div style={{ marginTop: 'var(--space-1)', fontSize: '9px', color: 'var(--text-muted)' }}>
          Nuke estimates are {bias} (hammer = {hammerPct}% of estimate on {ea.compared} auctions)
        </div>
      </div>
    );
  };

  const SupplyDemandChart = () => {
    if (!data?.supply_demand?.length || data.supply_demand.length < 2) return null;
    const weeks = data.supply_demand;
    const maxVal = Math.max(...weeks.flatMap(w => [w.new_listings, w.completions]), 1);
    const W = 100, H = 40;
    const supplyPts = weeks.map((w, i) => `${(i / (weeks.length - 1 || 1)) * W},${H - (w.new_listings / maxVal) * H}`);
    const demandPts = weeks.map((w, i) => `${(i / (weeks.length - 1 || 1)) * W},${H - (w.completions / maxVal) * H}`);
    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
          Supply vs Demand (weekly)
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '80px' }}>
          <path d={`M ${supplyPts.join(' L ')}`} fill="none" stroke="#00d4ff" strokeWidth="1.5" />
          <path d={`M ${demandPts.join(' L ')}`} fill="none" stroke="#ee5a24" strokeWidth="1.5" />
        </svg>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-1)', fontSize: '9px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <div style={{ width: '12px', height: '3px', background: '#00d4ff' }} />
            <span style={{ color: 'var(--text-muted)' }}>New Listings</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <div style={{ width: '12px', height: '3px', background: '#ee5a24' }} />
            <span style={{ color: 'var(--text-muted)' }}>Completions</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
          <span>{weeks[0]?.week?.slice(5)}</span>
          <span>{weeks[weeks.length - 1]?.week?.slice(5)}</span>
        </div>
      </div>
    );
  };

  // === LIBRARY-GUIDED: BID DEPTH (Competitive Bidder Threshold) ===

  const BidDepthSection = () => {
    if (!data?.bid_depth?.length) return null;
    const maxAuctions = Math.max(...data.bid_depth.map(b => b.auctions), 1);
    const depthColors: Record<number, string> = { 1: 'var(--error)', 2: 'var(--orange)', 3: 'var(--text)', 4: 'var(--success)', 5: '#10ac84' };
    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: '2px' }}>
          Auction Quality (bid depth)
        </div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          Prices from thin auctions (&lt;4 bidders) are unreliable market signals
        </div>
        {data.bid_depth.map(b => (
          <div key={b.depth} style={{ marginBottom: 'var(--space-1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', marginBottom: '2px' }}>
              <span style={{ color: 'var(--text-muted)' }}>{b.depth}</span>
              <span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{b.auctions}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--space-1)' }}>({b.pct}%)</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--space-2)' }}>{formatPrice(b.avg_hammer)}</span>
              </span>
            </div>
            <div style={{ height: '4px', background: 'var(--grey-100)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(b.auctions / maxAuctions) * 100}%`, background: depthColors[b.depth_order] || 'var(--text)', transition: 'width 0.3s' }} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // === LIBRARY-GUIDED: COMMENT MOOD (Comments predict price) ===

  const CommentMoodSection = () => {
    if (!data?.comment_mood?.n || data.comment_mood.n < 3) return null;
    const cm = data.comment_mood;
    const moodColor = cm.avg_score >= 0.6 ? 'var(--success)' : cm.avg_score >= 0.3 ? 'var(--orange)' : 'var(--error)';
    const moodLabel = cm.avg_score >= 0.6 ? 'BULLISH' : cm.avg_score >= 0.3 ? 'MIXED' : 'BEARISH';
    return (
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: '2px' }}>
          Comment Thread Mood
        </div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          From {cm.n} auctions with AI-analyzed comment threads
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ padding: '4px 8px', background: moodColor, color: 'var(--surface-elevated)', fontSize: '11px', fontWeight: 700 }}>
            {moodLabel}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
            Score: {cm.avg_score} / 1.0
          </div>
        </div>
        <div style={{ marginTop: 'var(--space-2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', fontSize: '9px' }}>
          <div style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Sold auctions</div>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>
              {cm.sold_avg_score} sentiment · {cm.avg_comments_sold} avg comments
            </div>
          </div>
          <div style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)' }}>
            <div style={{ color: 'var(--text-muted)' }}>Unsold auctions</div>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>
              {cm.unsold_avg_score} sentiment · {cm.avg_comments_unsold} avg comments
            </div>
          </div>
        </div>
        <div style={{ marginTop: 'var(--space-1)', height: '4px', display: 'flex', overflow: 'hidden', background: 'var(--grey-100)' }}>
          <div style={{ width: `${cm.positive_pct}%`, background: 'var(--success)' }} title={`Positive: ${cm.positive_pct}%`} />
          <div style={{ width: `${cm.mixed_pct}%`, background: 'var(--orange)' }} title={`Mixed: ${cm.mixed_pct}%`} />
          <div style={{ width: `${cm.negative_pct}%`, background: 'var(--error)' }} title={`Negative: ${cm.negative_pct}%`} />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '2px', fontSize: '9px', color: 'var(--text-muted)' }}>
          <span>{cm.positive_pct}% positive</span>
          <span>{cm.mixed_pct}% mixed</span>
          <span>{cm.negative_pct}% negative/neutral</span>
        </div>
      </div>
    );
  };

  // === LIBRARY-GUIDED: MARKET QUALITY (Epistemic honesty) ===

  const MarketQualityBadge = () => {
    if (!data?.market_quality?.total_sold) return null;
    const mq = data.market_quality;
    const confColor = mq.confidence === 'high' ? 'var(--success)' : mq.confidence === 'moderate' ? 'var(--orange)' : 'var(--error)';
    const priceDelta = mq.weighted_avg_price - mq.raw_avg_price;
    const priceDeltaPct = mq.raw_avg_price > 0 ? ((priceDelta / mq.raw_avg_price) * 100).toFixed(1) : '0';
    return (
      <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)', fontSize: '9px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>DATA QUALITY: </span>
            <span style={{ fontWeight: 700, color: confColor, textTransform: 'uppercase' }}>{mq.confidence}</span>
          </div>
          <span style={{ color: 'var(--text-muted)' }}>
            N={mq.total_sold} sold · {mq.pct_competitive}% have 4+ bidders · {mq.pct_deep}% have 25+
          </span>
        </div>
        <div style={{ marginTop: 'var(--space-1)', color: 'var(--text-muted)' }}>
          CBT-weighted avg: {formatPrice(mq.weighted_avg_price)} · Raw avg: {formatPrice(mq.raw_avg_price)}
          <span style={{ marginLeft: 'var(--space-1)', color: priceDelta >= 0 ? 'var(--success)' : 'var(--error)' }}>
            ({priceDelta >= 0 ? '+' : ''}{priceDeltaPct}% weighting effect)
          </span>
        </div>
      </div>
    );
  };

  // === MAIN RENDER ===

  return (
    <div style={{ border: '2px solid var(--border-light)', backgroundColor: 'var(--white)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>Auction Trends</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            Market intelligence — auction platforms only
          </div>
        </div>
        <button className="button button-secondary" onClick={() => void loadData()} disabled={loading} style={{ fontSize: '11px' }}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ marginTop: 'var(--space-3)', fontSize: '11px', color: 'var(--error)' }}>{error}</div>}

      {data && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          {/* Data Quality Badge (Library: epistemic honesty) */}
          <MarketQualityBadge />

          {/* Row 1: Sentiment + Price Trend */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>Market Sentiment</div>
              <SentimentGauge score={data.market_sentiment.score} label={data.market_sentiment.label} />
              <div style={{ marginTop: 'var(--space-3)', fontSize: '9px', color: 'var(--text-muted)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-1)' }}>
                  <span>Bid Activity:</span>
                  <span style={{ fontWeight: 600 }}>{data.market_sentiment.components.bid_ratio}x baseline</span>
                  <span>Sell-through:</span>
                  <span style={{ fontWeight: 600 }}>{data.market_sentiment.components.sell_through_rate}%</span>
                  <span>Price Trend:</span>
                  <span style={{ fontWeight: 600, color: data.market_sentiment.components.price_direction >= 0 ? 'var(--success)' : 'var(--error)' }}>
                    {data.market_sentiment.components.price_direction >= 0 ? '+' : ''}{data.market_sentiment.components.price_direction}%
                  </span>
                </div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>Weekly Sale Price Trend</div>
              <PriceTrendChart />
              <div style={{ marginTop: 'var(--space-2)', fontSize: '9px', color: 'var(--text-muted)' }}>
                Latest week: {formatPrice(data.market_sentiment.weekly_price_trend[0]?.avg_price || 0)}
                <span style={{ marginLeft: 'var(--space-2)' }}>({data.market_sentiment.weekly_price_trend[0]?.sales_count || 0} sales)</span>
              </div>
            </div>
          </div>

          {/* Row 2: Leaderboard + Platform Sell-Through */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
                Live Auctions
              </div>
              {data.source_leaderboard.slice(0, 6).map(platform => (
                <div key={platform.platform} style={{ marginBottom: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{platformName(platform.platform)}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {formatNumber(platform.active_auctions)}
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 'var(--space-1)' }}>({platform.avg_bids} avg bids)</span>
                    </span>
                  </div>
                  <div style={{ height: '4px', backgroundColor: 'var(--grey-100)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(platform.active_auctions / maxActiveAuctions) * 100}%`, backgroundColor: platformColor(platform.platform), transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
            </div>
            <PlatformPerformanceSection />
          </div>

          {/* Row 3: Segments + Price Distribution */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
            <SegmentLeadersSection />
            <PriceDistributionSection />
          </div>

          {/* Row 4: Bid Depth + Comment Mood (Library: CBT + comments predict price) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
            <BidDepthSection />
            <CommentMoodSection />
          </div>

          {/* Row 5: Estimate Accuracy + Supply/Demand */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
            <EstimateAccuracySection />
            <SupplyDemandChart />
          </div>

          {/* Row 5: Activity Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>New Listings by Platform (14d)</div>
              <PlatformActivityChart />
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>Auction Endings by Hour</div>
              <HourlyActivityChart />
            </div>
          </div>

          {/* Tier Data (if available) */}
          {data.tier_weighted_data.length > 0 && (
            <div style={{ paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>S-Tier Quality Weighting</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                {data.tier_weighted_data.map(tier => (
                  <div key={tier.tier} style={{ padding: 'var(--space-2)', background: 'var(--grey-50)', border: '1px solid var(--border-light)', fontSize: '9px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>Tier {tier.tier} ({tier.weight}x)</div>
                    <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>{tier.auction_count} auctions</div>
                    <div style={{ color: 'var(--text-muted)' }}>{tier.avg_bids} avg bids</div>
                    <div style={{ color: 'var(--text-muted)' }}>{formatPrice(tier.avg_final_price)} avg</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Metrics */}
          <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-light)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', fontSize: '9px' }}>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Recent Avg Bids</div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{data.market_sentiment.current_metrics.avg_bids}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Historical Avg</div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{data.market_sentiment.current_metrics.historical_avg_bids}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Sold (30d)</div>
              <div style={{ fontWeight: 600, color: 'var(--success)' }}>{formatNumber(data.market_sentiment.current_metrics.sold_count)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Unsold (30d)</div>
              <div style={{ fontWeight: 600, color: 'var(--error)' }}>{formatNumber(data.market_sentiment.current_metrics.unsold_count)}</div>
            </div>
          </div>

          {data.generated_at && (
            <div style={{ marginTop: 'var(--space-3)', fontSize: '9px', color: 'var(--text-muted)', textAlign: 'right' }}>
              Updated: {new Date(data.generated_at).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
