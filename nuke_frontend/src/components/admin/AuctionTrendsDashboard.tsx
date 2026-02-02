import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

// Platform display names and colors
const PLATFORM_DISPLAY: Record<string, { name: string; color: string }> = {
  bat: { name: 'Bring a Trailer', color: '#ff6b6b' },
  pcarmarket: { name: 'PCarMarket', color: '#00d4ff' },
  cars_and_bids: { name: 'Cars & Bids', color: '#ffd93d' },
  collecting_cars: { name: 'Collecting Cars', color: '#6bcb77' },
  broad_arrow: { name: 'Broad Arrow', color: '#c77dff' },
  rmsothebys: { name: "RM Sotheby's", color: '#ff9f43' },
  gooding: { name: 'Gooding & Co', color: '#ee5a24' },
  mecum: { name: 'Mecum', color: '#0abde3' },
  hagerty: { name: 'Hagerty', color: '#10ac84' },
  sbx: { name: 'SBX', color: '#5f27cd' },
};

// Sentiment colors
const SENTIMENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  hot: { bg: '#dc2626', text: '#ffffff', label: 'HOT' },
  warm: { bg: '#f97316', text: '#ffffff', label: 'WARM' },
  neutral: { bg: '#6b7280', text: '#ffffff', label: 'NEUTRAL' },
  cool: { bg: '#3b82f6', text: '#ffffff', label: 'COOL' },
  soft: { bg: '#8b5cf6', text: '#ffffff', label: 'SOFT' },
};

interface PlatformStats {
  platform: string;
  active_auctions: number;
  avg_bids: number;
  avg_current_bid: number;
}

interface HourlyDistribution {
  hour: number;
  endings: number;
}

interface WeeklyPrice {
  week: string;
  avg_price: number;
  sales_count: number;
}

interface TierData {
  tier: number;
  auction_count: number;
  avg_bids: number;
  avg_final_price: number;
  weight: number;
}

interface AuctionTrendsData {
  generated_at: string;
  lookback_days: number;
  source_leaderboard: PlatformStats[];
  daily_activity_by_platform: Record<string, Array<{ day: string; count: number }>>;
  market_sentiment: {
    score: number;
    label: string;
    components: {
      bid_ratio: number;
      bid_score: number;
      sell_through_rate: number;
      sell_score: number;
      price_direction: number;
      price_score: number;
    };
    current_metrics: {
      avg_bids: number;
      historical_avg_bids: number;
      tier_weighted_avg_bids: number;
      sold_count: number;
      unsold_count: number;
    };
    weekly_price_trend: WeeklyPrice[];
  };
  daily_activity: {
    hourly_distribution: HourlyDistribution[];
    peak_hours: number[];
    total_recent_endings: number;
  };
  tier_weighted_data: TierData[];
}

