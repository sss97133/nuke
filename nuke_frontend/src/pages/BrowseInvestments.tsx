import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';

interface FundingRound {
  id: string;
  vehicle_id: string;
  target_amount_cents: number;
  current_amount_cents: number;
  profit_share_pct: number;
  deadline: string;
  description: string;
  vehicle: {
    year?: number;
    make?: string;
    model?: string;
  };
}

interface Bond {
  id: string;
  vehicle_id: string;
  principal_cents: number;
  interest_rate: number;
  term_months: number;
  maturity_date: string;
  status: string;
  vehicle: {
    year?: number;
    make?: string;
    model?: string;
  };
}

export default function BrowseInvestments() {
  const navigate = useNavigate();
  const [fundingRounds, setFundingRounds] = useState<FundingRound[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'rounds' | 'bonds'>('rounds');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load active funding rounds
      const { data: roundsData } = await supabase
        .from('vehicle_funding_rounds')
        .select(`
          id,
          vehicle_id,
          target_amount_cents,
          current_amount_cents,
          profit_share_pct,
          deadline,
          description,
          vehicles!inner(
            year,
            make,
            model
          )
        `)
        .eq('status', 'active')
        .gt('deadline', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (roundsData) {
        setFundingRounds(roundsData.map((r: any) => ({
          ...r,
          vehicle: r.vehicles
        })));
      }

      // Load active bonds
      const { data: bondsData } = await supabase
        .from('vehicle_bonds')
        .select(`
          id,
          vehicle_id,
          principal_cents,
          interest_rate,
          term_months,
          maturity_date,
          status,
          vehicles!inner(
            year,
            make,
            model
          )
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20);

      if (bondsData) {
        setBonds(bondsData.map((b: any) => ({
          ...b,
          vehicle: b.vehicles
        })));
      }

    } catch (error) {
      console.error('Failed to load investments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDaysRemaining = (deadline: string) => {
    const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

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
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
          Loading investment opportunities...
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
              Browse Investments
            </h1>
            <p style={{
              fontSize: '9px',
              color: 'var(--text-secondary)'
            }}>
              Discover funding rounds and bonds to invest in
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            style={{
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            ← Back
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '16px'
        }}>
          <button
            onClick={() => setActiveTab('rounds')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'rounds' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'rounds' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            💰 Funding Rounds ({fundingRounds.length})
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
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            🏦 Bonds ({bonds.length})
          </button>
        </div>

        {/* Content */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
          gap: '16px'
        }}>
          {activeTab === 'rounds' && (
            <>
              {fundingRounds.length === 0 ? (
                <div style={{
                  gridColumn: '1 / -1',
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  No active funding rounds at the moment.
                </div>
              ) : (
                fundingRounds.map(round => {
                  const progress = (round.current_amount_cents / round.target_amount_cents) * 100;
                  const daysLeft = getDaysRemaining(round.deadline);
                  
                  return (
                    <div
                      key={round.id}
                      onClick={() => navigate(`/vehicle/${round.vehicle_id}`)}
                      style={{
                        background: 'var(--surface)',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        padding: '16px',
                        cursor: 'pointer',
                        transition: '0.12s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      {/* Vehicle Name */}
                      <div style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        marginBottom: '8px'
                      }}>
                        {round.vehicle.year} {round.vehicle.make} {round.vehicle.model}
                      </div>

                      {/* Description */}
                      {round.description && (
                        <p style={{
                          fontSize: '8px',
                          color: 'var(--text-secondary)',
                          marginBottom: '12px',
                          lineHeight: 1.4
                        }}>
                          {round.description}
                        </p>
                      )}

                      {/* Progress Bar */}
                      <div style={{
                        width: '100%',
                        height: '8px',
                        background: 'var(--bg)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        marginBottom: '8px'
                      }}>
                        <div style={{
                          width: `${Math.min(progress, 100)}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          transition: '0.3s'
                        }} />
                      </div>

                      {/* Stats */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '12px',
                        marginBottom: '12px'
                      }}>
                        <div>
                          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                            Raised
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: 600 }}>
                            {CashBalanceService.formatCurrency(round.current_amount_cents)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                            Target
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: 600 }}>
                            {CashBalanceService.formatCurrency(round.target_amount_cents)}
                          </div>
                        </div>
                      </div>

                      {/* Footer */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: '12px',
                        borderTop: '1px solid var(--border)'
                      }}>
                        <div style={{
                          fontSize: '8px',
                          color: 'var(--accent)',
                          fontWeight: 600
                        }}>
                          {round.profit_share_pct}% profit share
                        </div>
                        <div style={{
                          fontSize: '8px',
                          color: 'var(--text-secondary)'
                        }}>
                          {daysLeft} days left
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {activeTab === 'bonds' && (
            <>
              {bonds.length === 0 ? (
                <div style={{
                  gridColumn: '1 / -1',
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  No active bonds at the moment.
                </div>
              ) : (
                bonds.map(bond => {
                  const totalReturn = bond.principal_cents * (1 + (bond.interest_rate / 100) * (bond.term_months / 12));
                  
                  return (
                    <div
                      key={bond.id}
                      onClick={() => navigate(`/vehicle/${bond.vehicle_id}`)}
                      style={{
                        background: 'var(--surface)',
                        border: '2px solid var(--border)',
                        borderRadius: '4px',
                        padding: '16px',
                        cursor: 'pointer',
                        transition: '0.12s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      {/* Vehicle Name */}
                      <div style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        marginBottom: '12px'
                      }}>
                        {bond.vehicle.year} {bond.vehicle.make} {bond.vehicle.model}
                      </div>

                      {/* Bond Terms */}
                      <div style={{
                        background: 'var(--bg)',
                        borderRadius: '4px',
                        padding: '12px',
                        marginBottom: '12px'
                      }}>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '8px',
                          fontSize: '8px'
                        }}>
                          <div>
                            <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              Principal
                            </div>
                            <div style={{ fontWeight: 600 }}>
                              {CashBalanceService.formatCurrency(bond.principal_cents)}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              Interest Rate
                            </div>
                            <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
                              {bond.interest_rate}% APR
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              Term
                            </div>
                            <div style={{ fontWeight: 600 }}>
                              {bond.term_months} months
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-secondary)', marginBottom: '2px' }}>
                              Total Return
                            </div>
                            <div style={{ fontWeight: 600, color: 'var(--success)' }}>
                              {CashBalanceService.formatCurrency(Math.floor(totalReturn))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Maturity */}
                      <div style={{
                        fontSize: '8px',
                        color: 'var(--text-secondary)',
                        textAlign: 'center'
                      }}>
                        Matures {new Date(bond.maturity_date).toLocaleDateString('en-US', { 
                          month: 'long', 
                          year: 'numeric' 
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

