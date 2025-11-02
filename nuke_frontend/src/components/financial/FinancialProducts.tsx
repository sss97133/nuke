import React, { useState } from 'react';
import TradePanel from '../trading/TradePanel';
import BondInvestment from './BondInvestment';
import StakeOnVehicle from './StakeOnVehicle';
import BuyWholeVehicle from './BuyWholeVehicle';

interface FinancialProductsProps {
  vehicleId: string;
  vehicleName: string;
  vehicleValue: number;
}

export default function FinancialProducts({ vehicleId, vehicleName, vehicleValue }: FinancialProductsProps) {
  // HIDDEN: Financial products not ready for production
  // Bonds, stakes, and whole vehicle purchase are in development
  // Trading shares is handled by MobileTradingPanel in mobile view
  return null;

  const [activeTab, setActiveTab] = useState<'shares' | 'bonds' | 'stakes' | 'whole'>('stakes');

  const tabs = [
    { id: 'stakes', label: '💰 Stakes', desc: 'Earn profit %' },
    { id: 'shares', label: '📊 Shares', desc: 'Trade' },
    { id: 'bonds', label: '🏦 Bonds', desc: 'Fixed return' },
    { id: 'whole', label: '🚗 Whole', desc: 'Own 100%' }
  ];

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '4px',
      overflow: 'hidden'
    }}>
      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '2px solid var(--border)',
        overflowX: 'auto'
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              flex: 1,
              minWidth: '120px',
              padding: '8px 12px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : 'none',
              background: activeTab === tab.id ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text)',
              fontSize: '9px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: '0.12s',
              textAlign: 'center'
            }}
          >
            <div>{tab.label}</div>
            <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {tab.desc}
            </div>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '12px' }}>
        {activeTab === 'shares' && (
          <TradePanel
            vehicleId={vehicleId}
            vehicleName={vehicleName}
            currentSharePrice={vehicleValue / 1000}
            totalShares={1000}
          />
        )}

        {activeTab === 'bonds' && (
          <BondInvestment
            vehicleId={vehicleId}
            vehicleName={vehicleName}
          />
        )}

        {activeTab === 'stakes' && (
          <StakeOnVehicle
            vehicleId={vehicleId}
            vehicleName={vehicleName}
            vehicleValue={vehicleValue}
          />
        )}

        {activeTab === 'whole' && (
          <BuyWholeVehicle
            vehicleId={vehicleId}
            vehicleName={vehicleName}
            vehicleValue={vehicleValue}
          />
        )}
      </div>
    </div>
  );
}

