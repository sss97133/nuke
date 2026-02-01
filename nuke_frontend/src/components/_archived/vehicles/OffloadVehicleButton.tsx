import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface OffloadVehicleButtonProps {
  vehicleId: string;
  userId: string;
  onOffload?: () => void;
}

const OffloadVehicleButton: React.FC<OffloadVehicleButtonProps> = ({
  vehicleId,
  userId,
  onOffload
}) => {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleOffload = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setLoading(true);
    try {
      // Remove from discovered_vehicles (personal relationships)
      await supabase
        .from('discovered_vehicles')
        .delete()
        .eq('user_id', userId)
        .eq('vehicle_id', vehicleId);

      // Mark as hidden in preferences
      await supabase
        .from('user_vehicle_preferences')
        .upsert({
          user_id: userId,
          vehicle_id: vehicleId,
          is_hidden: true
        }, {
          onConflict: 'user_id,vehicle_id'
        });

      // Remove from contributing if user uploaded it
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('uploaded_by, user_id')
        .eq('id', vehicleId)
        .single();

      if (vehicle && (vehicle.uploaded_by === userId || vehicle.user_id === userId)) {
        // Don't delete the vehicle, just remove personal ownership
        // The vehicle stays in the system but is no longer "yours"
        await supabase
          .from('vehicles')
          .update({ 
            user_id: null,
            uploaded_by: null 
          })
          .eq('id', vehicleId);
      }

      if (onOffload) onOffload();
      setShowConfirm(false);
    } catch (error) {
      console.error('Error offloading vehicle:', error);
      alert('Failed to offload vehicle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {showConfirm ? (
        <div style={{
          padding: '8px',
          background: '#fee2e2',
          border: '1px solid #991b1b',
          borderRadius: '4px',
          fontSize: '8pt'
        }}>
          <div style={{ marginBottom: '8px', fontWeight: 600, color: '#991b1b' }}>
            Remove from personal view?
          </div>
          <div style={{ marginBottom: '8px', color: '#6b7280', fontSize: '7pt' }}>
            This will hide the vehicle from your personal view. It will still be visible in organization contexts if linked.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleOffload}
              disabled={loading}
              style={{
                padding: '4px 12px',
                fontSize: '8pt',
                fontWeight: 600,
                border: '1px solid #991b1b',
                background: '#991b1b',
                color: 'white',
                cursor: loading ? 'wait' : 'pointer',
                borderRadius: '4px',
                opacity: loading ? 0.5 : 1
              }}
            >
              {loading ? 'Removing...' : 'CONFIRM'}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              disabled={loading}
              style={{
                padding: '4px 12px',
                fontSize: '8pt',
                fontWeight: 600,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-muted)',
                cursor: loading ? 'wait' : 'pointer',
                borderRadius: '4px'
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleOffload}
          style={{
            padding: '4px 8px',
            fontSize: '7pt',
            fontWeight: 600,
            border: '1px solid #991b1b',
            background: 'var(--surface)',
            color: '#991b1b',
            cursor: 'pointer',
            borderRadius: '3px',
            transition: 'all 0.12s ease'
          }}
          title="Remove from personal view"
        >
          OFFLOAD
        </button>
      )}
    </div>
  );
};

export default OffloadVehicleButton;

