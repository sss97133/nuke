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

export default function Portfolio() {
  const navigate = useNavigate();
  const [cashBalance, setCashBalance] = useState<any>(null);
  const [holdings, setHoldings] = useState<ShareHolding[]>([]);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'holdings' | 'transactions'>('holdings');

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

      // Load share holdings
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

      // Load transactions
      const txHistory = await CashBalanceService.getTransactionHistory(user.id, 100);
      setTransactions(txHistory);

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

  const totalPortfolioValue = (cashBalance?.balance_cents || 0) + 
    holdings.reduce((sum, h) => sum + (h.shares_owned * h.current_mark * 100), 0);

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
          marginBottom: '16px'
        }}>
          <button
            onClick={() => setActiveTab('holdings')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'holdings' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'holdings' ? 'var(--accent)' : 'var(--text)',
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            Share Holdings ({holdings.length})
          </button>

          <button
            onClick={() => setActiveTab('transactions')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'transactions' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'transactions' ? 'var(--accent)' : 'var(--text)',
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            Transactions ({transactions.length})
          </button>
        </div>

        {/* Content */}
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          {activeTab === 'holdings' && (
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

          {activeTab === 'transactions' && (
            <>
              {transactions.length === 0 ? (
                <div style={{
                  padding: '48px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '9px'
                }}>
                  Ready to invest? Deposit cash to begin trading.
                </div>
              ) : (
                <div>
                  {transactions.map((tx, index) => (
                    <div
                      key={tx.id}
                      style={{
                        padding: '16px 20px',
                        borderBottom: index < transactions.length - 1 ? '1px solid var(--border)' : 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '16px'
                      }}
                    >
                      {/* Left: Icon + Details */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                        <div style={{
                          fontSize: '24px',
                          width: '40px',
                          height: '40px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--bg)',
                          borderRadius: '4px',
                          border: '2px solid var(--border)'
                        }}>
                          {getTransactionIcon(tx.transaction_type)}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          marginBottom: '2px'
                        }}>
                          {getTransactionLabel(tx.transaction_type)}
                        </div>
                        <div style={{
                          fontSize: '9px',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono, monospace)'
                        }}>
                          {formatDate(tx.created_at)}
                        </div>
                          {tx.metadata?.amount_paid_usd && (
                            <div style={{
                              fontSize: '10px',
                              color: 'var(--text-secondary)',
                              marginTop: '2px'
                            }}>
                              Via Stripe: {tx.metadata.payment_method || 'card'}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Amount */}
                      <div style={{
                        fontSize: '16px',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono, monospace)',
                        color: tx.amount_cents > 0 ? 'var(--success)' : 'var(--error)',
                        textAlign: 'right'
                      }}>
                        {tx.amount_cents > 0 ? '+' : ''}
                        {CashBalanceService.formatCurrency(Math.abs(tx.amount_cents))}
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

