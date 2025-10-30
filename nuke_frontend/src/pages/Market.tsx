import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';
import '../design-system.css';

interface MarketItem {
  id: string;
  type: 'vehicle' | 'organization';
  name: string;
  current_value: number;
  change_24h: number;
  change_pct_24h: number;
  volume_24h: number;
  market_cap: number;
}

interface PortfolioHolding {
  id: string;
  name: string;
  type: 'vehicle' | 'stake' | 'bond' | 'shares';
  invested: number;
  current_value: number;
  gain_loss: number;
  gain_loss_pct: number;
}

export default function Market() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Market data
  const [topGainers, setTopGainers] = useState<MarketItem[]>([]);
  const [topLosers, setTopLosers] = useState<MarketItem[]>([]);
  const [mostActive, setMostActive] = useState<MarketItem[]>([]);
  
  // Portfolio data
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [portfolioChange, setPortfolioChange] = useState(0);
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [cashBalance, setCashBalance] = useState(0);

  // Filter state from URL
  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [filterMake, setFilterMake] = useState<string | null>(null);
  const [filterModel, setFilterModel] = useState<string | null>(null);

  useEffect(() => {
    loadSession();
    
    // Parse URL parameters
    const year = searchParams.get('year');
    const make = searchParams.get('make');
    const model = searchParams.get('model');
    
    if (year) setFilterYear(parseInt(year));
    if (make) setFilterMake(make);
    if (model) setFilterModel(model);
  }, [searchParams]);

  useEffect(() => {
    if (session) {
      loadMarketData();
      loadPortfolioData();
    }
  }, [session, filterYear, filterMake, filterModel]);

  const loadSession = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    setSession(currentSession);
    setLoading(false);
  };

  const loadMarketData = async () => {
    try {
      // Get vehicles with price changes
      let query = supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, purchase_price, view_count, image_count')
        .not('current_value', 'is', null);

      // Apply filters if present
      if (filterYear) query = query.eq('year', filterYear);
      if (filterMake) query = query.ilike('make', filterMake);
      if (filterModel) query = query.ilike('model', filterModel);

      const { data: vehicles } = await query
        .order('current_value', { ascending: false })
        .limit(50);

      if (!vehicles) return;

      const marketItems: MarketItem[] = vehicles.map(v => {
        const change = (v.current_value && v.purchase_price) 
          ? v.current_value - v.purchase_price 
          : 0;
        const changePct = v.purchase_price 
          ? (change / v.purchase_price) * 100
          : 0;
        
        return {
          id: v.id,
          type: 'vehicle' as const,
          name: `${v.year} ${v.make} ${v.model}`,
          current_value: v.current_value || 0,
          change_24h: change,
          change_pct_24h: changePct,
          volume_24h: v.view_count || 0,
          market_cap: v.current_value || 0
        };
      });

      // Sort by performance
      const sorted = [...marketItems].sort((a, b) => b.change_pct_24h - a.change_pct_24h);
      setTopGainers(sorted.slice(0, 5));
      setTopLosers(sorted.slice(-5).reverse());
      setMostActive([...marketItems].sort((a, b) => b.volume_24h - a.volume_24h).slice(0, 5));

    } catch (error) {
      console.error('Error loading market data:', error);
    }
  };

  const loadPortfolioData = async () => {
    if (!session?.user) return;

    try {
      // Load cash
      const balance = await CashBalanceService.getUserBalance(session.user.id);
      setCashBalance(balance?.available_cents || 0);

      // Load owned vehicles (builder assets)
      const { data: ownedVehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, purchase_price')
        .eq('user_id', session.user.id);

      // Load stakes
      const { data: stakes } = await supabase
        .from('profit_share_stakes')
        .select(`
          id,
          amount_staked_cents,
          vehicle_funding_rounds!inner(
            vehicle_id,
            vehicles!inner(year, make, model, current_value)
          )
        `)
        .eq('staker_id', session.user.id);

      // Combine into portfolio
      const portfolioHoldings: PortfolioHolding[] = [];
      
      // Add owned vehicles
      if (ownedVehicles) {
        ownedVehicles.forEach(v => {
          const invested = v.purchase_price || 0;
          const current = v.current_value || 0;
          const gain = current - invested;
          const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
          
          portfolioHoldings.push({
            id: v.id,
            name: `${v.year} ${v.make} ${v.model}`,
            type: 'vehicle',
            invested,
            current_value: current,
            gain_loss: gain,
            gain_loss_pct: gainPct
          });
        });
      }

      // Add stakes
      if (stakes) {
        stakes.forEach((s: any) => {
          const invested = s.amount_staked_cents / 100;
          const vehicle = s.vehicle_funding_rounds?.vehicles;
          const current = (vehicle?.current_value || invested) * 0.1; // Stake = 10% of value
          const gain = current - invested;
          const gainPct = invested > 0 ? (gain / invested) * 100 : 0;
          
          portfolioHoldings.push({
            id: s.id,
            name: `${vehicle?.year} ${vehicle?.make} ${vehicle?.model}`,
            type: 'stake',
            invested,
            current_value: current,
            gain_loss: gain,
            gain_loss_pct: gainPct
          });
        });
      }

      setHoldings(portfolioHoldings);
      
      // Calculate total portfolio value
      const totalValue = portfolioHoldings.reduce((sum, h) => sum + h.current_value, 0);
      const totalGain = portfolioHoldings.reduce((sum, h) => sum + h.gain_loss, 0);
      setPortfolioValue(totalValue);
      setPortfolioChange(totalGain);

    } catch (error) {
      console.error('Error loading portfolio:', error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(value);
  };

  const formatChange = (value: number, pct: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${formatCurrency(value)} (${sign}${pct.toFixed(1)}%)`;
  };

  return (
    <div style={{ padding: 'var(--space-4)', background: '#f5f5f5', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Market Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1 style={{ fontSize: '18pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            Market
          </h1>
          <p style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
            Real-time performance · Vehicles · Organizations · ETFs
          </p>
        </div>

        {/* CASH BALANCE - HERO SECTION */}
        {cashBalance > 0 && (
          <div style={{
            background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
            border: '3px solid #000080',
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            color: '#ffffff',
            boxShadow: '4px 4px 0 rgba(0,0,0,0.2)'
          }}>
            <div style={{ fontSize: '9pt', marginBottom: '8px', opacity: 0.9 }}>
              Your Buying Power
            </div>
            <div style={{ fontSize: '32pt', fontWeight: 'bold', marginBottom: '8px' }}>
              {formatCurrency(cashBalance / 100)}
            </div>
            <div style={{ fontSize: '10pt', marginBottom: '16px' }}>
              Ready to invest · {mostActive.filter(v => (v.current_value / 1000) <= cashBalance / 100).length} vehicles available at this price
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  const affordable = mostActive.find(v => (v.current_value / 1000) <= cashBalance / 100);
                  if (affordable) navigate(`/vehicle/${affordable.id}`);
                }}
                style={{
                  background: '#00ff00',
                  color: '#000000',
                  border: '2px outset #ffffff',
                  padding: '8px 16px',
                  fontSize: '9pt',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                INVEST NOW
              </button>
              <button
                onClick={() => alert('Add funds coming soon via Stripe')}
                style={{
                  background: 'transparent',
                  color: '#ffffff',
                  border: '2px outset #ffffff',
                  padding: '8px 16px',
                  fontSize: '9pt',
                  cursor: 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                Add More Funds
              </button>
            </div>
          </div>
        )}

        {/* Market Stats Bar */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)'
        }}>
          {/* Portfolio Value */}
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Your Portfolio
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>
              {formatCurrency(portfolioValue)}
            </div>
            <div style={{
              fontSize: '9pt',
              color: portfolioChange >= 0 ? '#008000' : '#800000',
              marginTop: '2px'
            }}>
              {portfolioChange >= 0 ? '↑' : '↓'} {Math.abs(portfolioChange).toLocaleString()} today
            </div>
          </div>

          {/* Cash Balance */}
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Buying Power
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>
              {formatCurrency(cashBalance / 100)}
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '2px' }}>
              Available to invest
            </div>
          </div>

          {/* Holdings Count */}
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Holdings
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>
              {holdings.length} positions
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '2px' }}>
              {holdings.filter(h => h.gain_loss > 0).length} profitable
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)' }}>
          {/* Left Column: Market Movers */}
          <div>
            {/* Top Gainers */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)', color: '#008000' }}>
                Top Gainers
              </h2>
              <div style={{ background: 'var(--white)', border: '2px solid var(--border)' }}>
                {topGainers.map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/${item.type}/${item.id}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '30px 2fr 1fr 1fr',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-2)',
                      borderBottom: idx < topGainers.length - 1 ? '1px solid var(--border-light)' : 'none',
                      cursor: 'pointer',
                      fontSize: '9pt',
                      alignItems: 'center'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>
                      {idx + 1}
                    </div>
                    <div style={{ fontWeight: 'bold' }}>
                      {item.name}
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {item.type === 'vehicle' ? 'Vehicle' : 'Organization'}
                      </div>
                    </div>
                    <div style={{ fontWeight: 'bold', textAlign: 'right' }}>
                      {formatCurrency(item.current_value)}
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      textAlign: 'right',
                      color: item.change_pct_24h >= 0 ? '#008000' : '#800000'
                    }}>
                      {item.change_pct_24h >= 0 ? '↑' : '↓'} {Math.abs(item.change_pct_24h).toFixed(1)}%
                    </div>
                  </div>
                ))}
                {topGainers.length === 0 && (
                  <div style={{ padding: 'var(--space-4)', textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)' }}>
                    No market data available
                  </div>
                )}
              </div>
            </div>

            {/* Top Losers */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)', color: '#800000' }}>
                Top Losers
              </h2>
              <div style={{ background: 'var(--white)', border: '2px solid var(--border)' }}>
                {topLosers.map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/${item.type}/${item.id}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '30px 2fr 1fr 1fr',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-2)',
                      borderBottom: idx < topLosers.length - 1 ? '1px solid var(--border-light)' : 'none',
                      cursor: 'pointer',
                      fontSize: '9pt',
                      alignItems: 'center'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>
                      {idx + 1}
                    </div>
                    <div style={{ fontWeight: 'bold' }}>
                      {item.name}
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {item.type === 'vehicle' ? 'Vehicle' : 'Organization'}
                      </div>
                    </div>
                    <div style={{ fontWeight: 'bold', textAlign: 'right' }}>
                      {formatCurrency(item.current_value)}
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      textAlign: 'right',
                      color: item.change_pct_24h >= 0 ? '#008000' : '#800000'
                    }}>
                      {item.change_pct_24h >= 0 ? '↑' : '↓'} {Math.abs(item.change_pct_24h).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Most Active */}
            <div>
              <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                Most Active
              </h2>
              <div style={{ background: 'var(--white)', border: '2px solid var(--border)' }}>
                {mostActive.map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/${item.type}/${item.id}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '30px 2fr 1fr 1fr',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-2)',
                      borderBottom: idx < mostActive.length - 1 ? '1px solid var(--border-light)' : 'none',
                      cursor: 'pointer',
                      fontSize: '9pt',
                      alignItems: 'center'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>
                      {idx + 1}
                    </div>
                    <div style={{ fontWeight: 'bold' }}>
                      {item.name}
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {item.volume_24h} views
                      </div>
                    </div>
                    <div style={{ fontWeight: 'bold', textAlign: 'right' }}>
                      {formatCurrency(item.current_value)}
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      textAlign: 'right',
                      color: item.change_pct_24h >= 0 ? '#008000' : '#800000'
                    }}>
                      {item.change_pct_24h >= 0 ? '↑' : '↓'} {Math.abs(item.change_pct_24h).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Your Portfolio */}
          <div>
            {/* Portfolio Summary */}
            <div style={{
              background: portfolioChange >= 0 ? '#f0fdf4' : '#fef2f2',
              border: `2px solid ${portfolioChange >= 0 ? '#008000' : '#800000'}`,
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-3)'
            }}>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Total Portfolio Value
              </div>
              <div style={{ fontSize: '18pt', fontWeight: 'bold', marginBottom: '8px' }}>
                {formatCurrency(portfolioValue + cashBalance / 100)}
              </div>
              <div style={{
                fontSize: '10pt',
                fontWeight: 'bold',
                color: portfolioChange >= 0 ? '#008000' : '#800000'
              }}>
                {portfolioChange >= 0 ? '↑' : '↓'} {formatCurrency(Math.abs(portfolioChange))} today
              </div>
              <div style={{
                marginTop: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-light)',
                fontSize: '8pt',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px'
              }}>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Invested</div>
                  <div style={{ fontWeight: 'bold' }}>
                    {formatCurrency(portfolioValue - portfolioChange)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Cash</div>
                  <div style={{ fontWeight: 'bold' }}>
                    {formatCurrency(cashBalance / 100)}
                  </div>
                </div>
              </div>
            </div>

            {/* Holdings List */}
            <h3 style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
              Your Holdings ({holdings.length})
            </h3>
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {holdings.map(holding => (
                <div
                  key={holding.id}
                  onClick={() => navigate(`/vehicle/${holding.id}`)}
                  style={{
                    background: 'var(--white)',
                    border: '1px solid var(--border-light)',
                    padding: 'var(--space-2)',
                    marginBottom: 'var(--space-1)',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--text)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-light)'}
                >
                  <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                    {holding.name}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '8pt' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Type</div>
                      <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                        {holding.type}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: 'var(--text-muted)' }}>Value</div>
                      <div style={{ fontWeight: 'bold' }}>
                        {formatCurrency(holding.current_value)}
                      </div>
                    </div>
                  </div>
                  <div style={{
                    marginTop: '4px',
                    paddingTop: '4px',
                    borderTop: '1px solid var(--border-light)',
                    fontSize: '8pt',
                    fontWeight: 'bold',
                    textAlign: 'right',
                    color: holding.gain_loss >= 0 ? '#008000' : '#800000'
                  }}>
                    {formatChange(holding.gain_loss, holding.gain_loss_pct)}
                  </div>
                </div>
              ))}
              {holdings.length === 0 && (
                <div style={{
                  background: 'var(--white)',
                  border: '1px solid var(--border-light)',
                  padding: 'var(--space-4)',
                  textAlign: 'center',
                  fontSize: '8pt',
                  color: 'var(--text-muted)'
                }}>
                  No investments yet
                  <br />
                  <button
                    onClick={() => navigate('/')}
                    style={{
                      marginTop: 'var(--space-2)',
                      background: 'var(--text)',
                      color: 'var(--white)',
                      border: 'none',
                      padding: 'var(--space-1) var(--space-2)',
                      fontSize: '8pt',
                      cursor: 'pointer'
                    }}
                  >
                    Browse Vehicles
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {loading && (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)' }}>
            Loading market data...
          </div>
        )}
      </div>
    </div>
  );
}
