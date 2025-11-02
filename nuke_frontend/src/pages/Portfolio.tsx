import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService, CashTransaction } from '../services/cashBalanceService';
import CashBalance from '../components/trading/CashBalance';

interface ShareHolding {
  offering_id: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  shares_owned: number;
  entry_price: number;
  current_mark: number;
  unrealized_gain_loss: number;
  unrealized_gain_loss_pct: number;
}

interface Stake {
  id: string;
  vehicle_id: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  amount_cents: number;
  profit_share_pct: number;
  status: string;
  created_at: string;
}

interface Bond {
  id: string;
  vehicle_id: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  principal_cents: number;
  interest_rate: number;
  term_months: number;
  maturity_date: string;
  accrued_interest_cents: number;
  status: string;
}

interface OwnedVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  current_value: number | null;
  vin: string | null;
  image_url: string | null;
}

interface OrgHolding {
  offering_id: string;
  organization_name: string;
  stock_symbol: string;
  shares_owned: number;
  entry_price: number;
  current_mark: number;
  unrealized_gain_loss: number;
  unrealized_gain_loss_pct: number;
}

export default function Portfolio() {
  const navigate = useNavigate();
  const [cashBalance, setCashBalance] = useState<any>(null);
  const [holdings, setHoldings] = useState<ShareHolding[]>([]);
  const [orgHoldings, setOrgHoldings] = useState<OrgHolding[]>([]);
  const [stakes, setStakes] = useState<Stake[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [ownedVehicles, setOwnedVehicles] = useState<OwnedVehicle[]>([]);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'cash' | 'shares' | 'orgs' | 'stakes' | 'bonds' | 'vehicles'>('overview');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      // Load cash balance
      const balance = await CashBalanceService.getUserBalance(user.id);
      setCashBalance(balance);

      // Load vehicle share holdings
      const { data: holdingsData, error: holdingsError } = await supabase
        .from('share_holdings')
        .select(`
          offering_id,
          shares_owned,
          entry_price,
          current_mark,
          unrealized_gain_loss,
          unrealized_gain_loss_pct,
          vehicle_offerings!inner(
            vehicle_id,
            vehicles!inner(
              year,
              make,
              model
            )
          )
        `)
        .eq('holder_id', user.id)
        .order('unrealized_gain_loss', { ascending: false });

      if (!holdingsError && holdingsData) {
        const formattedHoldings = holdingsData.map((h: any) => ({
          offering_id: h.offering_id,
          vehicle_year: h.vehicle_offerings?.vehicles?.year,
          vehicle_make: h.vehicle_offerings?.vehicles?.make,
          vehicle_model: h.vehicle_offerings?.vehicles?.model,
          shares_owned: h.shares_owned,
          entry_price: h.entry_price,
          current_mark: h.current_mark,
          unrealized_gain_loss: h.unrealized_gain_loss,
          unrealized_gain_loss_pct: h.unrealized_gain_loss_pct
        }));
        setHoldings(formattedHoldings);
      }

      // Load organization stock/ETF holdings
      const { data: orgHoldingsData } = await supabase
        .from('organization_share_holdings')
        .select(`
          offering_id,
          shares_owned,
          entry_price,
          current_mark,
          unrealized_gain_loss,
          unrealized_gain_loss_pct,
          organization_offerings!inner(
            stock_symbol,
            offering_type,
            organization_id,
            businesses!inner(
              business_name
            )
          )
        `)
        .eq('holder_id', user.id)
        .order('unrealized_gain_loss', { ascending: false });

      if (orgHoldingsData) {
        const formattedOrgHoldings = orgHoldingsData.map((h: any) => ({
          offering_id: h.offering_id,
          organization_name: h.organization_offerings?.businesses?.business_name || 'Unknown Org',
          stock_symbol: h.organization_offerings?.stock_symbol || 'N/A',
          shares_owned: h.shares_owned,
          entry_price: h.entry_price,
          current_mark: h.current_mark,
          unrealized_gain_loss: h.unrealized_gain_loss,
          unrealized_gain_loss_pct: h.unrealized_gain_loss_pct
        }));
        setOrgHoldings(formattedOrgHoldings);
      }

      // Load transactions
      const txHistory = await CashBalanceService.getTransactionHistory(user.id, 100);
      setTransactions(txHistory);

      // Load stakes
      const { data: stakesData } = await supabase
        .from('profit_share_stakes')
        .select(`
          id,
          vehicle_id,
          amount_cents,
          profit_share_pct,
          status,
          created_at,
          vehicle_funding_rounds!inner(
            vehicles!inner(
              year,
              make,
              model
            )
          )
        `)
        .eq('staker_id', user.id)
        .order('created_at', { ascending: false });

      if (stakesData) {
        const formattedStakes = stakesData.map((s: any) => ({
          id: s.id,
          vehicle_id: s.vehicle_id,
          vehicle_year: s.vehicle_funding_rounds?.vehicles?.year,
          vehicle_make: s.vehicle_funding_rounds?.vehicles?.make,
          vehicle_model: s.vehicle_funding_rounds?.vehicles?.model,
          amount_cents: s.amount_cents,
          profit_share_pct: s.profit_share_pct,
          status: s.status,
          created_at: s.created_at
        }));
        setStakes(formattedStakes);
      }

      // Load bonds
      const { data: bondsData } = await supabase
        .from('bond_holdings')
        .select(`
          id,
          bond_id,
          principal_cents,
          purchase_date,
          vehicle_bonds!inner(
            vehicle_id,
            interest_rate,
            term_months,
            maturity_date,
            status,
            vehicles!inner(
              year,
              make,
              model
            )
          )
        `)
        .eq('holder_id', user.id)
        .order('purchase_date', { ascending: false });

      if (bondsData) {
        const formattedBonds = bondsData.map((b: any) => {
          const daysSincePurchase = Math.floor(
            (Date.now() - new Date(b.purchase_date).getTime()) / (1000 * 60 * 60 * 24)
          );
          const accruedInterest = Math.floor(
            (b.principal_cents * (b.vehicle_bonds.interest_rate / 100) * daysSincePurchase) / 365
          );
          
          return {
            id: b.id,
            vehicle_id: b.vehicle_bonds.vehicle_id,
            vehicle_year: b.vehicle_bonds.vehicles?.year,
            vehicle_make: b.vehicle_bonds.vehicles?.make,
            vehicle_model: b.vehicle_bonds.vehicles?.model,
            principal_cents: b.principal_cents,
            interest_rate: b.vehicle_bonds.interest_rate,
            term_months: b.vehicle_bonds.term_months,
            maturity_date: b.vehicle_bonds.maturity_date,
            accrued_interest_cents: accruedInterest,
            status: b.vehicle_bonds.status
          };
        });
        setBonds(formattedBonds);
      }

      // Load owned vehicles (user is uploader or verified owner)
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, vin')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (vehiclesData) {
        // Load primary images for owned vehicles
        const vehicleIds = vehiclesData.map((v: any) => v.id);
        const { data: imagesData } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url')
          .in('vehicle_id', vehicleIds)
          .eq('is_primary', true);

        const imagesByVehicle: Record<string, string> = {};
        (imagesData || []).forEach((img: any) => {
          imagesByVehicle[img.vehicle_id] = img.image_url;
        });

        const formatted = vehiclesData.map((v: any) => ({
          id: v.id,
          year: v.year,
          make: v.make,
          model: v.model,
          current_value: v.current_value,
          vin: v.vin,
          image_url: imagesByVehicle[v.id] || null
        }));
        setOwnedVehicles(formatted);
      }

    } catch (error) {
      console.error('Failed to load portfolio:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'deposit': return '💳';
      case 'withdrawal': return '🏦';
      case 'trade_buy': return '📈';
      case 'trade_sell': return '📉';
      case 'fee': return '💰';
      case 'refund': return '↩';
      default: return '•';
    }
  };

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'deposit': return 'Deposit';
      case 'withdrawal': return 'Withdrawal';
      case 'trade_buy': return 'Share Purchase';
      case 'trade_sell': return 'Share Sale';
      case 'fee': return 'Platform Fee';
      case 'refund': return 'Refund';
      default: return 'Transaction';
    }
  };

  const sharesValue = holdings.reduce((sum, h) => sum + (h.shares_owned * h.current_mark * 100), 0);
  const stakesValue = stakes.reduce((sum, s) => sum + s.amount_cents, 0);
  const bondsValue = bonds.reduce((sum, b) => sum + b.principal_cents + b.accrued_interest_cents, 0);
  
  const totalPortfolioValue = (cashBalance?.balance_cents || 0) + sharesValue + stakesValue + bondsValue;
  const totalUnrealizedPL = holdings.reduce((sum, h) => sum + (h.unrealized_gain_loss || 0) * 100, 0);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          Loading portfolio...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        {/* Header */}
        <div style={{
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div>
            <h1 style={{
              fontSize: '11px',
              fontWeight: 700,
              marginBottom: '2px'
            }}>
              Portfolio
            </h1>
            <p style={{
              fontSize: '9px',
              color: 'var(--text-secondary)'
            }}>
              Trading account · Cash balance · Share holdings
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            style={{
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            ← Back to Home
          </button>
        </div>

        {/* Portfolio Summary */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}>
          {/* Total Value */}
          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              fontWeight: 600,
              textTransform: 'uppercase'
            }}>
              Total Portfolio Value
            </div>
            <div style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono, monospace)'
            }}>
              {CashBalanceService.formatCurrency(totalPortfolioValue)}
            </div>
          </div>

          {/* Cash Balance */}
          <CashBalance compact={false} showActions={true} />

          {/* Unrealized P&L */}
          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              fontWeight: 600,
              textTransform: 'uppercase'
            }}>
              Unrealized P&L
            </div>
            <div style={{
              fontSize: '12px',
              fontWeight: 700,
              color: totalUnrealizedPL >= 0 ? 'var(--success)' : 'var(--error)',
              fontFamily: 'var(--font-mono, monospace)'
            }}>
              {totalUnrealizedPL >= 0 ? '+' : ''}
              {CashBalanceService.formatCurrency(totalUnrealizedPL)}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '16px',
          overflowX: 'auto',
          scrollbarWidth: 'none'
        }}>
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'overview' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'overview' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            Overview
          </button>

          <button
            onClick={() => setActiveTab('cash')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'cash' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'cash' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            Cash
          </button>

          <button
            onClick={() => setActiveTab('shares')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'shares' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'shares' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            Shares ({holdings.length})
          </button>

          <button
            onClick={() => setActiveTab('stakes')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'stakes' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'stakes' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            Stakes ({stakes.length})
          </button>

          <button
            onClick={() => setActiveTab('bonds')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'bonds' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'bonds' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            Bonds ({bonds.length})
          </button>

          <button
            onClick={() => setActiveTab('orgs')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'orgs' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'orgs' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            Org Stocks ({orgHoldings.length})
          </button>

          <button
            onClick={() => setActiveTab('vehicles')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'vehicles' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'vehicles' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            My Vehicles ({ownedVehicles.length})
          </button>
        </div>

        {/* Content */}
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div style={{ padding: '20px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
              }}>
                <div>
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Cash
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600 }}>
                    {CashBalanceService.formatCurrency(cashBalance?.balance_cents || 0)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Shares
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600 }}>
                    {CashBalanceService.formatCurrency(sharesValue)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Stakes
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600 }}>
                    {CashBalanceService.formatCurrency(stakesValue)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Bonds
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600 }}>
                    {CashBalanceService.formatCurrency(bondsValue)}
                  </div>
                </div>
              </div>

              <div style={{
                border: '2px solid var(--border)',
                borderRadius: '4px',
                padding: '16px',
                background: 'var(--bg)'
              }}>
                <div style={{ fontSize: '9px', fontWeight: 600, marginBottom: '12px' }}>
                  Portfolio Breakdown
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                    <span>Total Assets</span>
                    <span style={{ fontWeight: 600 }}>{CashBalanceService.formatCurrency(totalPortfolioValue)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                    <span>Unrealized P&L</span>
                    <span style={{ 
                      fontWeight: 600, 
                      color: totalUnrealizedPL >= 0 ? 'var(--success)' : 'var(--error)' 
                    }}>
                      {totalUnrealizedPL >= 0 ? '+' : ''}
                      {CashBalanceService.formatCurrency(totalUnrealizedPL)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Cash Tab */}
          {activeTab === 'cash' && (
            <div style={{ padding: '20px' }}>
              <CashBalance compact={false} showActions={true} />
              
              <div style={{ marginTop: '20px' }}>
                <div style={{ fontSize: '9px', fontWeight: 600, marginBottom: '12px' }}>
                  Recent Transactions
                </div>
                {transactions.slice(0, 10).map((tx, index) => (
                  <div
                    key={tx.id}
                    style={{
                      padding: '12px',
                      borderBottom: index < 9 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '9px', fontWeight: 600 }}>
                        {getTransactionLabel(tx.transaction_type)}
                      </div>
                      <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                        {formatDate(tx.created_at)}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: tx.amount_cents > 0 ? 'var(--success)' : 'var(--error)'
                    }}>
                      {tx.amount_cents > 0 ? '+' : ''}
                      {CashBalanceService.formatCurrency(Math.abs(tx.amount_cents))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shares Tab */}
          {activeTab === 'shares' && (
            <>
              {holdings.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  No holdings yet. Invest in vehicles to build your portfolio.
                </div>
              ) : (
                <div>
                  {holdings.map((holding, index) => (
                    <div
                      key={holding.offering_id}
                      style={{
                        padding: '16px 20px',
                        borderBottom: index < holdings.length - 1 ? '1px solid var(--border)' : 'none',
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1fr',
                        gap: '16px',
                        alignItems: 'center'
                      }}
                    >
                      {/* Vehicle */}
                      <div>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          marginBottom: '2px'
                        }}>
                          {holding.vehicle_year} {holding.vehicle_make} {holding.vehicle_model}
                        </div>
                        <div style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono, monospace)'
                        }}>
                          {holding.shares_owned} shares @ ${holding.entry_price.toFixed(2)}
                        </div>
                      </div>

                      {/* Current Value */}
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono, monospace)'
                        }}>
                          ${holding.current_mark.toFixed(2)}
                        </div>
                        <div style={{
                          fontSize: '10px',
                          color: 'var(--text-secondary)'
                        }}>
                          per share
                        </div>
                      </div>

                      {/* Total Value */}
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono, monospace)'
                        }}>
                          {CashBalanceService.formatCurrency(holding.shares_owned * holding.current_mark * 100)}
                        </div>
                      </div>

                      {/* P&L */}
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: (holding.unrealized_gain_loss || 0) >= 0 ? 'var(--success)' : 'var(--error)',
                          fontFamily: 'var(--font-mono, monospace)'
                        }}>
                          {(holding.unrealized_gain_loss || 0) >= 0 ? '+' : ''}
                          {CashBalanceService.formatCurrency((holding.unrealized_gain_loss || 0) * 100)}
                        </div>
                        <div style={{
                          fontSize: '10px',
                          color: (holding.unrealized_gain_loss_pct || 0) >= 0 ? 'var(--success)' : 'var(--error)'
                        }}>
                          {(holding.unrealized_gain_loss_pct || 0) >= 0 ? '+' : ''}
                          {(holding.unrealized_gain_loss_pct || 0).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Stakes Tab */}
          {activeTab === 'stakes' && (
            <>
              {stakes.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  No stakes yet. Support vehicle restorations and earn profit shares.
                </div>
              ) : (
                <div>
                  {stakes.map((stake, index) => (
                    <div
                      key={stake.id}
                      style={{
                        padding: '16px 20px',
                        borderBottom: index < stakes.length - 1 ? '1px solid var(--border)' : 'none',
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1fr',
                        gap: '16px',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 600, marginBottom: '2px' }}>
                          {stake.vehicle_year} {stake.vehicle_make} {stake.vehicle_model}
                        </div>
                        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                          {formatDate(stake.created_at)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600 }}>
                          {CashBalanceService.formatCurrency(stake.amount_cents)}
                        </div>
                        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                          Staked
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600 }}>
                          {stake.profit_share_pct.toFixed(2)}%
                        </div>
                        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                          Profit Share
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: '8px',
                          fontWeight: 600,
                          padding: '4px 8px',
                          borderRadius: '4px',
                          background: stake.status === 'active' ? 'var(--accent-dim)' : 'var(--surface)',
                          color: stake.status === 'active' ? 'var(--accent)' : 'var(--text-secondary)',
                          display: 'inline-block'
                        }}>
                          {stake.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Bonds Tab */}
          {activeTab === 'bonds' && (
            <>
              {bonds.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  No bonds yet. Invest in fixed-income vehicle bonds.
                </div>
              ) : (
                <div>
                  {bonds.map((bond, index) => (
                    <div
                      key={bond.id}
                      style={{
                        padding: '16px 20px',
                        borderBottom: index < bonds.length - 1 ? '1px solid var(--border)' : 'none',
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1fr',
                        gap: '16px',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 600, marginBottom: '2px' }}>
                          {bond.vehicle_year} {bond.vehicle_make} {bond.vehicle_model}
                        </div>
                        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                          {bond.interest_rate}% · {bond.term_months} months
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600 }}>
                          {CashBalanceService.formatCurrency(bond.principal_cents)}
                        </div>
                        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                          Principal
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--success)' }}>
                          +{CashBalanceService.formatCurrency(bond.accrued_interest_cents)}
                        </div>
                        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                          Accrued Interest
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                          Matures
                        </div>
                        <div style={{ fontSize: '9px', fontWeight: 600 }}>
                          {new Date(bond.maturity_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Organization Stocks Tab */}
          {activeTab === 'orgs' && (
            <>
              {orgHoldings.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  No organization stocks yet. Trade stocks in organization profiles.
                </div>
              ) : (
                <div>
                  {orgHoldings.map((holding, index) => (
                    <div
                      key={holding.offering_id}
                      onClick={() => {
                        // TODO: navigate to org profile once we have org_id
                        alert(`View ${holding.stock_symbol} - org profile integration pending`);
                      }}
                      style={{
                        padding: '16px 20px',
                        borderBottom: index < orgHoldings.length - 1 ? '1px solid var(--border)' : 'none',
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1fr',
                        gap: '16px',
                        alignItems: 'center',
                        cursor: 'pointer',
                        transition: '0.12s',
                        fontSize: '9px'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '2px', fontSize: '10px' }}>
                          {holding.organization_name}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>
                          {holding.stock_symbol}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '10px' }}>
                          {holding.shares_owned} shares
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>
                          Entry: ${holding.entry_price.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '10px' }}>
                          ${holding.current_mark.toFixed(2)}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>
                          Current
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontWeight: 600,
                          fontSize: '10px',
                          color: holding.unrealized_gain_loss >= 0 ? '#006400' : '#b91c1c'
                        }}>
                          {holding.unrealized_gain_loss >= 0 ? '+' : ''}
                          ${holding.unrealized_gain_loss.toFixed(2)}
                        </div>
                        <div style={{
                          fontSize: '8px',
                          color: holding.unrealized_gain_loss_pct >= 0 ? '#006400' : '#b91c1c'
                        }}>
                          {holding.unrealized_gain_loss_pct >= 0 ? '+' : ''}
                          {holding.unrealized_gain_loss_pct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Vehicles Tab */}
          {activeTab === 'vehicles' && (
            <>
              {ownedVehicles.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  No vehicles yet. Add your first vehicle to get started.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', padding: '20px' }}>
                  {ownedVehicles.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => navigate(`/vehicle/${v.id}`)}
                      style={{
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: '0.12s',
                        background: 'var(--bg)'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                      {v.image_url && (
                        <div style={{
                          width: '100%',
                          height: '160px',
                          background: `url(${v.image_url}) center/cover`,
                          borderBottom: '2px solid var(--border)'
                        }} />
                      )}
                      <div style={{ padding: '12px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: 4 }}>
                          {v.year} {v.make} {v.model}
                        </div>
                        {v.current_value && (
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: 4 }}>
                            {CashBalanceService.formatCurrency(v.current_value * 100)}
                          </div>
                        )}
                        {v.vin && (
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
                            VIN: {v.vin.slice(0, 8)}...
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

