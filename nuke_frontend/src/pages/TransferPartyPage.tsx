/**
 * Buyer / Seller Transfer Page
 * /t/:transferId?token=<access_token>
 *
 * Public, no-auth page accessible via unique link.
 * Shows the vehicle, milestone progress, and lets parties signal updates.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

const MILESTONE_LABELS: Record<string, string> = {
  agreement_reached: 'Deal agreed',
  contact_exchanged: 'Contact exchanged',
  discussion_complete: 'Discussion complete',
  contract_drafted: 'Contract drafted',
  contract_signed_seller: 'Seller signed contract',
  contract_signed_buyer: 'Buyer signed contract',
  deposit_triggered: 'Deposit requested',
  deposit_sent: 'Deposit sent',
  deposit_received: 'Deposit received',
  deposit_confirmed: 'Deposit confirmed',
  full_payment_triggered: 'Full payment requested',
  full_payment_sent: 'Full payment sent',
  full_payment_received: 'Full payment received',
  payment_confirmed: 'Payment confirmed',
  inspection_scheduled: 'Inspection scheduled',
  inspection_live: 'Inspection in progress',
  inspection_completed: 'Inspection complete',
  insurance_triggered: 'Insurance requested',
  insurance_confirmed: 'Insurance confirmed',
  title_sent: 'Title mailed',
  title_in_transit: 'Title in transit',
  title_received: 'Title received',
  shipping_requested: 'Shipping requested',
  shipping_initiated: 'Vehicle picked up',
  vehicle_arrived: 'Vehicle delivered',
  transfer_complete: 'Transfer complete',
  obligations_defined: 'Obligations agreed',
  obligation_met: 'Obligation fulfilled',
};

// What message to show buyers/sellers for each pending milestone
const MILESTONE_CTA: Record<string, string> = {
  contact_exchanged: 'Have you exchanged contact information with the other party?',
  discussion_complete: 'Have you finished all questions and pre-sale discussions?',
  contract_drafted: 'Has a purchase agreement been drafted?',
  contract_signed_seller: 'Has the seller signed the purchase agreement?',
  contract_signed_buyer: 'Has the buyer signed the purchase agreement?',
  deposit_triggered: 'Has a deposit payment been requested?',
  deposit_sent: 'Has the buyer sent the deposit?',
  deposit_received: 'Has the seller received the deposit?',
  deposit_confirmed: 'Has the deposit payment cleared?',
  full_payment_triggered: 'Has the final payment been requested?',
  full_payment_sent: 'Has the buyer sent the full payment?',
  full_payment_received: 'Has the seller received the full payment?',
  payment_confirmed: 'Has the full payment cleared and been confirmed?',
  inspection_scheduled: 'Has a pre-purchase inspection been scheduled?',
  inspection_live: 'Is the inspection currently in progress?',
  inspection_completed: 'Has the inspection been completed?',
  insurance_triggered: 'Has insurance documentation been requested?',
  insurance_confirmed: 'Has the buyer provided proof of insurance?',
  title_sent: 'Has the seller sent the vehicle title?',
  title_in_transit: 'Is the title in transit to the buyer?',
  title_received: 'Has the buyer received the title?',
  shipping_requested: 'Has shipping/transport been arranged?',
  shipping_initiated: 'Has the vehicle been picked up by transport?',
  vehicle_arrived: 'Has the vehicle arrived at its destination?',
  transfer_complete: 'Is the transfer fully complete?',
};

interface TransferState {
  transfer_id: string;
  vehicle_id: string;
  status: string;
  agreed_price: number | null;
  currency: string;
  sale_date: string | null;
  inbox_email: string | null;
  progress: { completed: number; total: number; pct: number };
  current_milestone: { type: string; label: string; status: string; deadline_at: string | null } | null;
  next_milestone: { type: string; label: string; deadline_at: string | null } | null;
  days_since_activity: number | null;
  seller: { handle: string; platform: string; claimed: boolean } | null;
  buyer: { handle: string; platform: string; claimed: boolean } | null;
  milestones?: Array<{
    sequence: number;
    milestone_type: string;
    status: string;
    required: boolean;
    deadline_at: string | null;
    completed_at: string | null;
  }>;
}

interface VehicleInfo {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  image_url: string | null;
  primary_image_url: string | null;
}

export default function TransferPartyPage() {
  const { transferId } = useParams<{ transferId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'buyer' | 'seller' | 'observer'>('observer');

  // Signal submission
  const [signalText, setSignalText] = useState('');
  const [signaling, setSignaling] = useState(false);
  const [signalResult, setSignalResult] = useState<string | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);

  // Quick confirm
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (!transferId) {
      setError('No transfer ID provided.');
      setLoading(false);
      return;
    }
    loadTransfer();
  }, [transferId]);

  const loadTransfer = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch transfer status
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/transfer-status-api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ transfer_id: transferId }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? 'Failed to load transfer');
      if (!data.transfer_id) throw new Error('Transfer not found');
      setTransfer(data);

      // Determine role from token
      // We need the raw tokens — fetch ownership_transfers directly
      const tokenResp = await fetch(`${SUPABASE_URL}/functions/v1/transfer-status-api`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      // Token check: we'll use a separate DB call
      if (token) {
        const roleResp = await fetch(
          `${SUPABASE_URL}/rest/v1/ownership_transfers?id=eq.${transferId}&select=buyer_access_token,seller_access_token`,
          {
            headers: {
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              apikey: SUPABASE_ANON_KEY,
            },
          }
        );
        if (roleResp.ok) {
          const rows = await roleResp.json();
          if (rows.length > 0) {
            if (rows[0].buyer_access_token === token) setRole('buyer');
            else if (rows[0].seller_access_token === token) setRole('seller');
          }
        }
      }

      // Fetch vehicle details
      const vResp = await fetch(
        `${SUPABASE_URL}/rest/v1/vehicles?id=eq.${data.vehicle_id}&select=id,year,make,model,vin,image_url,primary_image_url`,
        {
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
          },
        }
      );
      if (vResp.ok) {
        const vehicles = await vResp.json();
        if (vehicles.length > 0) setVehicle(vehicles[0]);
      }

      // Fetch milestones
      const msResp = await fetch(
        `${SUPABASE_URL}/rest/v1/transfer_milestones?transfer_id=eq.${transferId}&select=sequence,milestone_type,status,required,deadline_at,completed_at&order=sequence.asc`,
        {
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
          },
        }
      );
      if (msResp.ok) {
        const milestones = await msResp.json();
        setTransfer(prev => prev ? { ...prev, milestones } : prev);
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const sendSignal = async () => {
    if (!signalText.trim() || !transferId) return;
    setSignaling(true);
    setSignalError(null);
    setSignalResult(null);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/transfer-advance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'ingest_signal',
          transfer_id: transferId,
          signal_type: 'manual',
          signal_text: signalText.trim(),
          signal_metadata: { role, token },
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? 'Failed to send update');
      setSignalResult(data.advanced
        ? `Update received — milestone "${MILESTONE_LABELS[data.milestone_type] ?? data.milestone_type}" marked complete.`
        : 'Update received. No milestone change detected — an operator will review.');
      setSignalText('');
      setTimeout(loadTransfer, 1000);
    } catch (e: any) {
      setSignalError(e.message ?? String(e));
    } finally {
      setSignaling(false);
    }
  };

  const confirmMilestone = async (milestoneType: string) => {
    if (!transferId) return;
    setConfirming(milestoneType);
    setConfirmError(null);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/transfer-advance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'advance_manual',
          transfer_id: transferId,
          milestone_type: milestoneType,
          notes: `Confirmed by ${role} via transfer page`,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error ?? 'Failed');
      setTimeout(loadTransfer, 500);
    } catch (e: any) {
      setConfirmError(e.message ?? String(e));
    } finally {
      setConfirming(null);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b', fontSize: '14px' }}>Loading transfer...</div>
      </div>
    );
  }

  if (error || !transfer) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
        <div style={{ color: '#f87171', fontSize: '16px', fontWeight: 600 }}>Transfer not found</div>
        <div style={{ color: '#64748b', fontSize: '13px' }}>{error ?? 'This transfer link may be expired or invalid.'}</div>
      </div>
    );
  }

  const vehicleName = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
  const vehicleImage = vehicle?.primary_image_url ?? vehicle?.image_url;

  const requiredMilestones = (transfer.milestones ?? []).filter(m => m.required && m.status !== 'skipped');
  const completedMilestones = requiredMilestones.filter(m => m.status === 'completed');
  const progressPct = requiredMilestones.length > 0 ? (completedMilestones.length / requiredMilestones.length) * 100 : 0;

  const isComplete = transfer.status === 'completed';

  const fmtPrice = (price: number | null, currency: string) => {
    if (!price) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(price);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top nav */}
      <div style={{ background: '#0a0f1e', borderBottom: '1px solid #1e293b', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
          nuke<span style={{ color: '#3b82f6' }}>.</span>ag
        </div>
        {role !== 'observer' && (
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Viewing as <span style={{ color: role === 'buyer' ? '#86efac' : '#93c5fd', fontWeight: 600 }}>{role}</span>
          </div>
        )}
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Vehicle card */}
        <div style={{ background: '#1e293b', borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' }}>
          {vehicleImage && (
            <div style={{ height: '200px', overflow: 'hidden', background: '#0f172a' }}>
              <img
                src={vehicleImage}
                alt={vehicleName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
          <div style={{ padding: '20px' }}>
            <h1 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 700, color: '#f8fafc' }}>{vehicleName}</h1>
            {vehicle?.vin && (
              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '8px', fontFamily: 'monospace' }}>VIN: {vehicle.vin}</div>
            )}
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
              {transfer.agreed_price && (
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#34d399' }}>
                  {fmtPrice(transfer.agreed_price, transfer.currency)}
                </div>
              )}
              <div style={{
                padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                background: isComplete ? '#14532d' : '#1e3a5f',
                color: isComplete ? '#86efac' : '#93c5fd',
              }}>
                {isComplete ? 'Complete' : 'In Progress'}
              </div>
            </div>
            {transfer.seller && (
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '8px' }}>
                {transfer.seller.handle} → {transfer.buyer?.handle ?? 'buyer TBD'}
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9' }}>Transfer Progress</div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {completedMilestones.length} of {requiredMilestones.length} steps done
            </div>
          </div>
          <div style={{ background: '#0f172a', borderRadius: '6px', height: '10px', overflow: 'hidden', marginBottom: '16px' }}>
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: isComplete ? '#22c55e' : 'linear-gradient(90deg, #3b82f6, #818cf8)',
                borderRadius: '6px',
                transition: 'width 0.5s ease',
              }}
            />
          </div>

          {/* Milestone timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(transfer.milestones ?? [])
              .filter(m => m.required)
              .map((m, idx) => {
                const label = MILESTONE_LABELS[m.milestone_type] ?? m.milestone_type;
                const isPending = m.status === 'pending' || m.status === 'overdue';
                const isOverdue = m.status === 'overdue';
                const isDone = m.status === 'completed';
                const isSkipped = m.status === 'skipped';
                const isCurrent = !isDone && !isSkipped && idx === (transfer.milestones ?? []).filter(m => m.required).findIndex(mm => mm.status !== 'completed' && mm.status !== 'skipped');
                const canConfirm = isCurrent && role !== 'observer';

                return (
                  <div
                    key={m.milestone_type}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 12px', borderRadius: '8px',
                      background: isCurrent ? '#1a2d4a' : 'transparent',
                      border: isCurrent ? '1px solid #334155' : '1px solid transparent',
                      opacity: isSkipped ? 0.4 : 1,
                    }}
                  >
                    {/* Status icon */}
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isDone ? '#14532d' : isOverdue ? '#450a0a' : isCurrent ? '#1e3a5f' : '#1e293b',
                      border: `2px solid ${isDone ? '#22c55e' : isOverdue ? '#ef4444' : isCurrent ? '#3b82f6' : '#334155'}`,
                      fontSize: '12px',
                    }}>
                      {isDone ? '✓' : isOverdue ? '!' : isCurrent ? '→' : '·'}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '13px',
                        fontWeight: isCurrent ? 600 : 400,
                        color: isDone ? '#64748b' : isCurrent ? '#f1f5f9' : '#94a3b8',
                        textDecoration: isSkipped ? 'line-through' : 'none',
                      }}>
                        {label}
                      </div>
                      {isDone && m.completed_at && (
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                          Done {new Date(m.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                      {isOverdue && m.deadline_at && (
                        <div style={{ fontSize: '11px', color: '#f87171', marginTop: '2px' }}>
                          Overdue since {new Date(m.deadline_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>

                    {canConfirm && (
                      <button
                        onClick={() => confirmMilestone(m.milestone_type)}
                        disabled={confirming === m.milestone_type}
                        style={{
                          background: '#14532d', color: '#86efac', border: '1px solid #166534',
                          borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 600,
                          cursor: confirming === m.milestone_type ? 'wait' : 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {confirming === m.milestone_type ? '...' : 'Confirm'}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>

          {confirmError && (
            <div style={{ color: '#f87171', fontSize: '12px', marginTop: '8px' }}>{confirmError}</div>
          )}
        </div>

        {/* Current action prompt */}
        {!isComplete && transfer.current_milestone && (
          <div style={{ background: '#1a2d4a', border: '1px solid #1e3a5f', borderRadius: '10px', padding: '20px', marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Waiting on
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#f1f5f9', marginBottom: '4px' }}>
              {transfer.current_milestone.label}
            </div>
            {MILESTONE_CTA[transfer.current_milestone.type] && (
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '8px' }}>
                {MILESTONE_CTA[transfer.current_milestone.type]}
              </div>
            )}
          </div>
        )}

        {/* Free-form signal */}
        {!isComplete && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px', marginBottom: '24px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#f1f5f9', marginBottom: '8px' }}>
              Send an update
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px' }}>
              Describe what happened and we'll automatically advance the right step.
              Examples: "I just sent the wire transfer" · "Inspection is complete, car is great" · "Title is in the mail"
            </div>
            <textarea
              value={signalText}
              onChange={e => setSignalText(e.target.value)}
              placeholder="What happened? (e.g. 'I wired the deposit this morning')"
              rows={3}
              style={{
                width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px',
                color: '#e2e8f0', padding: '10px 12px', fontSize: '13px', resize: 'vertical',
                boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
              }}
            />
            {signalError && (
              <div style={{ color: '#f87171', fontSize: '12px', marginTop: '6px' }}>{signalError}</div>
            )}
            {signalResult && (
              <div style={{ color: '#86efac', fontSize: '12px', marginTop: '6px' }}>{signalResult}</div>
            )}
            <button
              onClick={sendSignal}
              disabled={!signalText.trim() || signaling}
              style={{
                marginTop: '10px',
                background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px',
                padding: '9px 20px', fontSize: '13px', fontWeight: 600,
                cursor: !signalText.trim() || signaling ? 'not-allowed' : 'pointer',
                opacity: !signalText.trim() ? 0.5 : 1,
              }}
            >
              {signaling ? 'Sending...' : 'Send Update'}
            </button>
          </div>
        )}

        {isComplete && (
          <div style={{ background: '#14532d', border: '1px solid #166534', borderRadius: '10px', padding: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>✓</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#86efac' }}>Transfer Complete</div>
            <div style={{ fontSize: '13px', color: '#4ade80', marginTop: '6px' }}>
              {vehicleName} has been successfully transferred.
            </div>
          </div>
        )}

        {/* Contact info */}
        {transfer.inbox_email && (
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: '20px', marginTop: '8px' }}>
            <div style={{ fontSize: '12px', color: '#475569' }}>
              Questions? Email <a href={`mailto:${transfer.inbox_email}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>{transfer.inbox_email}</a> — replies automatically update your transfer.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
