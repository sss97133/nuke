import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface OrderBookEntry {
  price: number;
  shares: number;
  total: number;
}

const OrderBook: React.FC<{ offeringId: string }> = ({ offeringId }) => {
  const [bids, setBids] = useState<OrderBookEntry[]>([]);
  const [asks, setAsks] = useState<OrderBookEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadOrderBook();
    const interval = setInterval(loadOrderBook, 3000);
    return () => clearInterval(interval);
  }, [offeringId]);

  const loadOrderBook = async () => {
    try {
      setLoading(true);
      const { data: orders } = await supabase
        .from('market_orders')
        .select('*')
        .eq('offering_id', offeringId)
        .eq('status', 'active');

      if (orders) {
        // Group by price and sum shares
        const bidMap = new Map<number, number>();
        const askMap = new Map<number, number>();

        orders.forEach(order => {
          const available = order.shares_requested - order.shares_filled;
          if (available <= 0) return;

          if (order.order_type === 'buy') {
            bidMap.set(order.price_per_share, (bidMap.get(order.price_per_share) || 0) + available);
          } else {
            askMap.set(order.price_per_share, (askMap.get(order.price_per_share) || 0) + available);
          }
        });

        // Convert to arrays and sort
        const bidsArray = Array.from(bidMap.entries())
          .map(([price, shares]) => ({ price, shares, total: price * shares }))
          .sort((a, b) => b.price - a.price)
          .slice(0, 10);

        const asksArray = Array.from(askMap.entries())
          .map(([price, shares]) => ({ price, shares, total: price * shares }))
          .sort((a, b) => a.price - b.price)
          .slice(0, 10);

        setBids(bidsArray);
        setAsks(asksArray);
      }
    } catch (error) {
      console.error('Failed to load order book:', error);
    } finally {
      setLoading(false);
    }
  };

  const maxShares = Math.max(...bids.map(b => b.shares), ...asks.map(a => a.shares), 1);

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid #bdbdbd',
      borderRadius: '4px',
      padding: '12px',
      fontSize: '9pt'
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '10pt', fontWeight: 'bold' }}>Order Book</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* BIDS (Green side) */}
        <div>
          <div style={{
            background: '#dcfce7',
            padding: '8px',
            marginBottom: '8px',
            fontWeight: 'bold',
            textAlign: 'center',
            borderRadius: '2px',
            color: '#10b981'
          }}>
            BIDS 🟢
          </div>
          {bids.length === 0 ? (
            <div style={{ color: '#6b7280', textAlign: 'center', padding: '12px' }}>
              No bids
            </div>
          ) : (
            bids.map((bid, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '4px',
                  padding: '6px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  marginBottom: '4px',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#dcfce7';
                  e.currentTarget.style.borderColor = '#6ee7b7';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f0fdf4';
                  e.currentTarget.style.borderColor = '#bbf7d0';
                }}
              >
                <div style={{ fontWeight: 'bold', color: '#10b981' }}>
                  ${bid.price.toFixed(2)}
                </div>
                <div style={{ textAlign: 'right', color: '#6b7280' }}>
                  {bid.shares}
                </div>
                <div
                  style={{
                    height: '20px',
                    background: '#bbf7d0',
                    borderRadius: '2px',
                    width: `${(bid.shares / maxShares) * 100}%`
                  }}
                />
              </div>
            ))
          )}
        </div>

        {/* ASKS (Red side) */}
        <div>
          <div style={{
            background: '#fee2e2',
            padding: '8px',
            marginBottom: '8px',
            fontWeight: 'bold',
            textAlign: 'center',
            borderRadius: '2px',
            color: '#dc2626'
          }}>
            ASKS 🔴
          </div>
          {asks.length === 0 ? (
            <div style={{ color: '#6b7280', textAlign: 'center', padding: '12px' }}>
              No asks
            </div>
          ) : (
            asks.map((ask, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '4px',
                  padding: '6px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  marginBottom: '4px',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#fee2e2';
                  e.currentTarget.style.borderColor = '#fca5a5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#fef2f2';
                  e.currentTarget.style.borderColor = '#fecaca';
                }}
              >
                <div style={{ fontWeight: 'bold', color: '#dc2626' }}>
                  ${ask.price.toFixed(2)}
                </div>
                <div style={{ textAlign: 'right', color: '#6b7280' }}>
                  {ask.shares}
                </div>
                <div
                  style={{
                    height: '20px',
                    background: '#fca5a5',
                    borderRadius: '2px',
                    width: `${(ask.shares / maxShares) * 100}%`
                  }}
                />
              </div>
            ))
          )}
        </div>
      </div>

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

export default OrderBook;