export default function AuctionTrendsDashboard() {
  const [data, setData] = useState<AuctionTrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('auction-trends-stats');
      if (fnError) throw fnError;
      setData(result);
    } catch (e: any) {
      setError(e?.message || 'Failed to load auction trends');
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
    const ampm = hour < 12 ? 'AM' : 'PM';
    return `${h}${ampm}`;
  };

  // Calculate max values for bars
  const maxActiveAuctions = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.source_leaderboard.map(p => p.active_auctions), 1);
  }, [data]);

  const maxHourlyEndings = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.daily_activity.hourly_distribution.map(h => h.endings), 1);
  }, [data]);

  // Sentiment gauge component
  const SentimentGauge = ({ score, label }: { score: number; label: string }) => {
    const sentimentConfig = SENTIMENT_COLORS[label] || SENTIMENT_COLORS.neutral;
    const rotation = (score / 100) * 180 - 90; // -90 to 90 degrees

    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          position: 'relative',
          width: '180px',
          height: '100px',
          margin: '0 auto',
          overflow: 'hidden',
        }}>
          {/* Gauge background */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '90px',
            borderRadius: '90px 90px 0 0',
            background: 'linear-gradient(90deg, #8b5cf6 0%, #3b82f6 25%, #6b7280 50%, #f97316 75%, #dc2626 100%)',
            opacity: 0.3,
          }} />
          {/* Needle */}
          <div style={{
            position: 'absolute',
            bottom: '0',
            left: '50%',
            width: '4px',
            height: '80px',
            background: sentimentConfig.bg,
            transformOrigin: 'bottom center',
            transform: `translateX(-50%) rotate(${rotation}deg)`,
            transition: 'transform 0.5s ease-out',
            borderRadius: '2px',
          }} />
          {/* Center dot */}
          <div style={{
            position: 'absolute',
            bottom: '-10px',
            left: '50%',
            width: '20px',
            height: '20px',
            background: sentimentConfig.bg,
            borderRadius: '50%',
            transform: 'translateX(-50%)',
          }} />
        </div>
        <div style={{
          marginTop: 'var(--space-2)',
          padding: '4px 12px',
          background: sentimentConfig.bg,
          color: sentimentConfig.text,
          borderRadius: '4px',
          display: 'inline-block',
          fontSize: '10pt',
          fontWeight: 700,
        }}>
          {sentimentConfig.label} ({score})
        </div>
      </div>
    );
  };

  // Line chart for platform activity over time
  const PlatformActivityChart = () => {
    if (!data) return null;

    // Get all unique days and platforms
    const allDays = new Set<string>();
    const platforms = Object.keys(data.daily_activity_by_platform);

    platforms.forEach(platform => {
      data.daily_activity_by_platform[platform].forEach(d => allDays.add(d.day));
    });

    const sortedDays = [...allDays].sort().slice(-14); // Last 14 days
    if (sortedDays.length === 0) return null;

    // Prepare data points
    const chartWidth = 100;
    const chartHeight = 60;
    const maxCount = Math.max(
      ...platforms.flatMap(p =>
        data.daily_activity_by_platform[p]
          .filter(d => sortedDays.includes(d.day))
          .map(d => d.count)
      ),
      1
    );

    // Create paths for each platform
    const paths: Array<{ platform: string; path: string; color: string }> = [];

    platforms.slice(0, 5).forEach(platform => { // Top 5 platforms only
      const dayData = data.daily_activity_by_platform[platform];
      const dayMap = new Map(dayData.map(d => [d.day, d.count]));

      const points = sortedDays.map((day, idx) => {
        const x = (idx / (sortedDays.length - 1)) * chartWidth;
        const count = dayMap.get(day) || 0;
        const y = chartHeight - (count / maxCount) * chartHeight;
        return `${x},${y}`;
      });

      const platformConfig = PLATFORM_DISPLAY[platform] || { name: platform, color: '#888' };
      paths.push({
        platform,
        path: `M ${points.join(' L ')}`,
        color: platformConfig.color,
      });
    });

    return (
      <div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: '120px' }}>
          {paths.map(({ platform, path, color }) => (
            <path
              key={platform}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              opacity={selectedPlatform === null || selectedPlatform === platform ? 1 : 0.2}
              style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
              onMouseEnter={() => setSelectedPlatform(platform)}
              onMouseLeave={() => setSelectedPlatform(null)}
            />
          ))}
        </svg>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: 'var(--space-2)' }}>
          {paths.map(({ platform, color }) => (
            <div
              key={platform}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                opacity: selectedPlatform === null || selectedPlatform === platform ? 1 : 0.4,
              }}
              onMouseEnter={() => setSelectedPlatform(platform)}
              onMouseLeave={() => setSelectedPlatform(null)}
            >
              <div style={{ width: '12px', height: '3px', background: color }} />
              <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                {(PLATFORM_DISPLAY[platform]?.name || platform).split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Hourly activity bar chart
  const HourlyActivityChart = () => {
    if (!data) return null;

    const { hourly_distribution, peak_hours } = data.daily_activity;

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: '80px', gap: '2px' }}>
          {hourly_distribution.map(({ hour, endings }) => {
            const isPeak = peak_hours.includes(hour);
            const height = (endings / maxHourlyEndings) * 100;
            return (
              <div
                key={hour}
                style={{
                  flex: 1,
                  height: `${Math.max(height, 2)}%`,
                  background: isPeak ? '#ff6b6b' : 'var(--grey-300)',
                  borderRadius: '2px 2px 0 0',
                  transition: 'height 0.3s ease',
                }}
                title={`${formatHour(hour)}: ${endings} auctions ending`}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
          <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>12AM</span>
          <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>6AM</span>
          <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>12PM</span>
          <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>6PM</span>
          <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>12AM</span>
        </div>
        <div style={{ marginTop: 'var(--space-2)', fontSize: '8pt', color: 'var(--text-muted)' }}>
          Peak hours: {peak_hours.map(h => formatHour(h)).join(', ')} (UTC)
        </div>
      </div>
    );
  };

  // Weekly price trend mini chart
  const PriceTrendChart = () => {
    if (!data || !data.market_sentiment.weekly_price_trend.length) return null;

    const prices = data.market_sentiment.weekly_price_trend;
    const maxPrice = Math.max(...prices.map(p => p.avg_price), 1);
    const minPrice = Math.min(...prices.map(p => p.avg_price));
    const range = maxPrice - minPrice || 1;

    const chartWidth = 100;
    const chartHeight = 40;

    const points = [...prices].reverse().map((p, idx) => {
      const x = (idx / (prices.length - 1)) * chartWidth;
      const y = chartHeight - ((p.avg_price - minPrice) / range) * chartHeight;
      return `${x},${y}`;
    });

    const priceDirection = data.market_sentiment.components.price_direction;
    const color = priceDirection >= 0 ? '#10ac84' : '#ee5a24';

    return (
      <div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: '60px' }}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`M 0,${chartHeight} L ${points.join(' L ')} L ${chartWidth},${chartHeight} Z`}
            fill="url(#priceGradient)"
          />
          <path
            d={`M ${points.join(' L ')}`}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
          />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7pt', color: 'var(--text-muted)' }}>
          <span>{prices[prices.length - 1]?.week?.slice(5) || ''}</span>
          <span style={{ color, fontWeight: 600 }}>
            {priceDirection >= 0 ? '+' : ''}{priceDirection.toFixed(1)}%
          </span>
          <span>{prices[0]?.week?.slice(5) || ''}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      borderRadius: '0px',
      border: '2px solid var(--border-light)',
      backgroundColor: 'var(--white)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Auction Trends</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            Market sentiment & platform activity
          </div>
        </div>
        <button
          className="button button-secondary"
          onClick={() => void loadData()}
          disabled={loading}
          style={{ fontSize: '8pt' }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 'var(--space-3)', fontSize: '8pt', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {data && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          {/* Market Sentiment - Top Section */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            paddingBottom: 'var(--space-4)',
            borderBottom: '1px solid var(--border-light)',
          }}>
            {/* Sentiment Gauge */}
            <div>
              <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
                Market Sentiment
              </div>
              <SentimentGauge score={data.market_sentiment.score} label={data.market_sentiment.label} />
              <div style={{ marginTop: 'var(--space-3)', fontSize: '7pt', color: 'var(--text-muted)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                  <span>Bid Activity:</span>
                  <span style={{ fontWeight: 600 }}>{data.market_sentiment.components.bid_ratio}x baseline</span>
                  <span>Sell-through:</span>
                  <span style={{ fontWeight: 600 }}>{data.market_sentiment.components.sell_through_rate}%</span>
                  <span>Price Trend:</span>
                  <span style={{ fontWeight: 600, color: data.market_sentiment.components.price_direction >= 0 ? '#10ac84' : '#ee5a24' }}>
                    {data.market_sentiment.components.price_direction >= 0 ? '+' : ''}
                    {data.market_sentiment.components.price_direction}%
                  </span>
                </div>
              </div>
            </div>

            {/* Price Trend */}
            <div>
              <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
                Weekly Average Sale Price
              </div>
              <PriceTrendChart />
              <div style={{ marginTop: 'var(--space-2)', fontSize: '7pt', color: 'var(--text-muted)' }}>
                Current avg: {formatPrice(data.market_sentiment.weekly_price_trend[0]?.avg_price || 0)}
                <span style={{ marginLeft: '8px' }}>
                  ({data.market_sentiment.weekly_price_trend[0]?.sales_count || 0} sales)
                </span>
              </div>
            </div>
          </div>

          {/* Source Leaderboard */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
              Source Leaderboard - Live Auctions
            </div>
            {data.source_leaderboard.slice(0, 6).map((platform) => {
              const config = PLATFORM_DISPLAY[platform.platform] || { name: platform.platform, color: '#888' };
              return (
                <div key={platform.platform} style={{ marginBottom: 'var(--space-2)' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '8pt',
                    marginBottom: '2px',
                  }}>
                    <span style={{ color: 'var(--text-muted)' }}>{config.name}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {formatNumber(platform.active_auctions)}
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '4px' }}>
                        ({platform.avg_bids} avg bids)
                      </span>
                    </span>
                  </div>
                  <div style={{
                    height: '6px',
                    backgroundColor: 'var(--grey-100)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${(platform.active_auctions / maxActiveAuctions) * 100}%`,
                      backgroundColor: config.color,
                      borderRadius: '3px',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Platform Activity Over Time */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
              New Listings by Platform (14 days)
            </div>
            <PlatformActivityChart />
          </div>

          {/* Hourly Activity */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
              Daily Activity - Auction Endings by Hour
            </div>
            <HourlyActivityChart />
          </div>

          {/* Tier-Weighted Data */}
          {data.tier_weighted_data.length > 0 && (
            <div style={{
              paddingTop: 'var(--space-3)',
              borderTop: '1px solid var(--border-light)',
            }}>
              <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
                S-Tier Quality Weighting
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                {data.tier_weighted_data.map((tier) => (
                  <div
                    key={tier.tier}
                    style={{
                      padding: 'var(--space-2)',
                      background: 'var(--grey-50)',
                      border: '1px solid var(--border-light)',
                      fontSize: '7pt',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                      Tier {tier.tier} ({tier.weight}x)
                    </div>
                    <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                      {tier.auction_count} auctions
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      {tier.avg_bids} avg bids
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      {formatPrice(tier.avg_final_price)} avg
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Current Metrics Summary */}
          <div style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--border-light)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'var(--space-2)',
            fontSize: '7pt',
          }}>
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
              <div style={{ fontWeight: 600, color: '#10ac84' }}>{formatNumber(data.market_sentiment.current_metrics.sold_count)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Unsold (30d)</div>
              <div style={{ fontWeight: 600, color: '#ee5a24' }}>{formatNumber(data.market_sentiment.current_metrics.unsold_count)}</div>
            </div>
          </div>

          {data.generated_at && (
            <div style={{
              marginTop: 'var(--space-3)',
              fontSize: '7pt',
              color: 'var(--text-muted)',
              textAlign: 'right',
            }}>
              Updated: {new Date(data.generated_at).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
