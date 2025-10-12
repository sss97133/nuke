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

  const relationshipOptions = [
    { value: 'owned', label: 'I Own This', description: 'Currently own this vehicle' },
    { value: 'discovered', label: 'I Discovered', description: 'Found and brought to platform' },
    { value: 'curated', label: 'I Curate', description: 'Research and shine light on this vehicle' },
    { value: 'consigned', label: 'I\'m Consigning', description: 'Selling this for someone else' },
    { value: 'previously_owned', label: 'Previously Owned', description: 'Owned this vehicle in the past' },
    { value: 'interested', label: 'Interested', description: 'Just interested in this vehicle' }
  ];

  const updateRelationship = async (relationshipType: string) => {
    try {
      setUpdating(true);
      
      const { error } = await supabase.rpc('update_vehicle_relationship', {
        p_vehicle_id: vehicleId,
        p_user_id: (await supabase.auth.getUser()).data.user?.id,
        p_relationship_type: relationshipType
      });

      if (error) throw error;

      onUpdate?.(relationshipType);
    } catch (error) {
      console.error('Error updating relationship:', error);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ 
      padding: '8px', 
      backgroundColor: 'white', 
      border: '1px solid #bdbdbd',
      fontSize: '8pt'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
        My Relationship to This Vehicle:
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
        {relationshipOptions.map(option => (
          <label key={option.value} style={{ 
            display: 'flex', 
            alignItems: 'center',
            padding: '4px',
            backgroundColor: currentRelationship === option.value ? '#f5f5f5' : 'transparent',
            border: currentRelationship === option.value ? '1px solid #757575' : '1px solid transparent',
            cursor: 'pointer'
          }}>
            <input
              type="radio"
              name="relationship"
              value={option.value}
              checked={currentRelationship === option.value}
              onChange={() => updateRelationship(option.value)}
              disabled={updating}
              style={{ marginRight: '4px' }}
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
    </div>
  );
};

export default VehicleRelationshipManager;
