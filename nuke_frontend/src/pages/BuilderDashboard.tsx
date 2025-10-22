import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CashBalanceService } from '../services/cashBalanceService';

interface Vehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  current_value_cents?: number;
}

interface FundingRound {
  id: string;
  vehicle_id: string;
  target_amount_cents: number;
  current_amount_cents: number;
  profit_share_pct: number;
  status: string;
  deadline: string;
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
  total_sold_cents: number;
  status: string;
  vehicle: {
    year?: number;
    make?: string;
    model?: string;
  };
}

export default function BuilderDashboard() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fundingRounds, setFundingRounds] = useState<FundingRound[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

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

      // Load user's vehicles
      const { data: vehiclesData } = await supabase
        .from('vehicles')
        .select('id, year, make, model, current_value_cents')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (vehiclesData) {
        setVehicles(vehiclesData);
      }

      // Load active funding rounds
      const { data: roundsData } = await supabase
        .from('vehicle_funding_rounds')
        .select(`
          id,
          vehicle_id,
          target_amount_cents,
          current_amount_cents,
          profit_share_pct,
          status,
          deadline,
          vehicles!inner(
            year,
            make,
            model
          )
        `)
        .eq('vehicles.user_id', user.id)
        .in('status', ['active', 'funded'])
        .order('created_at', { ascending: false });

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
          status,
          vehicles!inner(
            year,
            make,
            model
          )
        `)
        .eq('vehicles.user_id', user.id)
        .in('status', ['active', 'funded'])
        .order('created_at', { ascending: false });

      if (bondsData) {
        // Calculate total sold for each bond
        const bondsWithSales = await Promise.all(
          bondsData.map(async (b: any) => {
            const { data: holdings } = await supabase
              .from('bond_holdings')
              .select('principal_cents')
              .eq('bond_id', b.id);
            
            const totalSold = holdings?.reduce((sum, h) => sum + h.principal_cents, 0) || 0;
            
            return {
              ...b,
              vehicle: b.vehicles,
              total_sold_cents: totalSold
            };
          })
        );
        setBonds(bondsWithSales);
      }

    } catch (error) {
      console.error('Failed to load builder data:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalRaised = fundingRounds.reduce((sum, r) => sum + (r.current_amount_cents || 0), 0) +
    bonds.reduce((sum, b) => sum + (b.total_sold_cents || 0), 0);

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
          Loading dashboard...
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
              Builder Dashboard
            </h1>
            <p style={{
              fontSize: '9px',
              color: 'var(--text-secondary)'
            }}>
              Manage financial products · Raise capital · Track earnings
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

        {/* Summary Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            padding: '16px'
          }}>
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              fontWeight: 600,
              textTransform: 'uppercase'
            }}>
              Total Raised
            </div>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--accent)'
            }}>
              {CashBalanceService.formatCurrency(totalRaised)}
            </div>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            padding: '16px'
          }}>
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              fontWeight: 600,
              textTransform: 'uppercase'
            }}>
              Active Funding Rounds
            </div>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--text)'
            }}>
              {fundingRounds.filter(r => r.status === 'active').length}
            </div>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            padding: '16px'
          }}>
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              fontWeight: 600,
              textTransform: 'uppercase'
            }}>
              Active Bonds
            </div>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--text)'
            }}>
              {bonds.filter(b => b.status === 'active').length}
            </div>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: '4px',
            padding: '16px'
          }}>
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginBottom: '4px',
              fontWeight: 600,
              textTransform: 'uppercase'
            }}>
              Your Vehicles
            </div>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--text)'
            }}>
              {vehicles.length}
            </div>
          </div>
        </div>

        {/* Your Vehicles */}
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          overflow: 'hidden',
          marginBottom: '24px'
        }}>
          <div style={{
            padding: '16px',
            borderBottom: '2px solid var(--border)',
            background: 'var(--bg)'
          }}>
            <h2 style={{
              fontSize: '10px',
              fontWeight: 600,
              margin: 0
            }}>
              Your Vehicles
            </h2>
            <p style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              margin: '4px 0 0 0'
            }}>
              Create financial products for your vehicles
            </p>
          </div>

          {vehicles.length === 0 ? (
            <div style={{
              padding: '48px 20px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '9px'
            }}>
              No vehicles yet. Add a vehicle to start raising capital.
            </div>
          ) : (
            <div>
              {vehicles.map((vehicle, index) => (
                <div
                  key={vehicle.id}
                  style={{
                    padding: '16px',
                    borderBottom: index < vehicles.length - 1 ? '1px solid var(--border)' : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      marginBottom: '4px'
                    }}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </div>
                    {vehicle.current_value_cents && (
                      <div style={{
                        fontSize: '8px',
                        color: 'var(--text-secondary)'
                      }}>
                        Value: {CashBalanceService.formatCurrency(vehicle.current_value_cents)}
                      </div>
                    )}
                  </div>

                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap'
                  }}>
                    <button
                      onClick={() => navigate(`/builder/create-round/${vehicle.id}`)}
                      style={{
                        border: '2px solid var(--accent)',
                        background: 'var(--accent-dim)',
                        color: 'var(--accent)',
                        padding: '6px 12px',
                        fontSize: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: '0.12s',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Create Funding Round
                    </button>

                    <button
                      onClick={() => navigate(`/builder/issue-bond/${vehicle.id}`)}
                      style={{
                        border: '2px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        padding: '6px 12px',
                        fontSize: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: '0.12s',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Issue Bond
                    </button>

                    <button
                      onClick={() => navigate(`/builder/list-vehicle/${vehicle.id}`)}
                      style={{
                        border: '2px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        padding: '6px 12px',
                        fontSize: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: '0.12s',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      List for Sale
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Offerings */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '16px'
        }}>
          {/* Funding Rounds */}
          {fundingRounds.length > 0 && (
            <div style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '12px',
                borderBottom: '2px solid var(--border)',
                background: 'var(--bg)'
              }}>
                <h3 style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  margin: 0
                }}>
                  Active Funding Rounds
                </h3>
              </div>
              <div>
                {fundingRounds.map((round, index) => {
                  const progress = (round.current_amount_cents / round.target_amount_cents) * 100;
                  return (
                    <div
                      key={round.id}
                      style={{
                        padding: '12px',
                        borderBottom: index < fundingRounds.length - 1 ? '1px solid var(--border)' : 'none'
                      }}
                    >
                      <div style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        marginBottom: '4px'
                      }}>
                        {round.vehicle.year} {round.vehicle.make} {round.vehicle.model}
                      </div>
                      <div style={{
                        fontSize: '8px',
                        color: 'var(--text-secondary)',
                        marginBottom: '8px'
                      }}>
                        {CashBalanceService.formatCurrency(round.current_amount_cents)} / {CashBalanceService.formatCurrency(round.target_amount_cents)}
                      </div>
                      <div style={{
                        width: '100%',
                        height: '6px',
                        background: 'var(--bg)',
                        borderRadius: '3px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${Math.min(progress, 100)}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          transition: '0.3s'
                        }} />
                      </div>
                      <div style={{
                        fontSize: '8px',
                        color: 'var(--text-secondary)',
                        marginTop: '4px'
                      }}>
                        {progress.toFixed(0)}% funded · {round.profit_share_pct}% profit share
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bonds */}
          {bonds.length > 0 && (
            <div style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '12px',
                borderBottom: '2px solid var(--border)',
                background: 'var(--bg)'
              }}>
                <h3 style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  margin: 0
                }}>
                  Active Bonds
                </h3>
              </div>
              <div>
                {bonds.map((bond, index) => {
                  const progress = (bond.total_sold_cents / bond.principal_cents) * 100;
                  return (
                    <div
                      key={bond.id}
                      style={{
                        padding: '12px',
                        borderBottom: index < bonds.length - 1 ? '1px solid var(--border)' : 'none'
                      }}
                    >
                      <div style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        marginBottom: '4px'
                      }}>
                        {bond.vehicle.year} {bond.vehicle.make} {bond.vehicle.model}
                      </div>
                      <div style={{
                        fontSize: '8px',
                        color: 'var(--text-secondary)',
                        marginBottom: '4px'
                      }}>
                        {bond.interest_rate}% · {bond.term_months} months
                      </div>
                      <div style={{
                        fontSize: '8px',
                        color: 'var(--text-secondary)'
                      }}>
                        Sold: {CashBalanceService.formatCurrency(bond.total_sold_cents)} / {CashBalanceService.formatCurrency(bond.principal_cents)}
                      </div>
                      <div style={{
                        width: '100%',
                        height: '6px',
                        background: 'var(--bg)',
                        borderRadius: '3px',
                        overflow: 'hidden',
                        marginTop: '8px'
                      }}>
                        <div style={{
                          width: `${Math.min(progress, 100)}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          transition: '0.3s'
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

