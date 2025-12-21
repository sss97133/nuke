import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface LeaderboardEntry {
  user_id: string;
  username: string | null;
  rank: number;
  daily_gain_loss: number;
  daily_gain_loss_pct: number;
  portfolio_value: number;
  trades_today: number;
  win_rate: number;
  consecutive_profitable_days: number;
  total_trades: number;
  lifetime_gain_loss: number;
  badges: string[];
}

interface TradingStats {
  user_rank: number | null;
  user_stats: LeaderboardEntry | null;
  portfolio_change_today: number;
  total_users_trading: number;
}

const formatUSD = (value: number) =>
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

const getRankEmoji = (rank: number) => {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  if (rank <= 10) return '🔥';
  return '📊';
};

const getBadgeEmoji = (badge: string) => {
  switch (badge) {
    case 'hot_streak': return '🔥';
    case 'diamond_hands': return '💎';
    case 'day_trader': return '⚡';
    case 'whale': return '🐋';
    case 'consistent': return '📈';
    case 'rookie': return '🐣';
    case 'veteran': return '🎖️';
    default: return '🏆';
  }
};

const getBadgeName = (badge: string) => {
  switch (badge) {
    case 'hot_streak': return 'Hot Streak';
    case 'diamond_hands': return 'Diamond Hands';
    case 'day_trader': return 'Day Trader';
    case 'whale': return 'Whale';
    case 'consistent': return 'Consistent';
    case 'rookie': return 'Rookie';
    case 'veteran': return 'Veteran';
    default: return 'Champion';
  }
};

