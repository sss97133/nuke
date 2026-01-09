import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface OwnershipDetailsPopupProps {
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
  salePrice?: number;
  saleDate?: string;
}

export const OwnershipDetailsPopup: React.FC<OwnershipDetailsPopupProps> = ({
  vehicleId,
  isOpen,
  onClose,
  salePrice,
  saleDate
}) => {
  const [ownerships, setOwnerships] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !vehicleId) return;

    const loadOwnershipData = async () => {
      try {
        setLoading(true);
        
        // Load ownership history with profile data
        // Try explicit FK syntax first, fallback to simple if needed
        let ownershipData: any[] = [];
        let ownershipError: any = null;
        
        const ownershipResult = await supabase
          .from('vehicle_ownerships')
          .select(`
            *,
            owner_profile:profiles!owner_profile_id(id, full_name, username)
          `)
          .eq('vehicle_id', vehicleId)
          .order('start_date', { ascending: false });

        if (ownershipResult.error) {
          // Fallback: load without profile join if FK syntax fails
          console.warn('Error loading ownerships with profile join:', ownershipResult.error);
          const fallbackResult = await supabase
            .from('vehicle_ownerships')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .order('start_date', { ascending: false });
          
          if (!fallbackResult.error) {
            ownershipData = fallbackResult.data || [];
            // Load profiles separately if needed
            const ownerIds = ownershipData.map(o => o.owner_profile_id).filter(Boolean);
            if (ownerIds.length > 0) {
              const { data: profiles } = await supabase
                .from('profiles')
                .select('id, full_name, username')
                .in('id', ownerIds);
              
              // Merge profile data
              const profilesMap = new Map((profiles || []).map(p => [p.id, p]));
              ownershipData = ownershipData.map(o => ({
                ...o,
                owner_profile: profilesMap.get(o.owner_profile_id) || null
              }));
            }
          } else {
            ownershipError = fallbackResult.error;
          }
        } else {
          ownershipData = ownershipResult.data || [];
        }

        // Load ownership transfers with profile data
        let transferData: any[] = [];
        let transferError: any = null;
        
        const transferResult = await supabase
          .from('ownership_transfers')
          .select(`
            *,
            from_owner:profiles!from_owner_id(id, full_name, username),
            to_owner:profiles!to_owner_id(id, full_name, username)
          `)
          .eq('vehicle_id', vehicleId)
          .order('transfer_date', { ascending: false });

        if (transferResult.error) {
          // Fallback: load without profile join if FK syntax fails
          console.warn('Error loading transfers with profile join:', transferResult.error);
          const fallbackResult = await supabase
            .from('ownership_transfers')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .order('transfer_date', { ascending: false });
          
          if (!fallbackResult.error) {
            transferData = fallbackResult.data || [];
            // Load profiles separately if needed
            const ownerIds = [
              ...transferData.map(t => t.from_owner_id).filter(Boolean),
              ...transferData.map(t => t.to_owner_id).filter(Boolean)
            ];
            if (ownerIds.length > 0) {
              const { data: profiles } = await supabase
                .from('profiles')
                .select('id, full_name, username')
                .in('id', ownerIds);
              
              // Merge profile data
              const profilesMap = new Map((profiles || []).map(p => [p.id, p]));
              transferData = transferData.map(t => ({
                ...t,
                from_owner: t.from_owner_id ? (profilesMap.get(t.from_owner_id) || null) : null,
                to_owner: t.to_owner_id ? (profilesMap.get(t.to_owner_id) || null) : null
              }));
            }
          } else {
            transferError = fallbackResult.error;
          }
        } else {
          transferData = transferResult.data || [];
        }

        setOwnerships(ownershipData || []);
        setTransfers(transferData || []);
      } catch (error) {
        console.error('Error loading ownership data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadOwnershipData();
  }, [isOpen, vehicleId]);

  if (!isOpen) return null;

  const currentOwners = ownerships.filter(o => o.is_current);
  const historicalOwners = ownerships.filter(o => !o.is_current);
  const recentTransfers = transfers.filter(t => {
    if (!t.transfer_date) return false;
    const daysAgo = (Date.now() - new Date(t.transfer_date).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 90;
  });

  // Helper to get owner name (from profile or metadata)
  const getOwnerName = (owner: any, fallbackMetadata?: any) => {
    if (owner?.owner_profile?.full_name) return owner.owner_profile.full_name;
    if (owner?.owner_profile?.username) return owner.owner_profile.username;
    if (fallbackMetadata?.buyer_name) return fallbackMetadata.buyer_name;
    if (fallbackMetadata?.seller_name) return fallbackMetadata.seller_name;
    return 'Unknown';
  };

  // Helper to get transfer party names
  const getTransferFromName = (transfer: any) => {
    if (transfer?.from_owner?.full_name) return transfer.from_owner.full_name;
    if (transfer?.from_owner?.username) return transfer.from_owner.username;
    if (transfer?.metadata?.seller_name) return transfer.metadata.seller_name;
    return 'Unknown';
  };

  const getTransferToName = (transfer: any) => {
    if (transfer?.to_owner?.full_name) return transfer.to_owner.full_name;
    if (transfer?.to_owner?.username) return transfer.to_owner.username;
    if (transfer?.metadata?.buyer_name) return transfer.metadata.buyer_name;
    return 'Unknown';
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          padding: '20px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '12pt', fontWeight: 700, margin: 0 }}>Ownership History</h3>
          <button
            onClick={onClose}
            style={{
              padding: '4px 8px',
              border: '1px solid var(--border)',
              background: 'var(--white)',
              cursor: 'pointer',
              fontSize: '8pt'
            }}
          >
            CLOSE
          </button>
        </div>

        {/* Sale Info */}
        {salePrice && (
          <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--grey-100)', borderRadius: '4px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
              Sale Price
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 700 }}>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(salePrice)}
            </div>
            {saleDate && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                {new Date(saleDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Loading ownership data...
          </div>
        ) : (
          <>
            {/* Ownership Context Summary */}
            {ownerships.length > 0 || transfers.length > 0 ? (
              <div style={{ marginBottom: '20px' }}>
                {(() => {
                  if (recentTransfers.length > 0) {
                    return (
                      <div style={{ padding: '8px', background: '#fef3c7', borderRadius: '4px', fontSize: '8pt' }}>
                        <strong>Recent Ownership Change:</strong> {recentTransfers.length} transfer{recentTransfers.length > 1 ? 's' : ''} in last 90 days
                      </div>
                    );
                  }
                  if (ownerships.length >= 3) {
                    return (
                      <div style={{ padding: '8px', background: '#e0e7ff', borderRadius: '4px', fontSize: '8pt' }}>
                        <strong>Multiple Owners:</strong> {ownerships.length} total owners
                      </div>
                    );
                  }
                  if (currentOwners.length === 1 && currentOwners[0].start_date) {
                    const daysOwned = (Date.now() - new Date(currentOwners[0].start_date).getTime()) / (1000 * 60 * 60 * 24);
                    if (daysOwned > 365) {
                      return (
                        <div style={{ padding: '8px', background: '#dcfce7', borderRadius: '4px', fontSize: '8pt' }}>
                          <strong>Stable Ownership:</strong> {Math.floor(daysOwned / 365)} year{Math.floor(daysOwned / 365) > 1 ? 's' : ''} owned
                        </div>
                      );
                    }
                  }
                  return null;
                })()}
              </div>
            ) : null}

            {/* Current Owners */}
            {currentOwners.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', color: 'var(--text-muted)' }}>
                  Current Owner{currentOwners.length > 1 ? 's' : ''}
                </div>
                {currentOwners.map((owner, idx) => (
                  <div key={idx} style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '4px' }}>
                    <div style={{ fontWeight: 600 }}>
                      {getOwnerName(owner)}
                    </div>
                    {owner.start_date && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                        Since {new Date(owner.start_date).toLocaleDateString()}
                      </div>
                    )}
                    {owner.role && owner.role !== 'owner' && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                        Role: {owner.role}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Ownership Transfers */}
            {transfers.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', color: 'var(--text-muted)' }}>
                  Ownership Transfers ({transfers.length})
                </div>
                {transfers.slice(0, 5).map((transfer, idx) => (
                  <div key={idx} style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '4px', fontSize: '8pt' }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      {new Date(transfer.transfer_date).toLocaleDateString()}
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      {getTransferFromName(transfer)} → {getTransferToName(transfer)}
                    </div>
                    {transfer.source && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Source: {transfer.source}
                      </div>
                    )}
                    {transfer.price && (
                      <div style={{ fontSize: '7pt', fontWeight: 600, marginTop: '2px' }}>
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(transfer.price)}
                      </div>
                    )}
                  </div>
                ))}
                {transfers.length > 5 && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    +{transfers.length - 5} more transfers
                  </div>
                )}
              </div>
            )}

            {/* Historical Owners */}
            {historicalOwners.length > 0 && (
              <div>
                <div style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', color: 'var(--text-muted)' }}>
                  Previous Owner{historicalOwners.length > 1 ? 's' : ''} ({historicalOwners.length})
                </div>
                {historicalOwners.slice(0, 3).map((owner, idx) => (
                  <div key={idx} style={{ padding: '6px', fontSize: '7pt', color: 'var(--text-muted)' }}>
                    {getOwnerName(owner)}
                    {owner.start_date && owner.end_date && (
                      <span> ({new Date(owner.start_date).getFullYear()}-{new Date(owner.end_date).getFullYear()})</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Empty State */}
            {ownerships.length === 0 && transfers.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '8pt' }}>
                <div style={{ marginBottom: '8px' }}>No ownership history available</div>
                <div style={{ fontSize: '7pt', opacity: 0.7 }}>
                  Ownership data will appear here as transfers are recorded from sales and title verifications.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

