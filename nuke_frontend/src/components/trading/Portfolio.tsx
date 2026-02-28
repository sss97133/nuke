import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface Holding {
  offering_id: string;
  vehicle_title: string;
  shares_owned: number;
  entry_price: number;
  current_mark: number;
  unrealized_gain_loss: number;
  unrealized_gain_loss_pct: number;
}

const Portfolio: React.FC<{ userId: string }> = ({ userId }) => {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [totalGainLoss, setTotalGainLoss] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPortfolio();
  }, [userId]);

  const loadPortfolio = async () => {
    try {
      setLoading(true);
      const { data } = await supabase
        .from('share_holdings')
        .select('*, vehicle_offerings (id, vehicle_id)')
        .eq('holder_id', userId);

      if (data) {
        const processedHoldings: Holding[] = data.map(h => ({
          offering_id: h.offering_id,
          vehicle_title: h.vehicle_offerings?.vehicle_id || 'Unknown',
          shares_owned: h.shares_owned,
          entry_price: h.entry_price,
          current_mark: h.current_mark,
          unrealized_gain_loss: h.unrealized_gain_loss || 0,
          unrealized_gain_loss_pct: h.unrealized_gain_loss_pct || 0
        }));

        setHoldings(processedHoldings);
        setTotalValue(processedHoldings.reduce((sum, h) => sum + h.shares_owned * h.current_mark, 0));
        setTotalGainLoss(processedHoldings.reduce((sum, h) => sum + h.unrealized_gain_loss, 0));
      }
    } catch (error) {
      console.error('Failed to load portfolio:', error);
    } finally {
      setLoading(false);
    }
  };

  const gainLossPercent = totalValue > 0 ? (totalGainLoss / (totalValue - totalGainLoss)) * 100 : 0;
  const isPositive = totalGainLoss >= 0;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '4px',
      padding: '16px'
    }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: 'bold' }}>Portfolio</h2>

      {/* Summary */}
      <div style={{
        background: isPositive ? 'var(--success-dim)' : 'var(--error-dim)',
        border: `2px solid ${isPositive ? 'var(--success)' : 'var(--error)'}`,
        padding: '12px',
        borderRadius: '4px',
        marginBottom: '16px'
      }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          Total Value
        </div>
        <div style={{
          fontSize: '24px',
          fontWeight: 'bold',
          color: isPositive ? 'var(--success)' : 'var(--error)',
          marginBottom: '8px'
        }}>
          ${totalValue.toFixed(2)}
        </div>
        <div style={{
          fontSize: '15px',
          fontWeight: 'bold',
          color: isPositive ? 'var(--success)' : 'var(--error)'
        }}>
          {isPositive ? '↑' : '↓'} ${Math.abs(totalGainLoss).toFixed(2)} ({gainLossPercent.toFixed(1)}%)
        </div>
      </div>

      {/* Holdings List */}
      {holdings.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '24px',
          color: 'var(--text-secondary)'
        }}>
          No holdings yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {holdings.map((holding) => (
            <div
              key={holding.offering_id}
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                padding: '10px',
                borderRadius: '2px',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '12px',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{
                  fontSize: '12px',
                  fontWeight: 'bold',
                  marginBottom: '4px',
                  color: 'var(--text)'
                }}>
                  {holding.vehicle_title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {holding.shares_owned} shares @ ${holding.current_mark.toFixed(2)}/share
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 'bold',
                  marginBottom: '4px',
                  color: holding.unrealized_gain_loss >= 0 ? 'var(--success)' : 'var(--error)'
                }}>
                  ${(holding.shares_owned * holding.current_mark).toFixed(2)}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: holding.unrealized_gain_loss >= 0 ? 'var(--success)' : 'var(--error)',
                  fontWeight: 'bold'
                }}>
                  {holding.unrealized_gain_loss >= 0 ? '↑' : '↓'} {Math.abs(holding.unrealized_gain_loss_pct).toFixed(1)}%
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
          color: 'var(--text-secondary)',
          fontSize: '11px'
        }}>
          Loading...
        </div>
      )}
    </div>
  );
};

export default Portfolio;
