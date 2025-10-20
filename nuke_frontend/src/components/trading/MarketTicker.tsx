import { useState, useEffect } from 'react';
import { AuctionMarketEngine, OrderBookSnapshot } from '../../services/auctionMarketEngine';
import '../../design-system.css';

interface MarketTickerProps {
  offeringId: string;
  vehicleTitle?: string;
  onTrade?: () => void;
}

const MarketTicker: React.FC<MarketTickerProps> = ({ offeringId, vehicleTitle, onTrade }) => {
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showBuyForm, setShowBuyForm] = useState(false);
  const [showSellForm, setShowSellForm] = useState(false);

  useEffect(() => {
    loadOrderBook();
    const interval = setInterval(loadOrderBook, 2000); // Update every 2 seconds
    return () => clearInterval(interval);
  }, [offeringId]);

  const loadOrderBook = async () => {
    try {
      setIsLoading(true);
      const book = await AuctionMarketEngine.getOrderBook(offeringId);
      setOrderBook(book);
      
      // Track price history (last 30 data points)
      setPriceHistory(prev => [...prev.slice(-29), book.weighted_mid_price]);
    } catch (error) {
      console.error('Failed to load order book:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!orderBook) {
    return (
      <div style={{
        background: 'white',
        border: '2px solid #bdbdbd',
        padding: '16px',
        borderRadius: '4px',
        textAlign: 'center'
      }}>
        Loading market data...
      </div>
    );
  }

  const priceChange = priceHistory.length > 1 
    ? priceHistory[priceHistory.length - 1] - priceHistory[0]
    : 0;
  const priceChangePercent = priceHistory.length > 1
    ? ((priceChange / priceHistory[0]) * 100).toFixed(2)
    : '0.00';
  
  const isUp = priceChange >= 0;
  const priceColor = isUp ? '#10b981' : '#dc2626';
  const bgColor = isUp ? '#f0fdf4' : '#fef2f2';

  return (
    <div style={{
      background: bgColor,
      border: `2px solid ${priceColor}`,
      borderRadius: '4px',
      padding: '16px'
    }}>
      {/* Title */}
      {vehicleTitle && (
        <div style={{
          fontSize: '10pt',
          fontWeight: 'bold',
          marginBottom: '8px',
          color: '#1f2937'
        }}>
          {vehicleTitle}
        </div>
      )}

      {/* Price Display */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '12px',
        marginBottom: '12px'
      }}>
        <div style={{
          fontSize: '24pt',
          fontWeight: 'bold',
          color: priceColor
        }}>
          ${orderBook.weighted_mid_price.toFixed(2)}
        </div>
        <div style={{
          fontSize: '12pt',
          fontWeight: 'bold',
          color: priceColor,
          backgroundColor: isUp ? '#dcfce7' : '#fee2e2',
          padding: '4px 8px',
          borderRadius: '2px'
        }}>
          {isUp ? '↑' : '↓'} {Math.abs(parseFloat(priceChangePercent))}%
        </div>
      </div>

      {/* Bid-Ask Spread */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        marginBottom: '12px',
        fontSize: '9pt'
      }}>
        <div style={{ backgroundColor: '#fee2e2', padding: '8px', borderRadius: '2px' }}>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>Ask (Sellers)</div>
          <div style={{ fontSize: '11pt', fontWeight: 'bold', color: '#dc2626' }}>
            ${orderBook.lowest_ask.toFixed(2)}
          </div>
        </div>
        <div style={{ backgroundColor: '#dcfce7', padding: '8px', borderRadius: '2px' }}>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>Bid (Buyers)</div>
          <div style={{ fontSize: '11pt', fontWeight: 'bold', color: '#10b981' }}>
            ${orderBook.highest_bid.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Spread & Depth */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        marginBottom: '12px',
        fontSize: '8pt'
      }}>
        <div style={{ color: '#6b7280' }}>
          Spread: ${orderBook.bid_ask_spread.toFixed(4)} ({((orderBook.bid_ask_spread / orderBook.weighted_mid_price) * 100).toFixed(2)}%)
        </div>
        <div style={{ color: '#6b7280', textAlign: 'right' }}>
          Depth: {orderBook.buy_side_depth} / {orderBook.sell_side_depth}
        </div>
      </div>

      {/* Mini Chart (sparkline) */}
      {priceHistory.length > 1 && (
        <div style={{
          marginBottom: '12px',
          height: '40px',
          backgroundColor: 'rgba(0,0,0,0.02)',
          borderRadius: '2px',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <svg
            width="100%"
            height="100%"
            style={{ display: 'block' }}
            preserveAspectRatio="none"
          >
            <polyline
              points={priceHistory
                .map((price, i) => {
                  const x = (i / (priceHistory.length - 1)) * 100;
                  const min = Math.min(...priceHistory);
                  const max = Math.max(...priceHistory);
                  const range = max - min || 1;
                  const y = 100 - ((price - min) / range) * 100;
                  return `${x},${y}`;
                })
                .join(' ')}
              fill="none"
              stroke={priceColor}
              strokeWidth="2"
            />
          </svg>
        </div>
      )}

      {/* Action Buttons */}
      {!showBuyForm && !showSellForm ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px'
        }}>
          <button
            onClick={() => setShowBuyForm(true)}
            style={{
              padding: '10px',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '2px',
              fontWeight: 'bold',
              fontSize: '9pt',
              cursor: 'pointer',
              transition: 'all 0.12s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#059669';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#10b981';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            🟢 Buy Shares
          </button>
          <button
            onClick={() => setShowSellForm(true)}
            style={{
              padding: '10px',
              background: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '2px',
              fontWeight: 'bold',
              fontSize: '9pt',
              cursor: 'pointer',
              transition: 'all 0.12s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#b91c1c';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#dc2626';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            🔴 Sell Shares
          </button>
        </div>
      ) : showBuyForm ? (
        <BuyOrderForm
          offeringId={offeringId}
          midPrice={orderBook.weighted_mid_price}
          onComplete={() => {
            setShowBuyForm(false);
            loadOrderBook();
            onTrade?.();
          }}
          onCancel={() => setShowBuyForm(false)}
        />
      ) : (
        <SellOrderForm
          offeringId={offeringId}
          midPrice={orderBook.weighted_mid_price}
          onComplete={() => {
            setShowSellForm(false);
            loadOrderBook();
            onTrade?.();
          }}
          onCancel={() => setShowSellForm(false)}
        />
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div style={{
          fontSize: '8pt',
          color: '#6b7280',
          textAlign: 'center',
          marginTop: '8px'
        }}>
          Updating...
        </div>
      )}
    </div>
  );
};

// Simple Buy Order Form
const BuyOrderForm: React.FC<{
  offeringId: string;
  midPrice: number;
  onComplete: () => void;
  onCancel: () => void;
}> = ({ offeringId, midPrice, onComplete, onCancel }) => {
  const [shares, setShares] = useState('1');
  const [price, setPrice] = useState(midPrice.toFixed(2));

  const handleBuy = async () => {
    try {
      const sharesNum = parseInt(shares);
      const priceNum = parseFloat(price);
      
      // In real app, get userId from auth
      // await AuctionMarketEngine.placeOrder(offeringId, userId, 'buy', sharesNum, priceNum);
      
      onComplete();
    } catch (error) {
      console.error('Buy failed:', error);
    }
  };

  return (
    <div style={{
      background: '#f0fdf4',
      border: '1px solid #bbf7d0',
      padding: '12px',
      borderRadius: '2px',
      fontSize: '9pt'
    }}>
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Shares:</label>
        <input
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          min="1"
          style={{ width: '100%', padding: '6px', border: '1px solid #bbf7d0', borderRadius: '2px' }}
        />
      </div>
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Price:</label>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          step="0.01"
          style={{ width: '100%', padding: '6px', border: '1px solid #bbf7d0', borderRadius: '2px' }}
        />
      </div>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
        Total: ${(parseInt(shares) * parseFloat(price)).toFixed(2)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <button
          onClick={handleBuy}
          style={{
            padding: '8px',
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '2px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          Place Buy
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '8px',
            background: '#e5e7eb',
            border: '1px solid #bdbdbd',
            borderRadius: '2px',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// Simple Sell Order Form
const SellOrderForm: React.FC<{
  offeringId: string;
  midPrice: number;
  onComplete: () => void;
  onCancel: () => void;
}> = ({ offeringId, midPrice, onComplete, onCancel }) => {
  const [shares, setShares] = useState('1');
  const [price, setPrice] = useState(midPrice.toFixed(2));

  const handleSell = async () => {
    try {
      const sharesNum = parseInt(shares);
      const priceNum = parseFloat(price);
      
      // In real app, get userId from auth
      // await AuctionMarketEngine.placeOrder(offeringId, userId, 'sell', sharesNum, priceNum);
      
      onComplete();
    } catch (error) {
      console.error('Sell failed:', error);
    }
  };

  return (
    <div style={{
      background: '#fef2f2',
      border: '1px solid #fecaca',
      padding: '12px',
      borderRadius: '2px',
      fontSize: '9pt'
    }}>
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Shares:</label>
        <input
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          min="1"
          style={{ width: '100%', padding: '6px', border: '1px solid #fecaca', borderRadius: '2px' }}
        />
      </div>
      <div style={{ marginBottom: '8px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Price:</label>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          step="0.01"
          style={{ width: '100%', padding: '6px', border: '1px solid #fecaca', borderRadius: '2px' }}
        />
      </div>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
        Total: ${(parseInt(shares) * parseFloat(price)).toFixed(2)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <button
          onClick={handleSell}
          style={{
            padding: '8px',
            background: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '2px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          Place Sell
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '8px',
            background: '#e5e7eb',
            border: '1px solid #bdbdbd',
            borderRadius: '2px',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default MarketTicker;
