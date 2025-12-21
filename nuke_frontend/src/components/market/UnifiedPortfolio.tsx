import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MarketSystemIntegration, UserHolding } from '../../services/marketSystemIntegration';
import { supabase } from '../../lib/supabase';

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatPct = (value: number) => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'etf': return '📊';
    case 'vehicle_shares': return '🚗';
    case 'vehicle_stake': return '💰';
    case 'vehicle_bond': return '🏦';
    default: return '💼';
  }
};

const getTypeName = (type: string) => {
  switch (type) {
    case 'etf': return 'ETF';
    case 'vehicle_shares': return 'Vehicle Shares';
    case 'vehicle_stake': return 'Profit Stake';
    case 'vehicle_bond': return 'Bond';
    default: return 'Investment';
  }
};

export default function UnifiedPortfolio() {
  const navigate = useNavigate();
  const [holdings, setHoldings] = useState<UserHolding[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('all');

  useEffect(() => {
    loadPortfolio();
  }, []);

  const loadPortfolio = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      const marketData = await MarketSystemIntegration.getUnifiedMarketData(user.id);
      setHoldings(marketData.holdings);
      setCashBalance(marketData.cash_balance / 100); // Convert from cents
    } catch (e: any) {
      console.error('Failed to load portfolio:', e);
      setError(e?.message || 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  };

  const filteredHoldings = holdings.filter(holding => 
    selectedType === 'all' || holding.type === selectedType
  );

  const totalPortfolioValue = holdings.reduce((sum, h) => sum + h.market_value, 0) + cashBalance;
  const totalUnrealizedGainLoss = holdings.reduce((sum, h) => sum + h.unrealized_gain_loss, 0);
  const totalUnrealizedPct = totalPortfolioValue > 0 ? (totalUnrealizedGainLoss / (totalPortfolioValue - totalUnrealizedGainLoss)) * 100 : 0;

  const holdingsByType = holdings.reduce((acc, holding) => {
    acc[holding.type] = (acc[holding.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading portfolio...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '16pt', fontWeight: 900 }}>Portfolio</h1>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              Your complete investment portfolio across all products
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/dashboard')}>
              Market
            </button>
            <button className="button button-primary" onClick={() => navigate('/market/exchange')}>
              Trade
            </button>
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: '16px', padding: '12px', border: '2px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ fontWeight: 800, marginBottom: '6px' }}>Error</div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{error}</div>
          </div>
        )}

        {/* Portfolio Overview */}
        <div style={{ marginBottom: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Total Value</h3>
            </div>
            <div className="card-body">
              <div style={{ fontSize: '20pt', fontWeight: 900 }}>{formatUSD(totalPortfolioValue)}</div>
              <div style={{ 
                fontSize: '9pt', 
                color: totalUnrealizedGainLoss >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                marginTop: '4px' 
              }}>
                {formatPct(totalUnrealizedPct)} unrealized
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Cash Balance</h3>
            </div>
            <div className="card-body">
              <div style={{ fontSize: '20pt', fontWeight: 900 }}>{formatUSD(cashBalance)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Available to invest</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Total Positions</h3>
            </div>
            <div className="card-body">
              <div style={{ fontSize: '20pt', fontWeight: 900 }}>{holdings.length}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Across {Object.keys(holdingsByType).length} product types</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Unrealized P&L</h3>
            </div>
            <div className="card-body">
              <div style={{ 
                fontSize: '20pt', 
                fontWeight: 900,
                color: totalUnrealizedGainLoss >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'
              }}>
                {formatUSD(totalUnrealizedGainLoss)}
              </div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                {formatPct(totalUnrealizedPct)}
              </div>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setSelectedType('all')}
            style={{
              padding: '8px 16px',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              background: selectedType === 'all' ? 'var(--primary)' : 'var(--white)',
              color: selectedType === 'all' ? 'var(--white)' : 'var(--text)',
              fontWeight: selectedType === 'all' ? 800 : 400,
              cursor: 'pointer'
            }}
          >
            All ({holdings.length})
          </button>
          {Object.entries(holdingsByType).map(([type, count]) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              style={{
                padding: '8px 16px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: selectedType === type ? 'var(--primary)' : 'var(--white)',
                color: selectedType === type ? 'var(--white)' : 'var(--text)',
                fontWeight: selectedType === type ? 800 : 400,
                cursor: 'pointer'
              }}
            >
              {getTypeIcon(type)} {getTypeName(type)} ({count})
            </button>
          ))}
        </div>

        {/* Holdings List */}
        {filteredHoldings.length === 0 ? (
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center', padding: '48px' }}>
              <div style={{ fontSize: '24pt', marginBottom: '16px' }}>📊</div>
              <div style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '8px' }}>No investments yet</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Start building your portfolio by investing in ETFs or individual vehicles
              </div>
              <button className="button button-primary" onClick={() => navigate('/market/dashboard')}>
                Browse Investments
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '12px' }}>
            {filteredHoldings.map((holding) => (
              <div key={holding.id} className="card">
                <div className="card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12pt' }}>{getTypeIcon(holding.type)}</span>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '11pt' }}>{holding.symbol}</div>
                          <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>{getTypeName(holding.type)}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                        {holding.name}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: '120px' }}>
                      <div style={{ fontWeight: 900, fontSize: '11pt' }}>
                        {formatUSD(holding.market_value)}
                      </div>
                      <div style={{ 
                        fontSize: '9pt', 
                        color: holding.unrealized_gain_loss >= 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
                        marginTop: '2px'
                      }}>
                        {formatUSD(holding.unrealized_gain_loss)} ({formatPct(holding.unrealized_gain_loss_pct)})
                      </div>
                    </div>
                  </div>

                  <div style={{ 
                    marginTop: '12px', 
                    paddingTop: '12px', 
                    borderTop: '1px solid var(--border)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                    gap: '12px',
                    fontSize: '9pt'
                  }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Quantity</div>
                      <div style={{ fontWeight: 700 }}>{holding.quantity.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Entry Price</div>
                      <div style={{ fontWeight: 700 }}>{formatUSD(holding.entry_price)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Current Price</div>
                      <div style={{ fontWeight: 700 }}>{formatUSD(holding.current_price)}</div>
                    </div>
                    <div>
                      <button 
                        className="button button-secondary" 
                        style={{ width: '100%', padding: '6px 12px', fontSize: '8pt' }}
                        onClick={() => {
                          if (holding.type === 'etf') {
                            navigate(`/market/exchange/${holding.symbol}`);
                          } else if (holding.type === 'vehicle_shares') {
                            // Navigate to vehicle trading page
                            navigate(`/vehicle/${holding.id}`); // TODO: extract vehicle ID
                          } else {
                            navigate(`/vehicle/${holding.id}`); // TODO: extract vehicle ID
                          }
                        }}
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick Actions */}
        {holdings.length > 0 && (
          <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="button button-secondary" onClick={() => navigate('/market/exchange')}>
              Trade ETFs
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market/dashboard')}>
              Browse Market
            </button>
            <button className="button button-primary" onClick={loadPortfolio}>
              Refresh Portfolio
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
