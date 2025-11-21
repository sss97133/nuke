import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface VerificationRequest {
  organization_vehicle_id: string;
  verification_type: 'relationship' | 'sale' | 'status_change';
  current_relationship_type?: string;
  proposed_relationship_type?: string;
  proposed_status?: string;
  proof_type?: 'bat_url' | 'receipt' | 'contract' | 'photo_metadata' | 'other';
  proof_url?: string;
  notes?: string;
}

interface Props {
  organizationVehicleId: string;
  currentRelationshipType: string;
  currentStatus: string;
  vehicleId: string;
  onVerificationSubmitted?: () => void;
}

const VehicleRelationshipVerification: React.FC<Props> = ({
  organizationVehicleId,
  currentRelationshipType,
  currentStatus,
  vehicleId,
  onVerificationSubmitted
}) => {
  const [showForm, setShowForm] = useState(false);
  const [verificationType, setVerificationType] = useState<'relationship' | 'sale' | 'status_change'>('relationship');
  const [proposedRelationshipType, setProposedRelationshipType] = useState<string>('');
  const [proposedStatus, setProposedStatus] = useState<string>('');
  const [proofType, setProofType] = useState<'bat_url' | 'receipt' | 'contract' | 'photo_metadata' | 'other'>('bat_url');
  const [proofUrl, setProofUrl] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be logged in');

      // Validate sale requires proof
      if (verificationType === 'sale' && !proofUrl && proofType !== 'other') {
        throw new Error('Sale verification requires proof (BAT URL, receipt, etc.)');
      }

      const verification: VerificationRequest = {
        organization_vehicle_id: organizationVehicleId,
        verification_type: verificationType,
        current_relationship_type: currentRelationshipType,
        proposed_relationship_type: verificationType === 'relationship' ? proposedRelationshipType : undefined,
        proposed_status: verificationType === 'sale' ? 'sold' : verificationType === 'status_change' ? proposedStatus : undefined,
        proof_type: verificationType === 'sale' ? proofType : undefined,
        proof_url: verificationType === 'sale' ? proofUrl : undefined,
        notes
      };

      const { error: insertError } = await supabase
        .from('vehicle_relationship_verifications')
        .insert({
          ...verification,
          requested_by_user_id: user.id
        });

      if (insertError) throw insertError;

      // If BAT URL provided, try to link it to external_listings
      if (verificationType === 'sale' && proofType === 'bat_url' && proofUrl) {
        const batMatch = proofUrl.match(/bringatrailer\.com\/listing\/([^\/]+)/);
        if (batMatch) {
          await supabase
            .from('external_listings')
            .upsert({
              vehicle_id: vehicleId,
              platform: 'bringatrailer',
              listing_url: proofUrl,
              sold_at: new Date().toISOString()
            }, {
              onConflict: 'vehicle_id,platform'
            });
        }
      }

      setShowForm(false);
      setProofUrl('');
      setNotes('');
      if (onVerificationSubmitted) onVerificationSubmitted();
    } catch (err: any) {
      setError(err.message || 'Failed to submit verification request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        style={{
          padding: '4px 8px',
          fontSize: '8pt',
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          cursor: 'pointer',
          borderRadius: '3px'
        }}
      >
        Verify Relationship
      </button>
    );
  }

  return (
    <div style={{
      padding: '12px',
      border: '2px solid var(--border)',
      borderRadius: '4px',
      background: 'var(--surface)',
      marginTop: '8px'
    }}>
      <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '12px' }}>
        Request Verification
      </div>

      {error && (
        <div style={{
          padding: '8px',
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '3px',
          fontSize: '8pt',
          color: '#c00',
          marginBottom: '12px'
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Verification Type */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Verification Type
          </label>
          <select
            value={verificationType}
            onChange={(e) => setVerificationType(e.target.value as any)}
            style={{
              width: '100%',
              padding: '6px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              borderRadius: '3px'
            }}
          >
            <option value="relationship">Change Relationship Type</option>
            <option value="sale">Mark as Sold (Requires Proof)</option>
            <option value="status_change">Change Status</option>
          </select>
        </div>

        {/* Relationship Type Change */}
        {verificationType === 'relationship' && (
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              New Relationship Type
            </label>
            <select
              value={proposedRelationshipType}
              onChange={(e) => setProposedRelationshipType(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '3px'
              }}
            >
              <option value="">Select...</option>
              <option value="in_stock">Inventory (Owned)</option>
              <option value="consignment">Consignment</option>
              <option value="work_location">Service/Work Location</option>
              <option value="owner">Owner</option>
              <option value="consigner">Consigner</option>
            </select>
          </div>
        )}

        {/* Sale Verification */}
        {verificationType === 'sale' && (
          <>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Proof Type *
              </label>
              <select
                value={proofType}
                onChange={(e) => setProofType(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '6px',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  borderRadius: '3px'
                }}
              >
                <option value="bat_url">BAT (Bring a Trailer) URL</option>
                <option value="receipt">Receipt/Invoice</option>
                <option value="contract">Contract</option>
                <option value="photo_metadata">Photo Metadata</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Proof URL *
              </label>
              <input
                type="url"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                placeholder="https://bringatrailer.com/listing/..."
                required={verificationType === 'sale'}
                style={{
                  width: '100%',
                  padding: '6px',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  borderRadius: '3px'
                }}
              />
            </div>
          </>
        )}

        {/* Status Change */}
        {verificationType === 'status_change' && (
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              New Status
            </label>
            <select
              value={proposedStatus}
              onChange={(e) => setProposedStatus(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                borderRadius: '3px'
              }}
            >
              <option value="">Select...</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '8pt', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Notes (Optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional context..."
            rows={3}
            style={{
              width: '100%',
              padding: '6px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              borderRadius: '3px',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setError(null);
            }}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              cursor: 'pointer',
              borderRadius: '3px'
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || (verificationType === 'sale' && !proofUrl)}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: 'none',
              background: submitting ? 'var(--text-muted)' : 'var(--accent)',
              color: 'white',
              cursor: submitting ? 'not-allowed' : 'pointer',
              borderRadius: '3px',
              fontWeight: 600
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default VehicleRelationshipVerification;

