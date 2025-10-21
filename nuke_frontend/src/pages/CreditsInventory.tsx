import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CreditsService } from '../services/creditsService';

interface CreditTransaction {
  id: string;
  amount: number;
  transaction_type: 'purchase' | 'allocation' | 'refund' | 'payout';
  created_at: string;
  metadata?: {
    stripe_session_id?: string;
    amount_paid?: number;
  };
}

export default function CreditsInventory() {
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

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

      setUser(user);

      // Load balance
      const userBalance = await CreditsService.getUserBalance(user.id);
      setBalance(userBalance);

      // Load transaction history
      const history = await CreditsService.getTransactionHistory(user.id);
      setTransactions(history);
    } catch (error) {
      console.error('Failed to load credit data:', error);
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
      case 'purchase': return '💳';
      case 'allocation': return '🚗';
      case 'refund': return '↩';
      case 'payout': return '💰';
      default: return '•';
    }
  };

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'purchase': return 'Credit Purchase';
      case 'allocation': return 'Vehicle Support';
      case 'refund': return 'Refund';
      case 'payout': return 'Payout';
      default: return 'Transaction';
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}>
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          Loading...
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
        maxWidth: '900px',
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
              fontSize: '28px',
              fontWeight: 700,
              marginBottom: '4px'
            }}>
              Credits
            </h1>
            <p style={{
              fontSize: '13px',
              color: 'var(--text-secondary)'
            }}>
              View your credit balance and transaction history
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

        {/* Balance Card */}
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '8px',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <div>
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                marginBottom: '8px'
              }}>
                Available Balance
              </div>
              <div style={{
                fontSize: '36px',
                fontWeight: 700,
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono, monospace)'
              }}>
                {CreditsService.formatCredits(balance)}
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px'
              }}>
                {balance} credits ({balance / 100} USD equivalent)
              </div>
            </div>

            <button
              onClick={() => {
                // Navigate to buy credits - you'll need to create this component
                alert('Buy credits feature coming soon!');
              }}
              style={{
                border: '2px solid var(--accent)',
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                padding: '12px 24px',
                fontSize: '13px',
                fontWeight: 600,
                fontFamily: 'Arial, sans-serif',
                cursor: 'pointer',
                transition: '0.12s',
                borderRadius: '4px'
              }}
            >
              + Buy Credits
            </button>
          </div>
        </div>

        {/* Transaction History */}
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '16px 20px',
            borderBottom: '2px solid var(--border)'
          }}>
            <h2 style={{
              fontSize: '16px',
              fontWeight: 700,
              margin: 0
            }}>
              Transaction History
            </h2>
          </div>

          {transactions.length === 0 ? (
            <div style={{
              padding: '48px 20px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '13px'
            }}>
              No transactions yet. Purchase credits to get started!
            </div>
          ) : (
            <div>
              {transactions.map((transaction, index) => (
                <div
                  key={transaction.id}
                  style={{
                    padding: '16px 20px',
                    borderBottom: index < transactions.length - 1 ? '1px solid var(--border)' : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    transition: '0.12s',
                    cursor: 'default'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--accent-dim)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
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
                      {getTransactionIcon(transaction.transaction_type)}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        marginBottom: '2px',
                        color: 'var(--text)'
                      }}>
                        {getTransactionLabel(transaction.transaction_type)}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono, monospace)'
                      }}>
                        {formatDate(transaction.created_at)}
                      </div>
                      {transaction.metadata?.amount_paid && (
                        <div style={{
                          fontSize: '10px',
                          color: 'var(--text-secondary)',
                          marginTop: '2px'
                        }}>
                          Paid: ${transaction.metadata.amount_paid.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Amount */}
                  <div style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono, monospace)',
                    color: transaction.amount > 0 ? 'var(--success)' : 'var(--text-secondary)',
                    textAlign: 'right'
                  }}>
                    {transaction.amount > 0 ? '+' : ''}
                    {CreditsService.formatCredits(Math.abs(transaction.amount))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info Box */}
        <div style={{
          marginTop: '24px',
          padding: '16px',
          background: 'var(--accent-dim)',
          border: '2px solid var(--accent)',
          borderRadius: '8px',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          lineHeight: 1.6
        }}>
          <strong style={{ color: 'var(--accent)' }}>💡 How Credits Work</strong>
          <br />
          • 100 credits = $1.00 USD
          <br />
          • Use credits to support vehicles and builders
          <br />
          • Builders receive 99% of support, platform keeps 1%
          <br />
          • All transactions are tracked and displayed here
        </div>
      </div>
    </div>
  );
}

