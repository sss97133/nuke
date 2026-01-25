import { useMemo } from 'react';
import { useTradingWebSocket } from '../../hooks/useTradingWebSocket';
import type { OrderBookLevel } from '../../hooks/useTradingWebSocket';
import '../../design-system.css';

interface OrderBookProps {
  offeringId: string;
  onPriceClick?: (price: number, side: 'buy' | 'sell') => void;
  depth?: number;
  showSpread?: boolean;
}

const OrderBook: React.FC<OrderBookProps> = ({
  offeringId,
  onPriceClick,
  depth = 10,
  showSpread = true,
}) => {
  const { orderBook, nbbo, isConnected, lastUpdate } = useTradingWebSocket(offeringId, {
    orderBookDepth: depth,
  });

  // Calculate max shares for bar scaling
  const maxShares = useMemo(() => {
    const allShares = [
      ...orderBook.bids.map(b => b.shares),
      ...orderBook.asks.map(a => a.shares),
    ];
    return Math.max(...allShares, 1);
  }, [orderBook]);

  // Calculate cumulative depth
  const bidsWithCumulative = useMemo(() => {
    let cumulative = 0;
    return orderBook.bids.map(level => {
      cumulative += level.shares;
      return { ...level, cumulative };
    });
  }, [orderBook.bids]);

  const asksWithCumulative = useMemo(() => {
    let cumulative = 0;
    return orderBook.asks.map(level => {
      cumulative += level.shares;
      return { ...level, cumulative };
    });
  }, [orderBook.asks]);

  const maxCumulative = useMemo(() => {
    const bidTotal = bidsWithCumulative[bidsWithCumulative.length - 1]?.cumulative || 0;
    const askTotal = asksWithCumulative[asksWithCumulative.length - 1]?.cumulative || 0;
    return Math.max(bidTotal, askTotal, 1);
  }, [bidsWithCumulative, asksWithCumulative]);

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;
  const formatShares = (shares: number) => shares.toLocaleString();

  const renderLevel = (
    level: OrderBookLevel & { cumulative: number },
    side: 'bid' | 'ask',
    index: number
  ) => {
    const isBid = side === 'bid';
    const barWidth = (level.shares / maxShares) * 100;
    const cumulativeWidth = (level.cumulative / maxCumulative) * 100;

    return (
      <div
        key={`${side}-${level.price}`}
        onClick={() => onPriceClick?.(level.price, isBid ? 'buy' : 'sell')}
        style={{
          display: 'grid',
          gridTemplateColumns: isBid ? '1fr 60px 80px' : '80px 60px 1fr',
          gap: '4px',
          padding: '4px 8px',
          position: 'relative',
          cursor: onPriceClick ? 'pointer' : 'default',
          transition: 'background 0.1s ease',
          fontSize: '11px',
          fontFamily: 'var(--font-mono, monospace)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isBid ? '#dcfce7' : '#fee2e2';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Depth bar background */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [isBid ? 'right' : 'left']: 0,
            width: `${cumulativeWidth}%`,
            background: isBid ? 'rgba(16, 185, 129, 0.08)' : 'rgba(220, 38, 38, 0.08)',
            zIndex: 0,
            transition: 'width 0.2s ease',
          }}
        />

        {/* Size bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [isBid ? 'right' : 'left']: 0,
            width: `${barWidth}%`,
            background: isBid ? 'rgba(16, 185, 129, 0.2)' : 'rgba(220, 38, 38, 0.2)',
            zIndex: 1,
            transition: 'width 0.2s ease',
          }}
        />

        {isBid ? (
          <>
            <div style={{ textAlign: 'right', zIndex: 2, color: '#6b7280' }}>
              {level.orderCount > 1 && <span style={{ fontSize: '9px' }}>({level.orderCount}) </span>}
              {formatShares(level.shares)}
            </div>
            <div style={{ textAlign: 'center', zIndex: 2, fontWeight: 600, color: '#10b981' }}>
              {formatPrice(level.price)}
            </div>
            <div />
          </>
        ) : (
          <>
            <div />
            <div style={{ textAlign: 'center', zIndex: 2, fontWeight: 600, color: '#dc2626' }}>
              {formatPrice(level.price)}
            </div>
            <div style={{ textAlign: 'left', zIndex: 2, color: '#6b7280' }}>
              {formatShares(level.shares)}
              {level.orderCount > 1 && <span style={{ fontSize: '9px' }}> ({level.orderCount})</span>}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '2px solid #bdbdbd',
        borderRadius: '4px',
        fontSize: '9pt',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '10pt', fontWeight: 'bold' }}>Order Book</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isConnected ? '#10b981' : '#ef4444',
            }}
            title={isConnected ? 'Connected' : 'Disconnected'}
          />
          {lastUpdate && (
            <span style={{ fontSize: '8pt', color: '#6b7280' }}>
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Column Headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 60px 80px 80px 60px 1fr',
          gap: '4px',
          padding: '6px 8px',
          borderBottom: '1px solid #e5e7eb',
          fontSize: '8pt',
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
        }}
      >
        <div style={{ textAlign: 'right' }}>Size</div>
        <div style={{ textAlign: 'center', color: '#10b981' }}>Bid</div>
        <div />
        <div />
        <div style={{ textAlign: 'center', color: '#dc2626' }}>Ask</div>
        <div style={{ textAlign: 'left' }}>Size</div>
      </div>

      {/* Order Book Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {/* Bids (left side) */}
        <div style={{ borderRight: '1px solid #e5e7eb' }}>
          {bidsWithCumulative.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              No bids
            </div>
          ) : (
            bidsWithCumulative.map((level, i) => renderLevel(level, 'bid', i))
          )}
        </div>

        {/* Asks (right side) */}
        <div>
          {asksWithCumulative.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              No asks
            </div>
          ) : (
            asksWithCumulative.map((level, i) => renderLevel(level, 'ask', i))
          )}
        </div>
      </div>

      {/* Spread Display */}
      {showSpread && nbbo.spread !== null && (
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid #e5e7eb',
            background: '#f9fafb',
            display: 'flex',
            justifyContent: 'center',
            gap: '16px',
            fontSize: '9pt',
          }}
        >
          <div>
            <span style={{ color: '#6b7280' }}>Spread: </span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
              ${nbbo.spread.toFixed(2)}
            </span>
            {nbbo.spreadPct !== null && (
              <span style={{ color: '#6b7280', marginLeft: '4px' }}>
                ({nbbo.spreadPct.toFixed(2)}%)
              </span>
            )}
          </div>
          {nbbo.midPrice !== null && (
            <div>
              <span style={{ color: '#6b7280' }}>Mid: </span>
              <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
                ${nbbo.midPrice.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Last Trade */}
      {nbbo.lastTradePrice !== null && (
        <div
          style={{
            padding: '6px 12px',
            borderTop: '1px solid #e5e7eb',
            fontSize: '8pt',
            color: '#6b7280',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Last: ${nbbo.lastTradePrice.toFixed(2)} x {nbbo.lastTradeSize}</span>
          {nbbo.lastTradeTime && (
            <span>{nbbo.lastTradeTime.toLocaleTimeString()}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default OrderBook;
