/**
 * Trading Terminal
 *
 * Bloomberg-style multi-panel trading workspace with:
 * - Price chart (candlestick)
 * - Order book (Level 2)
 * - Trade tape (Time & Sales)
 * - Market depth
 * - Trade panel
 * - Portfolio positions
 *
 * Supports keyboard shortcuts for rapid trading
 */

import { useState, useEffect, useCallback } from 'react';
import PriceChart from './PriceChart';
import OrderBook from './OrderBook';
import TradeTape from './TradeTape';
import MarketDepth from './MarketDepth';
import TradePanel from './TradePanel';
import Portfolio from './Portfolio';
import { useTradingWebSocket } from '../../hooks/useTradingWebSocket';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface TradingTerminalProps {
  offeringId: string;
  vehicleName?: string;
  onClose?: () => void;
}

type Panel = 'chart' | 'orderbook' | 'tape' | 'depth' | 'trade' | 'portfolio';

interface LayoutConfig {
  panels: Panel[];
  layout: 'full' | 'split' | 'quad';
}

const DEFAULT_LAYOUT: LayoutConfig = {
  panels: ['chart', 'orderbook', 'tape', 'trade'],
  layout: 'quad',
};

const TradingTerminal: React.FC<TradingTerminalProps> = ({
  offeringId,
  vehicleName = 'Asset',
  onClose,
}) => {
  const [layout, setLayout] = useState<LayoutConfig>(DEFAULT_LAYOUT);
  const [userId, setUserId] = useState<string | null>(null);
  const [showTrade, setShowTrade] = useState(false);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [presetPrice, setPresetPrice] = useState<number | null>(null);

  const { nbbo, isConnected, lastUpdate } = useTradingWebSocket(offeringId);

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);
    };
    getUser();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'b':
          // Buy shortcut
          setTradeType('buy');
          setShowTrade(true);
          break;
        case 's':
          // Sell shortcut
          setTradeType('sell');
          setShowTrade(true);
          break;
        case 'escape':
          // Close trade panel
          setShowTrade(false);
          break;
        case '1':
          setLayout({ panels: ['chart'], layout: 'full' });
          break;
        case '2':
          setLayout({ panels: ['chart', 'orderbook'], layout: 'split' });
          break;
        case '4':
          setLayout(DEFAULT_LAYOUT);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle order book price click
  const handlePriceClick = useCallback((price: number, side: 'buy' | 'sell') => {
    setPresetPrice(price);
    setTradeType(side);
    setShowTrade(true);
  }, []);

  // Render individual panel
  const renderPanel = (panel: Panel) => {
    switch (panel) {
      case 'chart':
        return (
          <div style={{ height: '100%', minHeight: 300 }}>
            <PriceChart
              offeringId={offeringId}
              height={300}
              showVolume={true}
              showMA={true}
            />
          </div>
        );
      case 'orderbook':
        return (
          <OrderBook
            offeringId={offeringId}
            onPriceClick={handlePriceClick}
            depth={10}
            showSpread={true}
          />
        );
      case 'tape':
        return (
          <TradeTape
            offeringId={offeringId}
            maxHeight={250}
            showHeader={true}
          />
        );
      case 'depth':
        return (
          <MarketDepth
            offeringId={offeringId}
            height={200}
          />
        );
      case 'trade':
        return (
          <TradePanel
            offeringId={offeringId}
            assetName={vehicleName}
            currentPrice={nbbo.lastTradePrice || nbbo.midPrice || 0}
            assetType="vehicle"
          />
        );
      case 'portfolio':
        return userId ? <Portfolio userId={userId} /> : null;
      default:
        return null;
    }
  };

  // Get grid layout style
  const getGridStyle = (): React.CSSProperties => {
    switch (layout.layout) {
      case 'full':
        return {
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr',
          gap: '8px',
          height: '100%',
        };
      case 'split':
        return {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          height: '100%',
        };
      case 'quad':
      default:
        return {
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: '8px',
          height: '100%',
        };
    }
  };

  return (
    <div
      style={{
        background: '#1a1a2e',
        minHeight: '100vh',
        padding: '12px',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* Terminal Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          marginBottom: '12px',
          background: '#16213e',
          borderRadius: '4px',
          border: '1px solid #0f3460',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Title */}
          <h1 style={{ margin: 0, fontSize: '14pt', fontWeight: 'bold', color: '#e5e7eb' }}>
            {vehicleName}
          </h1>

          {/* Current price */}
          {nbbo.lastTradePrice !== null && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span
                style={{
                  fontSize: '18pt',
                  fontWeight: 'bold',
                  color: '#10b981',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                ${nbbo.lastTradePrice.toFixed(2)}
              </span>
              {nbbo.spread !== null && (
                <span style={{ fontSize: '9pt', color: '#6b7280' }}>
                  Spread: ${nbbo.spread.toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Connection status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: isConnected ? '#10b981' : '#ef4444',
              }}
            />
            <span style={{ fontSize: '9pt', color: '#6b7280' }}>
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>

          {/* Layout toggles */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['full', 'split', 'quad'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLayout({
                  layout: l,
                  panels: l === 'full' ? ['chart'] : l === 'split' ? ['chart', 'orderbook'] : DEFAULT_LAYOUT.panels,
                })}
                style={{
                  padding: '4px 8px',
                  fontSize: '9pt',
                  border: '1px solid #0f3460',
                  borderRadius: '2px',
                  background: layout.layout === l ? '#0f3460' : 'transparent',
                  color: layout.layout === l ? '#e5e7eb' : '#6b7280',
                  cursor: 'pointer',
                }}
              >
                {l === 'full' ? '1' : l === 'split' ? '2' : '4'}
              </button>
            ))}
          </div>

          {/* Trade buttons */}
          <button
            onClick={() => { setTradeType('buy'); setShowTrade(true); }}
            style={{
              padding: '6px 16px',
              fontSize: '10pt',
              fontWeight: 600,
              border: 'none',
              borderRadius: '4px',
              background: '#10b981',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            BUY (B)
          </button>
          <button
            onClick={() => { setTradeType('sell'); setShowTrade(true); }}
            style={{
              padding: '6px 16px',
              fontSize: '10pt',
              fontWeight: 600,
              border: 'none',
              borderRadius: '4px',
              background: '#ef4444',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            SELL (S)
          </button>

          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '6px 12px',
                fontSize: '10pt',
                border: '1px solid #6b7280',
                borderRadius: '4px',
                background: 'transparent',
                color: '#6b7280',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          padding: '4px 12px',
          marginBottom: '8px',
          fontSize: '8pt',
          color: '#6b7280',
        }}
      >
        <span><kbd style={kbdStyle}>B</kbd> Buy</span>
        <span><kbd style={kbdStyle}>S</kbd> Sell</span>
        <span><kbd style={kbdStyle}>1</kbd> Chart only</span>
        <span><kbd style={kbdStyle}>2</kbd> Split view</span>
        <span><kbd style={kbdStyle}>4</kbd> Quad view</span>
        <span><kbd style={kbdStyle}>Esc</kbd> Close panel</span>
      </div>

      {/* Main content grid */}
      <div style={{ ...getGridStyle(), height: 'calc(100vh - 140px)' }}>
        {layout.panels.map((panel, index) => (
          <div key={`${panel}-${index}`}>
            {renderPanel(panel)}
          </div>
        ))}
      </div>

      {/* Trade Modal */}
      {showTrade && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowTrade(false)}
        >
          <div
            style={{
              width: '400px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <TradePanel
              offeringId={offeringId}
              assetName={vehicleName}
              currentPrice={presetPrice || nbbo.lastTradePrice || nbbo.midPrice || 0}
              assetType="vehicle"
              onClose={() => setShowTrade(false)}
              onTrade={() => {
                setShowTrade(false);
                setPresetPrice(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Last update timestamp */}
      {lastUpdate && (
        <div
          style={{
            position: 'fixed',
            bottom: '8px',
            right: '12px',
            fontSize: '8pt',
            color: '#6b7280',
          }}
        >
          Last update: {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 4px',
  borderRadius: '3px',
  border: '1px solid #4b5563',
  background: '#374151',
  fontFamily: 'monospace',
  fontSize: '8pt',
  marginRight: '4px',
};

export default TradingTerminal;
