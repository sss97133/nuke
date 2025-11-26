import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface TitleTransfer {
  id: string;
  vehicle_id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  transfer_date: string;
  sale_price?: number;
  transfer_type?: string;
  dispute_reason?: string;
  generated_documents?: any;
  vehicle?: {
    year: number;
    make: string;
    model: string;
    vin: string;
  };
  buyer?: {
    full_name: string;
    email: string;
  };
}

interface TitleTransferApprovalProps {
  userId: string;
  onUpdate?: () => void;
}

const TitleTransferApproval: React.FC<TitleTransferApprovalProps> = ({
  userId,
  onUpdate
}) => {
  const [transfers, setTransfers] = useState<TitleTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [showDisputeForm, setShowDisputeForm] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  useEffect(() => {
    loadTransfers();
  }, [userId]);

  const loadTransfers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('title_transfers')
        .select(`
          *,
          vehicle:vehicles(id, year, make, model, vin),
          buyer:profiles!title_transfers_to_user_id_fkey(id, full_name, email)
        `)
        .eq('from_user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading transfers:', error);
        return;
      }

      setTransfers(data || []);
    } catch (error) {
      console.error('Error loading transfers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (transferId: string) => {
    try {
      setProcessing(prev => new Set(prev).add(transferId));
      
      const { data, error } = await supabase
        .rpc('approve_title_transfer', {
          p_transfer_id: transferId,
          p_seller_user_id: userId
        });

      if (error) {
        console.error('Error approving transfer:', error);
        alert('Failed to approve transfer');
        return;
      }

      alert('Transfer approved! Paperwork has been generated.');
      await loadTransfers();
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error approving transfer:', error);
      alert('Failed to approve transfer');
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(transferId);
        return next;
      });
    }
  };

  const handleDispute = async (transferId: string) => {
    if (!disputeReason.trim()) {
      alert('Please provide a reason for disputing this transfer');
      return;
    }

    try {
      setProcessing(prev => new Set(prev).add(transferId));
      
      const { data, error } = await supabase
        .rpc('dispute_title_transfer', {
          p_transfer_id: transferId,
          p_seller_user_id: userId,
          p_dispute_reason: disputeReason
        });

      if (error) {
        console.error('Error disputing transfer:', error);
        alert('Failed to dispute transfer');
        return;
      }

      alert('Transfer disputed. The claim has been rejected and requires review.');
      setShowDisputeForm(null);
      setDisputeReason('');
      await loadTransfers();
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error disputing transfer:', error);
      alert('Failed to dispute transfer');
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(transferId);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '12px', fontSize: '8pt', color: 'var(--text-muted)' }}>
        Loading transfer requests...
      </div>
    );
  }

  if (transfers.length === 0) {
    return null;
  }

  return (
    <div style={{
      marginBottom: '16px',
      border: '2px solid #dc2626',
      borderRadius: '4px',
      background: 'white'
    }}>
      <div style={{
        padding: '12px',
        background: '#dc2626',
        color: 'white',
        fontSize: '9pt',
        fontWeight: 700
      }}>
        {transfers.length} Title Transfer{transfers.length !== 1 ? 's' : ''} Require Your Approval
      </div>

      <div style={{ padding: '12px' }}>
        {transfers.map((transfer) => (
          <div
            key={transfer.id}
            style={{
              padding: '12px',
              marginBottom: '12px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: '#fef2f2'
            }}
          >
            <div style={{
              fontSize: '8pt',
              fontWeight: 600,
              marginBottom: '8px',
              color: 'var(--text)'
            }}>
              {transfer.vehicle?.year} {transfer.vehicle?.make} {transfer.vehicle?.model}
              {transfer.vehicle?.vin && ` (VIN: ${transfer.vehicle.vin})`}
            </div>

            <div style={{
              fontSize: '7pt',
              color: 'var(--text-muted)',
              marginBottom: '12px'
            }}>
              <strong>{transfer.buyer?.full_name || 'Unknown buyer'}</strong> is claiming title ownership.
              {transfer.transfer_date && (
                <> Transfer date: {new Date(transfer.transfer_date).toLocaleDateString()}</>
              )}
            </div>

            {showDisputeForm === transfer.id ? (
              <div style={{ marginBottom: '12px' }}>
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Why are you disputing this transfer? (e.g., 'I never sold this vehicle', 'This is fraudulent', etc.)"
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '8px',
                    fontSize: '8pt',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    fontFamily: 'inherit'
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleDispute(transfer.id)}
                    disabled={processing.has(transfer.id) || !disputeReason.trim()}
                    style={{
                      padding: '6px 16px',
                      fontSize: '8pt',
                      fontWeight: 600,
                      border: '1px solid #dc2626',
                      background: '#dc2626',
                      color: 'white',
                      cursor: processing.has(transfer.id) ? 'wait' : 'pointer',
                      borderRadius: '4px',
                      opacity: processing.has(transfer.id) || !disputeReason.trim() ? 0.5 : 1
                    }}
                  >
                    {processing.has(transfer.id) ? 'Processing...' : 'DISPUTE TRANSFER'}
                  </button>
                  <button
                    onClick={() => {
                      setShowDisputeForm(null);
                      setDisputeReason('');
                    }}
                    disabled={processing.has(transfer.id)}
                    style={{
                      padding: '6px 16px',
                      fontSize: '8pt',
                      fontWeight: 600,
                      border: '1px solid var(--border)',
                      background: 'white',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      borderRadius: '4px'
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleApprove(transfer.id)}
                  disabled={processing.has(transfer.id)}
                  style={{
                    padding: '6px 16px',
                    fontSize: '8pt',
                    fontWeight: 600,
                    border: '1px solid #059669',
                    background: '#059669',
                    color: 'white',
                    cursor: processing.has(transfer.id) ? 'wait' : 'pointer',
                    borderRadius: '4px',
                    opacity: processing.has(transfer.id) ? 0.5 : 1
                  }}
                >
                  {processing.has(transfer.id) ? 'Processing...' : 'APPROVE TRANSFER'}
                </button>

                <button
                  onClick={() => setShowDisputeForm(transfer.id)}
                  disabled={processing.has(transfer.id)}
                  style={{
                    padding: '6px 16px',
                    fontSize: '8pt',
                    fontWeight: 600,
                    border: '1px solid #dc2626',
                    background: 'white',
                    color: '#dc2626',
                    cursor: processing.has(transfer.id) ? 'wait' : 'pointer',
                    borderRadius: '4px',
                    opacity: processing.has(transfer.id) ? 0.5 : 1
                  }}
                >
                  DISPUTE / DENY
                </button>
              </div>
            )}

            <div style={{
              fontSize: '7pt',
              color: '#dc2626',
              marginTop: '8px',
              fontStyle: 'italic'
            }}>
              ⚠️ If you did not sell or transfer this vehicle, you must dispute this claim immediately.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TitleTransferApproval;

