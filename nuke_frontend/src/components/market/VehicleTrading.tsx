import React, { useEffect, useState } from 'react';
import { AuctionMarketEngine, MarketOrder, MarketTrade, OrderBookSnapshot, MarketImpact } from '../../services/auctionMarketEngine';
import { supabase } from '../../lib/supabase';

interface VehicleTradingProps {
  vehicleId: string;
  vehicleTitle: string;
  offeringId?: string;
}

interface OrderBookEntry {
  price: number;
  shares: number;
  total_value: number;
}

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(value);

const formatPct = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

export default function VehicleTrading({ vehicleId, vehicleTitle, offeringId }: VehicleTradingProps) {
  const [activeTab, setActiveTab] = useState<'ticker' | 'orderbook' | 'orders' | 'trades'>('ticker');
  const [offering, setOffering] = useState<any>(null);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [bids, setBids] = useState<OrderBookEntry[]>([]);
  const [asks, setAsks] = useState<OrderBookEntry[]>([]);
  const [userOrders, setUserOrders] = useState<MarketOrder[]>([]);
  const [recentTrades, setRecentTrades] = useState<MarketTrade[]>([]);
  const [marketImpact, setMarketImpact] = useState<MarketImpact | null>(null);
  
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState<string>('10');
  const [price, setPrice] = useState<string>('');
  const [orderMode, setOrderMode] = useState<'market' | 'limit'>('limit');
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (offeringId) {
      loadData();
      const interval = setInterval(loadData, 5000); // Update every 5 seconds
      return () => clearInterval(interval);
    }
  }, [offeringId]);

  const loadData = async () => {
    if (!offeringId) return;
    
    try {
      setError(null);
      
      // Load offering data
      const { data: offeringData, error: offeringError } = await supabase
        .from('vehicle_offerings')
        .select('*')
        .eq('id', offeringId)
        .single();

      if (offeringError) throw offeringError;
      setOffering(offeringData);

      // Load order book
      const orderBookData = await AuctionMarketEngine.getOrderBook(offeringId);
      setOrderBook(orderBookData);

      // Load bids and asks
      const [bidsData, asksData] = await Promise.all([
        supabase
          .from('market_orders')
          .select('price_per_share, shares_requested, total_value')
          .eq('offering_id', offeringId)
          .eq('order_type', 'buy')
          .eq('status', 'active')
          .order('price_per_share', { ascending: false })
          .limit(10),
        supabase
          .from('market_orders')
          .select('price_per_share, shares_requested, total_value')
          .eq('offering_id', offeringId)
          .eq('order_type', 'sell')
          .eq('status', 'active')
          .order('price_per_share', { ascending: true })
          .limit(10)
      ]);

      setBids((bidsData.data || []).map(b => ({
        price: Number(b.price_per_share),
        shares: Number(b.shares_requested),
        total_value: Number(b.total_value)
      })));

      setAsks((asksData.data || []).map(a => ({
        price: Number(a.price_per_share),
        shares: Number(a.shares_requested),
        total_value: Number(a.total_value)
      })));

      // Load user's orders
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: ordersData } = await supabase
          .from('market_orders')
          .select('*')
          .eq('offering_id', offeringId)
          .eq('user_id', user.id)
          .in('status', ['active', 'partially_filled'])
          .order('created_at', { ascending: false });

        setUserOrders(ordersData || []);
      }

      // Load recent trades
      const { data: tradesData } = await supabase
        .from('market_trades')
        .select('*')
        .eq('offering_id', offeringId)
        .order('executed_at', { ascending: false })
        .limit(20);

      setRecentTrades(tradesData || []);

      // Set default price to mid-market
      if (orderBookData.highest_bid && orderBookData.lowest_ask && !price) {
        const midPrice = (orderBookData.highest_bid + orderBookData.lowest_ask) / 2;
        setPrice(midPrice.toFixed(4));
      } else if (offeringData.current_share_price && !price) {
        setPrice(Number(offeringData.current_share_price).toFixed(4));
      }

    } catch (e: any) {
      console.error('Failed to load trading data:', e);
      setError(e?.message || 'Failed to load trading data');
    } finally {
      setLoading(false);
    }
  };

  const calculateMarketImpact = async () => {
    if (!offeringId || !shares || !price) return;
    
    try {
      const impact = await AuctionMarketEngine.calculateMarketImpact(
        offeringId,
        orderType,
        Number(shares),
        Number(price)
      );
      setMarketImpact(impact);
    } catch (e) {
      console.error('Failed to calculate market impact:', e);
    }
  };

  useEffect(() => {
    if (shares && price) {
      calculateMarketImpact();
    }
  }, [shares, price, orderType]);

  const handleSubmitOrder = async () => {
    if (!offeringId || !shares || (!price && orderMode === 'limit')) return;

    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Please sign in to place orders');
        return;
      }

      const orderPrice = orderMode === 'market' 
        ? (orderType === 'buy' ? (orderBook?.lowest_ask || 0) : (orderBook?.highest_bid || 0))
        : Number(price);

      const result = await AuctionMarketEngine.placeOrder(
        offeringId,
        user.id,
        orderType,
        Number(shares),
        orderPrice
      );

      setSuccess(`Order placed successfully! ${result.trades.length > 0 ? `${result.trades.length} trades executed immediately.` : 'Order is pending.'}`);
      
      // Reset form
      setShares('10');
      if (orderMode === 'limit') setPrice('');
      
      // Reload data
      await loadData();

    } catch (e: any) {
      console.error('Failed to place order:', e);
      setError(e?.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      await AuctionMarketEngine.cancelOrder(orderId);
      setSuccess('Order cancelled successfully');
      await loadData();
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel order');
    }
  };

  if (!offeringId) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '24pt', marginBottom: '16px' }}>📈</div>
          <div style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '8px' }}>Trading Not Available</div>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
            This vehicle is not currently available for share trading.
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading trading interface...
      </div>
    );
  }

  return (
    <div>
      {/* Market Ticker */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '12pt', fontWeight: 800 }}>{vehicleTitle}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Trading on Nuke Exchange</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '14pt', fontWeight: 900 }}>
                  {formatUSD(offering?.current_share_price || 0)}
                </div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Current Price</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                  {formatUSD(orderBook?.highest_bid || 0)} × {formatUSD(orderBook?.lowest_ask || 0)}
                </div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Bid × Ask</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                  {formatUSD(orderBook?.bid_ask_spread || 0)}
                </div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Spread</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', borderBottom: '2px solid var(--border)' }}>
        {[
          { key: 'ticker', label: 'Trade', icon: '📈' },
          { key: 'orderbook', label: 'Order Book', icon: '📊' },
          { key: 'orders', label: `My Orders (${userOrders.length})`, icon: '📋' },
          { key: 'trades', label: 'Recent Trades', icon: '🕒' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
              color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: activeTab === tab.key ? 800 : 400,
              cursor: 'pointer',
              marginBottom: '-2px',
              fontSize: '9pt'
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ marginBottom: '16px', padding: '12px', border: '2px solid var(--danger, #ef4444)', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.1)' }}>
          <div style={{ fontSize: '9pt', color: 'var(--danger, #ef4444)' }}>{error}</div>
        </div>
      )}

      {success && (
        <div style={{ marginBottom: '16px', padding: '12px', border: '2px solid var(--success, #10b981)', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.1)' }}>
          <div style={{ fontSize: '9pt', color: 'var(--success, #10b981)' }}>{success}</div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'ticker' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Buy Panel */}
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3" style={{ color: 'var(--success, #10b981)' }}>Buy Shares</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Order Type</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setOrderMode('limit')}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        background: orderMode === 'limit' ? 'var(--primary)' : 'var(--white)',
                        color: orderMode === 'limit' ? 'var(--white)' : 'var(--text)',
                        fontSize: '9pt',
                        cursor: 'pointer'
                      }}
                    >
                      Limit
                    </button>
                    <button
                      onClick={() => setOrderMode('market')}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        background: orderMode === 'market' ? 'var(--primary)' : 'var(--white)',
                        color: orderMode === 'market' ? 'var(--white)' : 'var(--text)',
                        fontSize: '9pt',
                        cursor: 'pointer'
                      }}
                    >
                      Market
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Shares</label>
                  <input
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '2px solid var(--border)',
                      borderRadius: '4px',
                      background: 'var(--white)',
                      color: 'var(--text)'
                    }}
                    placeholder="Number of shares"
                    inputMode="numeric"
                  />
                </div>

                {orderMode === 'limit' && (
                  <div>
                    <label style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>
                      Price per Share
                    </label>
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        background: 'var(--white)',
                        color: 'var(--text)'
                      }}
                      placeholder="0.0000"
                      inputMode="decimal"
                    />
                  </div>
                )}

                {shares && (orderMode === 'market' || price) && (
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '4px', fontSize: '9pt' }}>
                    <div>Total: {formatUSD(Number(shares) * (orderMode === 'market' ? (orderBook?.lowest_ask || 0) : Number(price || 0)))}</div>
                    {marketImpact && (
                      <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
                        Market Impact: {formatPct(marketImpact.price_change_pct)}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => {
                    setOrderType('buy');
                    handleSubmitOrder();
                  }}
                  disabled={submitting || !shares || (orderMode === 'limit' && !price)}
                  className="button button-primary"
                  style={{ background: 'var(--success, #10b981)' }}
                >
                  {submitting ? 'Placing Order...' : 'Buy Shares'}
                </button>
              </div>
            </div>
          </div>

          {/* Sell Panel */}
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3" style={{ color: 'var(--danger, #ef4444)' }}>Sell Shares</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Order Type</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setOrderMode('limit')}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        background: orderMode === 'limit' ? 'var(--primary)' : 'var(--white)',
                        color: orderMode === 'limit' ? 'var(--white)' : 'var(--text)',
                        fontSize: '9pt',
                        cursor: 'pointer'
                      }}
                    >
                      Limit
                    </button>
                    <button
                      onClick={() => setOrderMode('market')}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        background: orderMode === 'market' ? 'var(--primary)' : 'var(--white)',
                        color: orderMode === 'market' ? 'var(--white)' : 'var(--text)',
                        fontSize: '9pt',
                        cursor: 'pointer'
                      }}
                    >
                      Market
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Shares</label>
                  <input
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '2px solid var(--border)',
                      borderRadius: '4px',
                      background: 'var(--white)',
                      color: 'var(--text)'
                    }}
                    placeholder="Number of shares"
                    inputMode="numeric"
                  />
                </div>

                {orderMode === 'limit' && (
                  <div>
                    <label style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>
                      Price per Share
                    </label>
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        background: 'var(--white)',
                        color: 'var(--text)'
                      }}
                      placeholder="0.0000"
                      inputMode="decimal"
                    />
                  </div>
                )}

                {shares && (orderMode === 'market' || price) && (
                  <div style={{ padding: '8px', background: 'var(--surface)', borderRadius: '4px', fontSize: '9pt' }}>
                    <div>Total: {formatUSD(Number(shares) * (orderMode === 'market' ? (orderBook?.highest_bid || 0) : Number(price || 0)))}</div>
                    {marketImpact && (
                      <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
                        Market Impact: {formatPct(marketImpact.price_change_pct)}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => {
                    setOrderType('sell');
                    handleSubmitOrder();
                  }}
                  disabled={submitting || !shares || (orderMode === 'limit' && !price)}
                  className="button button-primary"
                  style={{ background: 'var(--danger, #ef4444)' }}
                >
                  {submitting ? 'Placing Order...' : 'Sell Shares'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'orderbook' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Bids */}
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3" style={{ color: 'var(--success, #10b981)' }}>Bids (Buy Orders)</h3>
            </div>
            <div className="card-body">
              {bids.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  No bids
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '9pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                    <div>Price</div>
                    <div>Size</div>
                    <div>Total</div>
                  </div>
                  {bids.map((bid, index) => (
                    <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '9pt', padding: '4px 0' }}>
                      <div style={{ color: 'var(--success, #10b981)', fontWeight: 700 }}>{formatUSD(bid.price)}</div>
                      <div>{bid.shares}</div>
                      <div>{formatUSD(bid.total_value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Asks */}
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3" style={{ color: 'var(--danger, #ef4444)' }}>Asks (Sell Orders)</h3>
            </div>
            <div className="card-body">
              {asks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                  No asks
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '9pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                    <div>Price</div>
                    <div>Size</div>
                    <div>Total</div>
                  </div>
                  {asks.map((ask, index) => (
                    <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '9pt', padding: '4px 0' }}>
                      <div style={{ color: 'var(--danger, #ef4444)', fontWeight: 700 }}>{formatUSD(ask.price)}</div>
                      <div>{ask.shares}</div>
                      <div>{formatUSD(ask.total_value)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">My Active Orders</h3>
          </div>
          <div className="card-body">
            {userOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                No active orders
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                  <div>Type</div>
                  <div>Price</div>
                  <div>Size</div>
                  <div>Filled</div>
                  <div>Status</div>
                  <div>Action</div>
                </div>
                {userOrders.map((order) => (
                  <div key={order.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ 
                      color: order.order_type === 'buy' ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                      fontWeight: 700,
                      textTransform: 'uppercase'
                    }}>
                      {order.order_type}
                    </div>
                    <div>{formatUSD(order.price_per_share)}</div>
                    <div>{order.shares_requested}</div>
                    <div>{order.shares_filled}/{order.shares_requested}</div>
                    <div style={{ textTransform: 'capitalize' }}>{order.status.replace('_', ' ')}</div>
                    <div>
                      <button
                        onClick={() => cancelOrder(order.id)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid var(--danger, #ef4444)',
                          borderRadius: '4px',
                          background: 'transparent',
                          color: 'var(--danger, #ef4444)',
                          fontSize: '8pt',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'trades' && (
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Recent Trades</h3>
          </div>
          <div className="card-body">
            {recentTrades.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                No recent trades
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                  <div>Time</div>
                  <div>Price</div>
                  <div>Size</div>
                  <div>Total</div>
                </div>
                {recentTrades.map((trade) => (
                  <div key={trade.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '9pt', padding: '4px 0' }}>
                    <div>{new Date(trade.executed_at).toLocaleTimeString()}</div>
                    <div>{formatUSD(trade.price_per_share)}</div>
                    <div>{trade.shares_traded}</div>
                    <div>{formatUSD(trade.total_value)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
