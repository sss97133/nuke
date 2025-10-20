import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface Trader {
  rank: number;
  user_id: string;
  user_name: string;
  daily_gain_loss: number;
  daily_gain_loss_pct: number;
  total_trades: number;
  win_rate_pct: number;
  streak: number;
}

const Leaderboard: React.FC<{ userId?: string }> = ({ userId }) => {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [userRank, setUserRank] = useState<Trader | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadLeaderboard();
    const interval = setInterval(loadLeaderboard, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [userId]);

  const loadLeaderboard = async () => {
    try {
      setLoading(true);

      // Get today's date
      const today = new Date().toISOString().split('T')[0];

      const { data } = await supabase
        .from('leaderboard_snapshots')
        .select('*, auth.users (email)')
        .eq('snapshot_date', today)
        .order('rank', { ascending: true })
        .limit(10);

      if (data) {
        const formattedTraders: Trader[] = data.map((row: any) => ({
          rank: row.rank,
          user_id: row.user_id,
          user_name: row.auth?.email?.split('@')[0] || 'Anonymous',
          daily_gain_loss: row.daily_gain_loss || 0,
          daily_gain_loss_pct: row.daily_gain_loss_pct || 0,
          total_trades: row.total_trades || 0,
          win_rate_pct: row.win_rate_pct || 0,
          streak: row.consecutive_profitable_days || 0
        }));

        setTraders(formattedTraders);

        // Find current user's rank
        if (userId) {
          const userRow = formattedTraders.find(t => t.user_id === userId);
          setUserRank(userRow || null);
        }
      }
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: 'white',
      border: '2px solid #bdbdbd',
      borderRadius: '4px',
      padding: '16px'
    }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '11pt', fontWeight: 'bold' }}>
        🏆 Daily Leaderboard
      </h2>

      {/* Your Rank */}
      {userRank && (
        <div style={{
          background: '#fef3c7',
          border: '2px solid #fbbf24',
          padding: '12px',
          borderRadius: '4px',
          marginBottom: '16px'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: '12px',
            alignItems: 'center'
          }}>
            <div style={{
              fontSize: '20pt',
              fontWeight: 'bold',
              color: '#fbbf24',
              minWidth: '40px'
            }}>
              #{userRank.rank}
            </div>
            <div>
              <div style={{
                fontSize: '9pt',
                fontWeight: 'bold',
                color: '#1f2937'
              }}>
                YOU
              </div>
              <div style={{ fontSize: '8pt', color: '#6b7280' }}>
                {userRank.total_trades} trades today
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: '12pt',
                fontWeight: 'bold',
                color: userRank.daily_gain_loss >= 0 ? '#10b981' : '#dc2626'
              }}>
                {userRank.daily_gain_loss >= 0 ? '+' : ''} ${userRank.daily_gain_loss.toFixed(2)}
              </div>
              <div style={{
                fontSize: '9pt',
                color: userRank.daily_gain_loss >= 0 ? '#10b981' : '#dc2626',
                fontWeight: 'bold'
              }}>
                {userRank.daily_gain_loss_pct >= 0 ? '↑' : '↓'} {Math.abs(userRank.daily_gain_loss_pct).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {traders.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '24px',
          color: '#6b7280'
        }}>
          No data yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {traders.map((trader, index) => (
            <div
              key={index}
              style={{
                background: index === 0 ? '#fef3c7' : '#f9fafb',
                border: `1px solid ${index === 0 ? '#fbbf24' : '#e5e7eb'}`,
                padding: '10px',
                borderRadius: '2px',
                display: 'grid',
                gridTemplateColumns: '40px 1fr auto',
                gap: '12px',
                alignItems: 'center'
              }}
            >
              {/* Rank */}
              <div style={{
                fontSize: index === 0 ? '18pt' : '12pt',
                fontWeight: 'bold',
                color: index === 0 ? '#fbbf24' : '#6b7280',
                textAlign: 'center'
              }}>
                {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${trader.rank}`}
              </div>

              {/* Info */}
              <div>
                <div style={{
                  fontSize: '9pt',
                  fontWeight: 'bold',
                  color: '#1f2937',
                  marginBottom: '2px'
                }}>
                  {trader.user_name}
                </div>
                <div style={{ fontSize: '8pt', color: '#6b7280' }}>
                  {trader.total_trades} trades • {trader.win_rate_pct.toFixed(0)}% win {trader.streak > 0 && `• 🔥 ${trader.streak}d`}
                </div>
              </div>

              {/* Gain/Loss */}
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: '10pt',
                  fontWeight: 'bold',
                  color: trader.daily_gain_loss >= 0 ? '#10b981' : '#dc2626'
                }}>
                  {trader.daily_gain_loss >= 0 ? '+' : ''} ${Math.abs(trader.daily_gain_loss).toFixed(0)}
                </div>
                <div style={{
                  fontSize: '8pt',
                  color: trader.daily_gain_loss >= 0 ? '#10b981' : '#dc2626',
                  fontWeight: 'bold'
                }}>
                  {trader.daily_gain_loss >= 0 ? '↑' : '↓'} {Math.abs(trader.daily_gain_loss_pct).toFixed(1)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{
          textAlign: 'center',
          marginTop: '12px',
          color: '#6b7280',
          fontSize: '8pt'
        }}>
          Updating...
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
