/**
 * Trade Tape (Time & Sales)
 *
 * Real-time scrolling feed of executed trades.
 * Shows price, size, and timestamp with color coding for buy/sell.
 */

import { useRef, useEffect } from 'react';
import { useTradingWebSocket } from '../../hooks/useTradingWebSocket';
import type { Trade } from '../../hooks/useTradingWebSocket';
import '../../design-system.css';

interface TradeTapeProps {
  offeringId: string;
  maxHeight?: number;
  showHeader?: boolean;
  autoScroll?: boolean;
}

const TradeTape: React.FC<TradeTapeProps> = ({
  offeringId,
  maxHeight = 300,
  showHeader = true,
  autoScroll = true,
}) => {
  const { recentTrades, isConnected, lastUpdate } = useTradingWebSocket(offeringId, {
    maxTrades: 100,
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top on new trades
  useEffect(() => {
    if (autoScroll && scrollRef.current && recentTrades.length > 0) {
      scrollRef.current.scrollTop = 0;
    }
  }, [recentTrades, autoScroll]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;
  const formatShares = (shares: number) => shares.toLocaleString();

  const renderTrade = (trade: Trade, index: number, prevTrade?: Trade) => {
    // Determine if price moved up, down, or unchanged
    const priceDirection = prevTrade
      ? trade.price > prevTrade.price
        ? 'up'
        : trade.price < prevTrade.price
        ? 'down'
        : 'unchanged'
      : 'unchanged';

    const colors = {
      up: '#10b981',      // Green
      down: '#dc2626',    // Red
      unchanged: '#6b7280', // Gray
    };

    const backgroundColor = index === 0
      ? priceDirection === 'up'
        ? 'rgba(16, 185, 129, 0.1)'
        : priceDirection === 'down'
        ? 'rgba(220, 38, 38, 0.1)'
        : 'transparent'
      : 'transparent';

    return (
      <div
        key={trade.id}
        style={{
          display: 'grid',
          gridTemplateColumns: '70px 60px 50px 1fr',
          gap: '8px',
          padding: '6px 12px',
          fontSize: '11px',
          fontFamily: 'var(--font-mono, monospace)',
          borderBottom: '1px solid #f3f4f6',
          background: backgroundColor,
          transition: 'background 0.3s ease',
          animation: index === 0 ? 'flash 0.5s ease' : 'none',
        }}
      >
        {/* Time */}
        <div style={{ color: '#6b7280' }}>
          {formatTime(trade.timestamp)}
        </div>

        {/* Price with direction indicator */}
        <div style={{ fontWeight: 600, color: colors[priceDirection], textAlign: 'right' }}>
          {priceDirection === 'up' && '↑ '}
          {priceDirection === 'down' && '↓ '}
          {formatPrice(trade.price)}
        </div>

        {/* Size */}
        <div style={{ textAlign: 'right', color: '#374151' }}>
          {formatShares(trade.shares)}
        </div>

        {/* Side indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: trade.side === 'buy' ? '#10b981' : '#dc2626',
            }}
          />
          <span style={{ fontSize: '9px', color: '#9ca3af', textTransform: 'uppercase' }}>
            {trade.side}
          </span>
        </div>
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
      {showHeader && (
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
          <h3 style={{ margin: 0, fontSize: '10pt', fontWeight: 'bold' }}>
            Time & Sales
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '8pt', color: '#6b7280' }}>
              {recentTrades.length} trades
            </span>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: isConnected ? '#10b981' : '#ef4444',
              }}
              title={isConnected ? 'Connected' : 'Disconnected'}
            />
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '70px 60px 50px 1fr',
          gap: '8px',
          padding: '6px 12px',
          borderBottom: '1px solid #e5e7eb',
          fontSize: '8pt',
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          background: '#fafafa',
        }}
      >
        <div>Time</div>
        <div style={{ textAlign: 'right' }}>Price</div>
        <div style={{ textAlign: 'right' }}>Size</div>
        <div>Side</div>
      </div>

      {/* Trade List */}
      <div
        ref={scrollRef}
        style={{
          maxHeight: `${maxHeight}px`,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {recentTrades.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#6b7280',
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>
              &#x1F4CA;
            </div>
            <div>No trades yet</div>
            <div style={{ fontSize: '9px', marginTop: '4px' }}>
              Waiting for market activity...
            </div>
          </div>
        ) : (
          recentTrades.map((trade, index) =>
            renderTrade(trade, index, recentTrades[index + 1])
          )
        )}
      </div>

      {/* Footer with last update time */}
      {lastUpdate && (
        <div
          style={{
            padding: '4px 12px',
            borderTop: '1px solid #e5e7eb',
            fontSize: '8pt',
            color: '#9ca3af',
            textAlign: 'right',
          }}
        >
          Last update: {lastUpdate.toLocaleTimeString()}
        </div>
      )}

      {/* CSS Animation */}
      <style>{`
        @keyframes flash {
          0% { background: rgba(59, 130, 246, 0.3); }
          100% { background: transparent; }
        }
      `}</style>
    </div>
  );
};

export default TradeTape;
