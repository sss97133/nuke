import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';
import '../design-system.css';

interface Vehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  current_value?: number;
  is_for_sale?: boolean;
}

interface ShareHolding {
  offering_id: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  shares_owned: number;
  unrealized_gain_loss: number;
}

interface Stake {
  id: string;
  vehicle_id: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  amount_cents: number;
  status: string;
}

type TabType = 'browse' | 'portfolio' | 'builder';

export default function Market() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Browse data
  const [investableVehicles, setInvestableVehicles] = useState<Vehicle[]>([]);
  
  // Portfolio data
  const [cashBalance, setCashBalance] = useState<any>(null);
  const [holdings, setHoldings] = useState<ShareHolding[]>([]);
  const [stakes, setStakes] = useState<Stake[]>([]);
  
  // Builder data
  const [myVehicles, setMyVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (session) {
      loadData();
    }
  }, [session, activeTab]);

  const loadSession = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    setSession(currentSession);
    if (!currentSession) {
      navigate('/login');
    }
  };

  const loadData = async () => {
    if (!session?.user) return;
    
    setLoading(true);
    try {
      if (activeTab === 'browse') {
        await loadInvestableVehicles();
      } else if (activeTab === 'portfolio') {
        await loadPortfolio();
      } else if (activeTab === 'builder') {
        await loadBuilderData();
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadInvestableVehicles = async () => {
    // Load vehicles available for investment
    const { data } = await supabase
      .from('vehicles')
      .select('id, year, make, model, current_value, is_for_sale')
      .eq('is_for_sale', true)
      .order('created_at', { ascending: false })
      .limit(20);
    
    setInvestableVehicles(data || []);
  };

  const loadPortfolio = async () => {
    if (!session?.user) return;

    // Load cash balance
    const balance = await CashBalanceService.getUserBalance(session.user.id);
    setCashBalance(balance);

    // Load share holdings
    const { data: holdingsData } = await supabase
      .from('share_holdings')
      .select(`
        offering_id,
        shares_owned,
        unrealized_gain_loss,
        vehicle_offerings!inner(
          vehicle_id,
          vehicles!inner(year, make, model)
        )
      `)
      .eq('holder_id', session.user.id);

    if (holdingsData) {
      setHoldings(holdingsData.map((h: any) => ({
        offering_id: h.offering_id,
        vehicle_year: h.vehicle_offerings?.vehicles?.year,
        vehicle_make: h.vehicle_offerings?.vehicles?.make,
        vehicle_model: h.vehicle_offerings?.vehicles?.model,
        shares_owned: h.shares_owned,
        unrealized_gain_loss: h.unrealized_gain_loss
      })));
    }

    // Load stakes
    const { data: stakesData } = await supabase
      .from('profit_share_stakes')
      .select(`
        id,
        amount_staked_cents,
        status,
        funding_round_id,
        vehicle_funding_rounds!inner(
          vehicle_id,
          vehicles!inner(year, make, model)
        )
      `)
      .eq('staker_id', session.user.id);

    if (stakesData) {
      setStakes(stakesData.map((s: any) => ({
        id: s.id,
        vehicle_id: s.vehicle_funding_rounds?.vehicle_id,
        vehicle_year: s.vehicle_funding_rounds?.vehicles?.year,
        vehicle_make: s.vehicle_funding_rounds?.vehicles?.make,
        vehicle_model: s.vehicle_funding_rounds?.vehicles?.model,
        amount_cents: s.amount_staked_cents,
        status: s.status
      })));
    }
  };

  const loadBuilderData = async () => {
    if (!session?.user) return;

    // Load user's vehicles
    const { data } = await supabase
      .from('vehicles')
      .select('id, year, make, model, current_value, is_for_sale')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    setMyVehicles(data || []);
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(cents / 100);
  };

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Page Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1 style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
            Vehicle Market
          </h1>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Invest in vehicles, track your portfolio, and manage your builds
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-1)',
          borderBottom: '1px solid var(--border-light)',
          marginBottom: 'var(--space-4)'
        }}>
          <button
            onClick={() => setActiveTab('browse')}
            style={{
              background: activeTab === 'browse' ? 'var(--grey-200)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'browse' ? '2px solid var(--text)' : '2px solid transparent',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: '8pt',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif'
            }}
          >
            Browse Investments
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            style={{
              background: activeTab === 'portfolio' ? 'var(--grey-200)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'portfolio' ? '2px solid var(--text)' : '2px solid transparent',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: '8pt',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif'
            }}
          >
            Your Portfolio
          </button>
          <button
            onClick={() => setActiveTab('builder')}
            style={{
              background: activeTab === 'builder' ? 'var(--grey-200)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'builder' ? '2px solid var(--text)' : '2px solid transparent',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: '8pt',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif'
            }}
          >
            Builder Dashboard
          </button>
        </div>

        {/* Tab Content */}
        {loading ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', fontSize: '8pt' }}>
            Loading...
          </div>
        ) : (
          <>
            {/* Browse Tab */}
            {activeTab === 'browse' && (
              <div>
                {/* Critical Legal Disclaimer */}
                <div style={{
                  background: '#fff3cd',
                  border: '2px solid #ff9800',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-3)',
                  fontSize: '8pt'
                }}>
                  <strong>⚠️ INVESTMENT RISK WARNING</strong>
                  <br />
                  These are NOT securities. You can lose money. Read{' '}
                  <a href="/legal" style={{ color: '#000', textDecoration: 'underline' }}>LEGAL.md</a>
                  {' '}before investing.
                </div>

                <div style={{
                  background: 'var(--grey-100)',
                  border: '1px solid var(--border-light)',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-3)',
                  fontSize: '8pt'
                }}>
                  <strong>Investment Products:</strong> Profit-Sharing Stakes • Tradeable Shares • Fixed-Rate Bonds • Whole Vehicle Purchase
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>
                    Profit-sharing agreements backed by real vehicles. Not FDIC insured.
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'var(--space-3)'
                }}>
                  {investableVehicles.map(vehicle => (
                    <div
                      key={vehicle.id}
                      onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                      style={{
                        background: 'var(--white)',
                        border: '2px solid var(--border-medium)',
                        padding: 'var(--space-3)',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--text)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-medium)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      {vehicle.current_value && (
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          Value: {formatCurrency(vehicle.current_value)}
                        </div>
                      )}
                      <div style={{
                        marginTop: 'var(--space-2)',
                        padding: 'var(--space-1) var(--space-2)',
                        background: 'var(--grey-100)',
                        fontSize: '8pt',
                        textAlign: 'center'
                      }}>
                        View Investment Options →
                      </div>
                    </div>
                  ))}
                </div>

                {investableVehicles.length === 0 && (
                  <div style={{ padding: 'var(--space-8)', textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)' }}>
                    No vehicles currently available for investment. Check back soon!
                  </div>
                )}
              </div>
            )}

            {/* Portfolio Tab */}
            {activeTab === 'portfolio' && (
              <div>
                {/* Cash Balance */}
                <div style={{
                  background: 'var(--white)',
                  border: '2px solid var(--border-medium)',
                  padding: 'var(--space-3)',
                  marginBottom: 'var(--space-3)'
                }}>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
                    Available Cash
                  </div>
                  <div style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                    {cashBalance ? formatCurrency(cashBalance.balance_cents) : '$0'}
                  </div>
                </div>

                {/* Holdings */}
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <h2 style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                    Share Holdings ({holdings.length})
                  </h2>
                  {holdings.map(holding => (
                    <div
                      key={holding.offering_id}
                      style={{
                        background: 'var(--white)',
                        border: '1px solid var(--border-light)',
                        padding: 'var(--space-2)',
                        marginBottom: 'var(--space-1)',
                        fontSize: '8pt'
                      }}
                    >
                      <div style={{ fontWeight: 'bold' }}>
                        {holding.vehicle_year} {holding.vehicle_make} {holding.vehicle_model}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                        <span>Shares: {holding.shares_owned}</span>
                        <span style={{ color: holding.unrealized_gain_loss >= 0 ? 'green' : 'red' }}>
                          {formatCurrency(holding.unrealized_gain_loss)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stakes */}
                <div>
                  <h2 style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                    Active Stakes ({stakes.length})
                  </h2>
                  {stakes.map(stake => (
                    <div
                      key={stake.id}
                      style={{
                        background: 'var(--white)',
                        border: '1px solid var(--border-light)',
                        padding: 'var(--space-2)',
                        marginBottom: 'var(--space-1)',
                        fontSize: '8pt'
                      }}
                    >
                      <div style={{ fontWeight: 'bold' }}>
                        {stake.vehicle_year} {stake.vehicle_make} {stake.vehicle_model}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                        <span>Amount: {formatCurrency(stake.amount_cents)}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{stake.status}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {holdings.length === 0 && stakes.length === 0 && (
                  <div style={{ padding: 'var(--space-8)', textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)' }}>
                    No investments yet. Browse vehicles to get started!
                  </div>
                )}
              </div>
            )}

            {/* Builder Tab */}
            {activeTab === 'builder' && (
              <div>
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <button
                    onClick={() => navigate('/add-vehicle')}
                    style={{
                      background: 'var(--text)',
                      color: 'var(--white)',
                      border: '2px solid var(--text)',
                      padding: 'var(--space-2) var(--space-3)',
                      fontSize: '8pt',
                      cursor: 'pointer',
                      transition: 'all 0.12s ease'
                    }}
                  >
                    Add New Vehicle
                  </button>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'var(--space-3)'
                }}>
                  {myVehicles.map(vehicle => (
                    <div
                      key={vehicle.id}
                      onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                      style={{
                        background: 'var(--white)',
                        border: '2px solid var(--border-medium)',
                        padding: 'var(--space-3)',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      {vehicle.current_value && (
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          Value: {formatCurrency(vehicle.current_value)}
                        </div>
                      )}
                      <div style={{
                        marginTop: 'var(--space-2)',
                        padding: 'var(--space-1)',
                        background: vehicle.is_for_sale ? 'var(--grey-100)' : 'transparent',
                        fontSize: '8pt',
                        textAlign: 'center'
                      }}>
                        {vehicle.is_for_sale ? 'Listed for Sale' : 'Manage →'}
                      </div>
                    </div>
                  ))}
                </div>

                {myVehicles.length === 0 && (
                  <div style={{ padding: 'var(--space-8)', textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)' }}>
                    You haven't added any vehicles yet. Add your first vehicle to start raising funds!
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

