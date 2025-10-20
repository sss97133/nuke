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
      background: 'white',
      border: '2px solid #bdbdbd',
      borderRadius: '4px',
      padding: '16px'
    }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '11pt', fontWeight: 'bold' }}>Portfolio</h2>

      {/* Summary */}
      <div style={{
        background: isPositive ? '#f0fdf4' : '#fef2f2',
        border: `2px solid ${isPositive ? '#10b981' : '#dc2626'}`,
        padding: '12px',
        borderRadius: '4px',
        marginBottom: '16px'
      }}>
        <div style={{ fontSize: '9pt', color: '#6b7280', marginBottom: '4px' }}>
          Total Value
        </div>
        <div style={{
          fontSize: '18pt',
          fontWeight: 'bold',
          color: isPositive ? '#10b981' : '#dc2626',
          marginBottom: '8px'
        }}>
          ${totalValue.toFixed(2)}
        </div>
        <div style={{
          fontSize: '11pt',
          fontWeight: 'bold',
          color: isPositive ? '#10b981' : '#dc2626'
        }}>
          {isPositive ? '↑' : '↓'} ${Math.abs(totalGainLoss).toFixed(2)} ({gainLossPercent.toFixed(1)}%)
        </div>
      </div>

      {/* Holdings List */}
      {holdings.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '24px',
          color: '#6b7280'
        }}>
          No holdings yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {holdings.map((holding) => (
            <div
              key={holding.offering_id}
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
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
                  fontSize: '9pt',
                  fontWeight: 'bold',
                  marginBottom: '4px',
                  color: '#1f2937'
                }}>
                  {holding.vehicle_title}
                </div>
                <div style={{ fontSize: '8pt', color: '#6b7280' }}>
                  {holding.shares_owned} shares @ ${holding.current_mark.toFixed(2)}/share
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: '10pt',
                  fontWeight: 'bold',
                  marginBottom: '4px',
                  color: holding.unrealized_gain_loss >= 0 ? '#10b981' : '#dc2626'
                }}>
                  ${(holding.shares_owned * holding.current_mark).toFixed(2)}
                </div>
                <div style={{
                  fontSize: '8pt',
                  color: holding.unrealized_gain_loss >= 0 ? '#10b981' : '#dc2626',
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
          color: '#6b7280',
          fontSize: '8pt'
        }}>
          Loading...
        </div>
      )}
    </div>
  );
};

export default Portfolio;
