import React, { useState } from 'react';
import MarketTicker from '../trading/MarketTicker';
import OrderBook from '../trading/OrderBook';
import Portfolio from '../trading/Portfolio';
import Leaderboard from '../trading/Leaderboard';
import '../../design-system.css';

interface VehicleProfileTradingProps {
  vehicleId: string;
  vehicleTitle: string;
  userId?: string;
}

type TradingTab = 'ticker' | 'orderbook' | 'portfolio' | 'leaderboard';

const VehicleProfileTrading: React.FC<VehicleProfileTradingProps> = ({
  vehicleId,
  vehicleTitle,
  userId
}) => {
  const [activeTab, setActiveTab] = useState<TradingTab>('ticker');

  return (
    <div className="card">
      <div className="card-header">Trading</div>
      <div className="card-body">
      {/* Trading Tabs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '6px',
          marginBottom: '12px'
      }}>
        <button
          onClick={() => setActiveTab('ticker')}
          style={{
              padding: '8px',
              background: activeTab === 'ticker' ? 'var(--accent)' : 'var(--surface-hover)',
              color: activeTab === 'ticker' ? 'white' : 'var(--text)',
              border: '2px solid var(--border)',
            borderRadius: '2px',
              fontSize: '8pt',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'ticker') {
                e.currentTarget.style.background = 'var(--surface-active)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'ticker') {
                e.currentTarget.style.background = 'var(--surface-hover)';
            }
          }}
        >
            Price
        </button>

        <button
          onClick={() => setActiveTab('orderbook')}
          style={{
              padding: '8px',
              background: activeTab === 'orderbook' ? 'var(--accent)' : 'var(--surface-hover)',
              color: activeTab === 'orderbook' ? 'white' : 'var(--text)',
              border: '2px solid var(--border)',
            borderRadius: '2px',
              fontSize: '8pt',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'orderbook') {
                e.currentTarget.style.background = 'var(--surface-active)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'orderbook') {
                e.currentTarget.style.background = 'var(--surface-hover)';
            }
          }}
        >
            Orders
        </button>

        <button
          onClick={() => setActiveTab('portfolio')}
          style={{
              padding: '8px',
              background: activeTab === 'portfolio' ? 'var(--accent)' : 'var(--surface-hover)',
              color: activeTab === 'portfolio' ? 'white' : 'var(--text)',
              border: '2px solid var(--border)',
            borderRadius: '2px',
              fontSize: '8pt',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'portfolio') {
                e.currentTarget.style.background = 'var(--surface-active)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'portfolio') {
                e.currentTarget.style.background = 'var(--surface-hover)';
            }
          }}
        >
            Portfolio
        </button>

        <button
          onClick={() => setActiveTab('leaderboard')}
          style={{
              padding: '8px',
              background: activeTab === 'leaderboard' ? 'var(--accent)' : 'var(--surface-hover)',
              color: activeTab === 'leaderboard' ? 'white' : 'var(--text)',
              border: '2px solid var(--border)',
            borderRadius: '2px',
              fontSize: '8pt',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'leaderboard') {
                e.currentTarget.style.background = 'var(--surface-active)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'leaderboard') {
                e.currentTarget.style.background = 'var(--surface-hover)';
            }
          }}
        >
            Leaders
        </button>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'ticker' && (
          <MarketTicker
            offeringId={vehicleId}
            vehicleTitle={vehicleTitle}
            onTrade={() => setActiveTab('portfolio')}
          />
        )}

        {activeTab === 'orderbook' && (
          <OrderBook offeringId={vehicleId} />
        )}

        {activeTab === 'portfolio' && userId && (
          <Portfolio userId={userId} />
        )}

        {activeTab === 'leaderboard' && (
          <Leaderboard userId={userId} />
        )}

        {activeTab === 'portfolio' && !userId && (
          <div style={{
            textAlign: 'center',
            padding: '24px',
            color: '#6b7280',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '2px'
          }}>
            Sign in to view your portfolio
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default VehicleProfileTrading;
