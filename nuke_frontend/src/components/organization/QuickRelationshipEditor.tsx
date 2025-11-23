import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  orgVehicleId: string;
  currentRelationship: string;
  currentStatus: string;
  currentNotes?: string;
  vehicleName: string;
  vehicleId: string;
  onUpdate: () => void;
  onClose: () => void;
}

const RELATIONSHIP_TYPES = [
  { value: 'owner', label: 'Owner', description: 'We own this' },
  { value: 'consigner', label: 'Consignment', description: 'Selling for owner' },
  { value: 'work_location', label: 'Work Location', description: 'Work done here' },
  { value: 'service_provider', label: 'Service Provider', description: 'We serviced it' },
  { value: 'sold_by', label: 'Sold By Us', description: 'We sold it' },
  { value: 'storage', label: 'Storage', description: 'Stored here' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'sold', label: 'Sold' },
  { value: 'past', label: 'Past' },
];

const QuickRelationshipEditor: React.FC<Props> = ({
  orgVehicleId,
  currentRelationship,
  currentStatus,
  currentNotes,
  vehicleName,
  vehicleId,
  onUpdate,
  onClose
}) => {
  const [relationship, setRelationship] = useState(currentRelationship);
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState(currentNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleImage, setVehicleImage] = useState<string | null>(null);
  const [detectedOwner, setDetectedOwner] = useState<any>(null);
  const [profileMerges, setProfileMerges] = useState<any[]>([]);
  const [detectingOwner, setDetectingOwner] = useState(false);
  
  // Load vehicle thumbnail
  useEffect(() => {
    const loadImage = async () => {
      const { data } = await supabase
        .from('vehicle_images')
        .select('thumbnail_url, medium_url')
        .eq('vehicle_id', vehicleId)
        .limit(1)
        .single();
      
      if (data) {
        setVehicleImage(data.medium_url || data.thumbnail_url);
      }
    };
    loadImage();
  }, [vehicleId]);

  // Auto-detect owner when storage is selected
  useEffect(() => {
    const detectOwner = async () => {
      if (relationship !== 'storage') {
        setDetectedOwner(null);
        setProfileMerges([]);
        return;
      }
      
      try {
        setDetectingOwner(true);
        const { data, error } = await supabase.functions.invoke('auto-detect-vehicle-owner', {
          body: { vehicle_id: vehicleId }
        });

        if (!error && data) {
          setDetectedOwner(data.most_likely_owner);
          setProfileMerges(data.profile_merge_suggestions || []);
          
          if (data.most_likely_owner) {
            console.log('✅ Detected owner:', data.most_likely_owner.owner_name);
          }
        }
      } catch (err) {
        console.error('Owner detection failed:', err);
      } finally {
        setDetectingOwner(false);
      }
    };

    detectOwner();
  }, [relationship, vehicleId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      console.log('Updating org vehicle:', { orgVehicleId, relationship, status });
      
      const { data, error: updateError } = await supabase
        .from('organization_vehicles')
        .update({
          relationship_type: relationship,
          status: status,
          notes: notes || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', orgVehicleId)
        .select();

      console.log('Update result:', { data, error: updateError });

      if (updateError) {
        console.error('Update failed:', updateError);
        throw new Error(`Update failed: ${updateError.message} (Code: ${updateError.code})`);
      }

      if (!data || data.length === 0) {
        throw new Error('No rows updated. You may not have permission to edit this vehicle relationship. Check that you are an owner/manager of this organization or the vehicle owner.');
      }

      // Success!
      alert('✅ Relationship updated successfully!');
      onUpdate();
      onClose();
    } catch (err) {
      console.error('Error updating relationship:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to update';
      setError(errorMsg);
      alert('❌ Failed to save: ' + errorMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div 
        className="card"
        style={{
          maxWidth: '500px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ 
          fontSize: '11pt', 
          fontWeight: 700,
          borderBottom: '2px solid var(--border-medium)'
        }}>
          Edit Relationship
        </div>
        
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {vehicleImage && (
              <div style={{
                width: '80px',
                height: '80px',
                backgroundImage: `url(${vehicleImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                flexShrink: 0
              }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                {vehicleName}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                Click to change relationship type and status
              </div>
            </div>
          </div>

          {error && (
            <div style={{
              padding: '12px',
              background: 'var(--error-dim)',
              border: '1px solid var(--error)',
              borderRadius: '4px',
              fontSize: '9pt',
              color: 'var(--error)'
            }}>
              {error}
            </div>
          )}

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 600, 
              marginBottom: '8px',
              color: 'var(--text-primary)'
            }}>
              Relationship Type
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {RELATIONSHIP_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setRelationship(type.value)}
                  style={{
                    padding: '12px',
                    border: '2px solid',
                    borderColor: relationship === type.value ? 'var(--accent)' : 'var(--border-light)',
                    background: relationship === type.value ? 'var(--accent-dim)' : 'transparent',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ fontSize: '8pt', fontWeight: 700 }}>
                    {type.label}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    {type.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Detected Owner Info */}
          {relationship === 'storage' && (
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--blue-50)',
              border: '2px solid var(--blue-300)',
              borderRadius: '4px'
            }}>
              <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
                Storage Relationship
              </div>
              {detectingOwner ? (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  Detecting vehicle owner...
                </div>
              ) : detectedOwner ? (
                <div style={{ fontSize: '8pt' }}>
                  <div style={{ marginBottom: '4px' }}>
                    <strong>Detected Owner:</strong> {detectedOwner.owner_name}
                  </div>
                  <div style={{ marginBottom: '4px', color: 'var(--text-muted)' }}>
                    Source: {detectedOwner.type.replace(/_/g, ' ')} ({Math.round(detectedOwner.confidence * 100)}% confidence)
                  </div>
                  {profileMerges.length > 0 && (
                    <div style={{ 
                      marginTop: '8px', 
                      paddingTop: '8px', 
                      borderTop: '1px solid var(--blue-200)',
                      fontSize: '7pt',
                      color: 'var(--orange-600)'
                    }}>
                      ⚠️ {profileMerges.length} incomplete profile{profileMerges.length > 1 ? 's' : ''} detected that may need merging
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  Could not auto-detect owner. You may need to add ownership info manually.
                </div>
              )}
            </div>
          )}

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 600, 
              marginBottom: '8px',
              color: 'var(--text-primary)'
            }}>
              Status
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '2px solid',
                    borderColor: status === opt.value ? 'var(--accent)' : 'var(--border-light)',
                    background: status === opt.value ? 'var(--accent-dim)' : 'transparent',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    fontWeight: 700,
                    transition: 'all 0.12s ease'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '9pt', 
              fontWeight: 600, 
              marginBottom: '8px',
              color: 'var(--text-primary)'
            }}>
              Notes / Labels (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="E.g., 'Partnered with Ernie's Upholstery', 'Featured build', 'Custom tags'..."
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '8px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Add notes about partnerships, collaboration details, or custom labels
            </div>
          </div>

          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            marginTop: '8px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-light)'
          }}>
            <button
              onClick={onClose}
              className="button button-secondary"
              style={{ flex: 1, fontSize: '9pt' }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="button button-primary"
              style={{ flex: 1, fontSize: '9pt' }}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickRelationshipEditor;

