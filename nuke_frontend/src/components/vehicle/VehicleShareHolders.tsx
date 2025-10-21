import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CreditsService } from '../../services/creditsService';

interface ShareHolder {
  holder_id: string;
  holder_username?: string;
  shares_owned: number;
  entry_price: number;
  percentage_owned: number;
  is_anonymous?: boolean;
}

interface VehicleSupporter {
  supporter_id: string;
  supporter_username?: string;
  credits_allocated: number;
  message?: string;
  is_anonymous: boolean;
  created_at: string;
}

interface Props {
  vehicleId: string;
  vehicleValue?: number;
  compact?: boolean;
}

export default function VehicleShareHolders({ vehicleId, vehicleValue = 0, compact = false }: Props) {
  const [shareHolders, setShareHolders] = useState<ShareHolder[]>([]);
  const [supporters, setSupporters] = useState<VehicleSupporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'shares' | 'supporters'>('supporters');

  useEffect(() => {
    loadData();
  }, [vehicleId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load share holders (from fractional ownership)
      const { data: sharesData, error: sharesError } = await supabase
        .from('share_holdings')
        .select(`
          holder_id,
          shares_owned,
          entry_price,
          profiles:holder_id (
            username
          )
        `)
        .eq('offering_id', vehicleId)
        .order('shares_owned', { ascending: false })
        .limit(10);

      if (!sharesError && sharesData) {
        const formattedShares = sharesData.map((sh: any) => ({
          holder_id: sh.holder_id,
          holder_username: sh.profiles?.username || 'Anonymous',
          shares_owned: sh.shares_owned,
          entry_price: sh.entry_price,
          percentage_owned: (sh.shares_owned / 1000) * 100 // 1000 shares = 100%
        }));
        setShareHolders(formattedShares);
      }

      // Load supporters (from credits system)
      const { data: supportData, error: supportError } = await supabase
        .from('vehicle_support')
        .select(`
          supporter_id,
          credits_allocated,
          message,
          is_anonymous,
          created_at,
          profiles:supporter_id (
            username
          )
        `)
        .eq('vehicle_id', vehicleId)
        .order('credits_allocated', { ascending: false })
        .limit(20);

      if (!supportError && supportData) {
        const formattedSupport = supportData.map((s: any) => ({
          supporter_id: s.supporter_id,
          supporter_username: s.profiles?.username || 'Anonymous',
          credits_allocated: s.credits_allocated,
          message: s.message,
          is_anonymous: s.is_anonymous,
          created_at: s.created_at
        }));
        setSupporters(formattedSupport);
      }

    } catch (error) {
      console.error('Failed to load holders/supporters:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const totalSupporters = supporters.length;
  const totalSupport = supporters.reduce((sum, s) => sum + s.credits_allocated, 0);
  const totalShareHolders = shareHolders.length;
  const totalSharesOwned = shareHolders.reduce((sum, sh) => sum + sh.shares_owned, 0);

  if (loading) {
    return (
      <div style={{
        padding: '16px',
        fontSize: '12px',
        color: 'var(--text-secondary)',
        textAlign: 'center'
      }}>
        Loading...
      </div>
    );
  }

  // Compact view for cards
  if (compact) {
    return (
      <div style={{
        fontSize: '11px',
        color: 'var(--text-secondary)',
        display: 'flex',
        gap: '12px',
        alignItems: 'center'
      }}>
        {totalShareHolders > 0 && (
          <span>👥 {totalShareHolders} holders</span>
        )}
        {totalSupporters > 0 && (
          <span>💰 {totalSupporters} supporters · {CreditsService.formatCredits(totalSupport)}</span>
        )}
      </div>
    );
  }

  // Full view for profile pages
  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      borderRadius: '8px',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '2px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h3 style={{
          fontSize: '16px',
          fontWeight: 700,
          margin: 0
        }}>
          Ownership & Support
        </h3>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '8px'
        }}>
          <button
            onClick={() => setActiveTab('supporters')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'supporters' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'supporters' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            💰 Supporters ({totalSupporters})
          </button>

          <button
            onClick={() => setActiveTab('shares')}
            style={{
              border: '2px solid var(--border)',
              background: activeTab === 'shares' ? 'var(--accent-dim)' : 'var(--surface)',
              color: activeTab === 'shares' ? 'var(--accent)' : 'var(--text)',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: 'Arial, sans-serif',
              cursor: 'pointer',
              transition: '0.12s',
              borderRadius: '4px'
            }}
          >
            📊 Share Holders ({totalShareHolders})
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {activeTab === 'supporters' && (
          <>
            {supporters.length === 0 ? (
              <div style={{
                padding: '48px 20px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '13px'
              }}>
                No supporters yet. Be the first to support this build!
              </div>
            ) : (
              supporters.map((supporter, index) => (
                <div
                  key={supporter.supporter_id + index}
                  style={{
                    padding: '12px 20px',
                    borderBottom: index < supporters.length - 1 ? '1px solid var(--border)' : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px'
                  }}
                >
                  {/* Left: User info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      marginBottom: '2px',
                      color: 'var(--text)'
                    }}>
                      {supporter.is_anonymous ? '🔒 Anonymous' : `@${supporter.supporter_username}`}
                    </div>
                    {supporter.message && (
                      <div style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        marginTop: '4px',
                        fontStyle: 'italic'
                      }}>
                        "{supporter.message}"
                      </div>
                    )}
                    <div style={{
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                      marginTop: '4px'
                    }}>
                      {formatTimeAgo(supporter.created_at)}
                    </div>
                  </div>

                  {/* Right: Amount */}
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: 'var(--success)',
                    fontFamily: 'var(--font-mono, monospace)',
                    textAlign: 'right'
                  }}>
                    {CreditsService.formatCredits(supporter.credits_allocated)}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {activeTab === 'shares' && (
          <>
            {shareHolders.length === 0 ? (
              <div style={{
                padding: '48px 20px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '13px'
              }}>
                No fractional ownership yet. Be the first to buy shares!
              </div>
            ) : (
              <>
                {/* Summary */}
                <div style={{
                  padding: '16px 20px',
                  background: 'var(--accent-dim)',
                  borderBottom: '2px solid var(--border)'
                }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '16px',
                    fontSize: '11px'
                  }}>
                    <div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Total Holders</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent)' }}>
                        {totalShareHolders}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Shares Sold</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent)' }}>
                        {totalSharesOwned} / 1000
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>% Owned</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--accent)' }}>
                        {((totalSharesOwned / 1000) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Holder List */}
                {shareHolders.map((holder, index) => (
                  <div
                    key={holder.holder_id}
                    style={{
                      padding: '12px 20px',
                      borderBottom: index < shareHolders.length - 1 ? '1px solid var(--border)' : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '16px'
                    }}
                  >
                    {/* Left: User */}
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text)'
                      }}>
                        @{holder.holder_username}
                      </div>
                      <div style={{
                        fontSize: '10px',
                        color: 'var(--text-secondary)',
                        marginTop: '2px'
                      }}>
                        Entry: ${holder.entry_price.toFixed(2)}/share
                      </div>
                    </div>

                    {/* Middle: Shares */}
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--accent)',
                      fontFamily: 'var(--font-mono, monospace)'
                    }}>
                      {holder.shares_owned} shares
                    </div>

                    {/* Right: Percentage */}
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--success)',
                      minWidth: '60px',
                      textAlign: 'right'
                    }}>
                      {holder.percentage_owned.toFixed(2)}%
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Total Summary */}
      {totalSupporters > 0 && activeTab === 'supporters' && (
        <div style={{
          padding: '12px 20px',
          borderTop: '2px solid var(--border)',
          background: 'var(--success-dim)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
            Total Support
          </div>
          <div style={{
            fontSize: '18px',
            fontWeight: 700,
            color: 'var(--success)',
            fontFamily: 'var(--font-mono, monospace)'
          }}>
            {CreditsService.formatCredits(totalSupport)}
          </div>
        </div>
      )}
    </div>
  );
}