export default function TradingLeaderboard() {
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userStats, setUserStats] = useState<TradingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'all'>('daily');
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    loadLeaderboard();
  }, [period]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUser(data.user);
    });
  }, []);

  const loadLeaderboard = async () => {
    try {
      setLoading(true);
      setError(null);

      // For now, create mock leaderboard data since the tables might not have real data yet
      const mockLeaderboard = await generateMockLeaderboard();
      setLeaderboard(mockLeaderboard);

      // Generate mock user stats
      if (currentUser) {
        const userEntry = mockLeaderboard.find(entry => entry.user_id === currentUser.id);
        setUserStats({
          user_rank: userEntry?.rank || Math.floor(Math.random() * 100) + 1,
          user_stats: userEntry || null,
          portfolio_change_today: (Math.random() - 0.5) * 1000,
          total_users_trading: 1247
        });
      }

      // TODO: Replace with real data queries
      /*
      const { data: leaderboardData, error: leaderboardError } = await supabase
        .from('leaderboard_snapshots')
        .select(`
          user_id,
          rank,
          daily_gain_loss,
          daily_gain_loss_pct,
          portfolio_value,
          trades_today,
          win_rate,
          consecutive_profitable_days,
          profiles(username)
        `)
        .order('rank', { ascending: true })
        .limit(50);

      if (leaderboardError) throw leaderboardError;
      setLeaderboard(leaderboardData || []);
      */

    } catch (e: any) {
      console.error('Failed to load leaderboard:', e);
      setError(e?.message || 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  };

  const generateMockLeaderboard = async (): Promise<LeaderboardEntry[]> => {
    const mockUsers = [
      'CryptoKing', 'DiamondHands', 'TradeWizard', 'VehicleGuru', 'MarketMaster',
      'TradingBot', 'InvestorPro', 'AutoTrader', 'WheelDealer', 'CarCollector',
      'PortfolioKing', 'TradeMachine', 'InvestGuru', 'MarketMover', 'TradePro',
      'VehicleInvestor', 'AutoExpert', 'TradingLegend', 'CarInvestor', 'MarketShark'
    ];

    return mockUsers.map((username, index) => {
      const rank = index + 1;
      const dailyGainLoss = (Math.random() - 0.3) * 2000; // Bias toward positive
      const portfolioValue = 10000 + Math.random() * 50000;
      const dailyGainLossPct = (dailyGainLoss / portfolioValue) * 100;
      
      const badges = [];
      if (rank <= 3) badges.push('hot_streak');
      if (dailyGainLoss > 1000) badges.push('whale');
      if (Math.random() > 0.7) badges.push('day_trader');
      if (Math.random() > 0.8) badges.push('diamond_hands');
      if (rank > 15) badges.push('rookie');

      return {
        user_id: `user_${index}`,
        username,
        rank,
        daily_gain_loss: dailyGainLoss,
        daily_gain_loss_pct: dailyGainLossPct,
        portfolio_value: portfolioValue,
        trades_today: Math.floor(Math.random() * 20) + 1,
        win_rate: 40 + Math.random() * 40, // 40-80%
        consecutive_profitable_days: Math.floor(Math.random() * 10),
        total_trades: 100 + Math.floor(Math.random() * 1000),
        lifetime_gain_loss: (Math.random() - 0.2) * 10000,
        badges
      };
    });
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading leaderboard...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '14pt', fontWeight: 900, margin: 0 }}>Trading Leaderboard</h2>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
            Top traders ranked by performance
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['daily', 'weekly', 'monthly', 'all'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p as any)}
              style={{
                padding: '6px 12px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: period === p ? 'var(--primary)' : 'var(--white)',
                color: period === p ? 'var(--white)' : 'var(--text)',
                fontSize: '9pt',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '16px', padding: '12px', border: '2px solid var(--danger)', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.1)' }}>
          <div style={{ fontSize: '9pt', color: 'var(--danger)' }}>{error}</div>
        </div>
      )}

      {/* User Stats Card */}
      {userStats && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <h3 className="heading-3">Your Performance</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '16pt', fontWeight: 900 }}>#{userStats.user_rank || '—'}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Your Rank</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: '16pt', 
                  fontWeight: 900,
                  color: userStats.portfolio_change_today >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'
                }}>
                  {formatUSD(userStats.portfolio_change_today)}
                </div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Today's P&L</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '16pt', fontWeight: 900 }}>{userStats.total_users_trading.toLocaleString()}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Total Traders</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <button 
                  className="button button-primary"
                  onClick={() => navigate('/market/portfolio')}
                  style={{ padding: '8px 16px', fontSize: '9pt' }}
                >
                  View Portfolio
                </button>
              </div>
            </div>
            {userStats.user_stats?.badges && userStats.user_stats.badges.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>Your Badges</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {userStats.user_stats.badges.map((badge, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        background: 'var(--surface)',
                        fontSize: '8pt'
                      }}
                    >
                      <span>{getBadgeEmoji(badge)}</span>
                      <span>{getBadgeName(badge)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="card">
        <div className="card-header">
          <h3 className="heading-3">Top Traders</h3>
        </div>
        <div className="card-body">
          {leaderboard.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              No trading data available
            </div>
          ) : (
            <div>
              {/* Header Row */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '60px 1fr 120px 120px 100px 100px 120px',
                gap: '12px',
                fontSize: '9pt',
                fontWeight: 700,
                marginBottom: '12px',
                color: 'var(--text-muted)',
                paddingBottom: '8px',
                borderBottom: '2px solid var(--border)'
              }}>
                <div>Rank</div>
                <div>Trader</div>
                <div>Today P&L</div>
                <div>Portfolio</div>
                <div>Trades</div>
                <div>Win Rate</div>
                <div>Badges</div>
              </div>

              {/* Leaderboard Entries */}
              {leaderboard.slice(0, 25).map((entry) => (
                <div
                  key={entry.user_id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr 120px 120px 100px 100px 120px',
                    gap: '12px',
                    fontSize: '9pt',
                    padding: '12px 0',
                    borderBottom: '1px solid var(--border)',
                    background: entry.user_id === currentUser?.id ? 'rgba(var(--primary-rgb, 59 130 246), 0.05)' : 'transparent',
                    borderRadius: entry.user_id === currentUser?.id ? '4px' : '0'
                  }}
                >
                  {/* Rank */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                    <span>{getRankEmoji(entry.rank)}</span>
                    <span>{entry.rank}</span>
                  </div>

                  {/* Trader */}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '10pt' }}>
                      {entry.username || `User ${entry.user_id.slice(-4)}`}
                      {entry.user_id === currentUser?.id && (
                        <span style={{ marginLeft: '8px', fontSize: '8pt', color: 'var(--primary)' }}>(You)</span>
                      )}
                    </div>
                    {entry.consecutive_profitable_days > 0 && (
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {entry.consecutive_profitable_days} day streak
                      </div>
                    )}
                  </div>

                  {/* Daily P&L */}
                  <div>
                    <div style={{ 
                      fontWeight: 700,
                      color: entry.daily_gain_loss >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'
                    }}>
                      {formatUSD(entry.daily_gain_loss)}
                    </div>
                    <div style={{ 
                      fontSize: '8pt',
                      color: entry.daily_gain_loss >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'
                    }}>
                      {formatPct(entry.daily_gain_loss_pct)}
                    </div>
                  </div>

                  {/* Portfolio */}
                  <div>
                    <div style={{ fontWeight: 700 }}>{formatUSD(entry.portfolio_value)}</div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {entry.total_trades} total trades
                    </div>
                  </div>

                  {/* Trades Today */}
                  <div style={{ fontWeight: 700 }}>
                    {entry.trades_today}
                  </div>

                  {/* Win Rate */}
                  <div style={{ fontWeight: 700 }}>
                    {entry.win_rate.toFixed(1)}%
                  </div>

                  {/* Badges */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {entry.badges.slice(0, 3).map((badge, index) => (
                      <span
                        key={index}
                        style={{ fontSize: '12pt' }}
                        title={getBadgeName(badge)}
                      >
                        {getBadgeEmoji(badge)}
                      </span>
                    ))}
                    {entry.badges.length > 3 && (
                      <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        +{entry.badges.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Achievement Guide */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <h3 className="heading-3">Trading Badges</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', fontSize: '9pt' }}>
            {[
              { badge: 'hot_streak', description: '3+ profitable days in a row' },
              { badge: 'diamond_hands', description: 'Hold positions for 7+ days' },
              { badge: 'day_trader', description: '10+ trades in a single day' },
              { badge: 'whale', description: '$1000+ daily profit' },
              { badge: 'consistent', description: '70%+ win rate over 30 days' },
              { badge: 'veteran', description: '1000+ total trades' }
            ].map((item, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14pt' }}>{getBadgeEmoji(item.badge)}</span>
                <div>
                  <div style={{ fontWeight: 700 }}>{getBadgeName(item.badge)}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Call to Action */}
      <div style={{ marginTop: '24px', textAlign: 'center' }}>
        <button 
          className="button button-primary"
          onClick={() => navigate('/market/dashboard')}
          style={{ marginRight: '12px' }}
        >
          Start Trading
        </button>
        <button 
          className="button button-secondary"
          onClick={() => navigate('/market/portfolio')}
        >
          View Your Portfolio
        </button>
      </div>
    </div>
  );
}
