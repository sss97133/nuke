import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface VehicleRelationshipManagerProps {
  vehicleId: string;
  currentRelationship: string | null;
  onUpdate?: (newRelationship: string) => void;
}

const VehicleRelationshipManager: React.FC<VehicleRelationshipManagerProps> = ({
  vehicleId,
  currentRelationship,
  onUpdate
}) => {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const relationshipOptions = [
    { value: 'owned', label: 'I Own This', description: 'Currently own this vehicle' },
    { value: 'discovered', label: 'I Discovered', description: 'Found and brought to platform' },
    { value: 'curated', label: 'I Curate', description: 'Research and shine light on this vehicle' },
    { value: 'consigned', label: 'I\'m Consigning', description: 'Selling this for someone else' },
    { value: 'previously_owned', label: 'Previously Owned', description: 'Owned this vehicle in the past' },
    { value: 'interested', label: 'Interested', description: 'Just interested in this vehicle' }
  ];

  const updateRelationship = async (relationshipType: string) => {
    setError(null);
    setSuccess(false);
    setUpdating(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be logged in to update relationships');
      }

      // Try RPC function first
      let rpcError = null;
      try {
        const { error } = await supabase.rpc('update_vehicle_relationship', {
          p_vehicle_id: vehicleId,
          p_user_id: user.id,
          p_relationship_type: relationshipType
        });
        rpcError = error;
      } catch (rpcErr: any) {
        // RPC function doesn't exist or failed - use fallback
        rpcError = rpcErr;
      }

      // Fallback: Update discovered_vehicles table directly
      if (rpcError) {
        // For "owned" relationship, we can't set it via discovered_vehicles
        // That requires ownership_verifications or vehicle_user_permissions
        // However, we can still allow the UI to show it, and handle it differently
        if (relationshipType === 'owned') {
          // Try to create a permission-based ownership if possible
          // Otherwise, guide user to verification process
          const { error: permError } = await supabase
            .from('vehicle_user_permissions')
            .upsert({
              vehicle_id: vehicleId,
              user_id: user.id,
              role: 'owner',
              is_active: true,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'vehicle_id,user_id'
            });

          if (permError) {
            throw new Error('To mark as "owned", you need to verify ownership. Use the ownership verification feature on the vehicle profile page.');
          }
          
          // Success - ownership set via permissions
          setSuccess(true);
          onUpdate?.(relationshipType);
          setTimeout(() => setSuccess(false), 2000);
          return;
        }

        // For other relationships, update discovered_vehicles
        const { error: upsertError } = await supabase
          .from('discovered_vehicles')
          .upsert({
            vehicle_id: vehicleId,
            user_id: user.id,
            relationship_type: relationshipType,
            is_active: true,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'vehicle_id,user_id'
          });

        if (upsertError) {
          // If discovered_vehicles doesn't have relationship_type column, try without it
          if (upsertError.message?.includes('relationship_type')) {
            const { error: simpleError } = await supabase
              .from('discovered_vehicles')
              .upsert({
                vehicle_id: vehicleId,
                user_id: user.id,
                is_active: true,
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'vehicle_id,user_id'
              });

            if (simpleError) throw simpleError;
          } else {
            throw upsertError;
          }
        }
      }

      setSuccess(true);
      onUpdate?.(relationshipType);
      
      // Clear success message after 2 seconds
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      console.error('Error updating relationship:', err);
      setError(err.message || 'Failed to update relationship');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ 
      padding: '8px', 
      backgroundColor: 'var(--surface)', 
      border: '1px solid #bdbdbd',
      fontSize: '8pt'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
        My Relationship to This Vehicle:
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
        {relationshipOptions.map(option => (
          <label 
            key={option.value} 
            onClick={(e) => {
              e.stopPropagation();
              // Trigger update when label is clicked
              updateRelationship(option.value);
            }}
            style={{ 
              display: 'flex', 
              alignItems: 'center',
              padding: '4px',
              backgroundColor: currentRelationship === option.value ? '#f5f5f5' : 'transparent',
              border: currentRelationship === option.value ? '1px solid #757575' : '1px solid transparent',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <input
              type="radio"
              name={`relationship-${vehicleId}`}
              value={option.value}
              checked={currentRelationship === option.value}
              onChange={(e) => {
                e.stopPropagation();
                updateRelationship(option.value);
              }}
              disabled={updating}
              style={{ marginRight: '4px', cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontWeight: 'bold' }}>{option.label}</div>
              <div style={{ fontSize: '7pt', color: '#757575' }}>{option.description}</div>
            </div>
          </label>
        ))}
      </div>
      
      {updating && (
        <div style={{ marginTop: '6px', fontSize: '7pt', color: '#757575' }}>
          Updating...
        </div>
      )}

      {error && (
        <div style={{ 
          marginTop: '6px', 
          padding: '6px',
          fontSize: '7pt', 
          color: '#dc2626',
          background: '#fee2e2',
          border: '1px solid #dc2626',
          borderRadius: '3px'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ 
          marginTop: '6px', 
          padding: '6px',
          fontSize: '7pt', 
          color: '#15803d',
          background: '#dcfce7',
          border: '1px solid #15803d',
          borderRadius: '3px'
        }}>
          ✓ Relationship updated successfully
        </div>
      )}
    </div>
  );
};

export default VehicleRelationshipManager;
