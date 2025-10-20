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
    <div style={{
      background: 'white',
      border: '2px solid #bdbdbd',
      borderRadius: '4px',
      padding: '16px',
      marginTop: '16px'
    }}>
      {/* Trading Tabs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '8px',
        marginBottom: '16px'
      }}>
        <button
          onClick={() => setActiveTab('ticker')}
          style={{
            padding: '10px',
            background: activeTab === 'ticker' ? '#3b82f6' : '#e5e7eb',
            color: activeTab === 'ticker' ? 'white' : '#1f2937',
            border: '2px solid #bdbdbd',
            borderRadius: '2px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'ticker') {
              e.currentTarget.style.background = '#d1d5db';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'ticker') {
              e.currentTarget.style.background = '#e5e7eb';
            }
          }}
        >
          📊 Price Ticker
        </button>

        <button
          onClick={() => setActiveTab('orderbook')}
          style={{
            padding: '10px',
            background: activeTab === 'orderbook' ? '#3b82f6' : '#e5e7eb',
            color: activeTab === 'orderbook' ? 'white' : '#1f2937',
            border: '2px solid #bdbdbd',
            borderRadius: '2px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'orderbook') {
              e.currentTarget.style.background = '#d1d5db';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'orderbook') {
              e.currentTarget.style.background = '#e5e7eb';
            }
          }}
        >
          📈 Order Book
        </button>

        <button
          onClick={() => setActiveTab('portfolio')}
          style={{
            padding: '10px',
            background: activeTab === 'portfolio' ? '#3b82f6' : '#e5e7eb',
            color: activeTab === 'portfolio' ? 'white' : '#1f2937',
            border: '2px solid #bdbdbd',
            borderRadius: '2px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'portfolio') {
              e.currentTarget.style.background = '#d1d5db';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'portfolio') {
              e.currentTarget.style.background = '#e5e7eb';
            }
          }}
        >
          💼 Portfolio
        </button>

        <button
          onClick={() => setActiveTab('leaderboard')}
          style={{
            padding: '10px',
            background: activeTab === 'leaderboard' ? '#3b82f6' : '#e5e7eb',
            color: activeTab === 'leaderboard' ? 'white' : '#1f2937',
            border: '2px solid #bdbdbd',
            borderRadius: '2px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'leaderboard') {
              e.currentTarget.style.background = '#d1d5db';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'leaderboard') {
              e.currentTarget.style.background = '#e5e7eb';
            }
          }}
        >
          🏆 Leaderboard
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
  );
};

export default VehicleProfileTrading;
