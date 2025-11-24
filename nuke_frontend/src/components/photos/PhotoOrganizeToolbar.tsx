/**
 * Photo Organize Toolbar
 * 
 * Fixed toolbar that appears when photos are selected
 * Provides bulk actions: link to vehicle, mark as organized, delete
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface PhotoOrganizeToolbarProps {
  selectedCount: number;
  onLinkToVehicle: (vehicleId: string) => void;
  onMarkAsOrganized: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
}

export const PhotoOrganizeToolbar: React.FC<PhotoOrganizeToolbarProps> = ({
  selectedCount,
  onLinkToVehicle,
  onMarkAsOrganized,
  onDelete,
  onCancel
}) => {
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, trim')
        .order('year', { ascending: false });

      if (error) throw error;
      setVehicles(data || []);
      setShowVehiclePicker(true);
    } catch (error) {
      console.error('Error loading vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLinkClick = () => {
    loadVehicles();
  };

  return (
    <>
      {/* Toolbar */}
      <div style={{
        position: 'fixed',
        bottom: '30px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: '#1a1a1a',
        border: '2px solid #4a9eff',
        borderRadius: '12px',
        padding: '20px 30px',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
      }}>
        {/* Selection Count */}
        <div style={{ 
          fontSize: '18px', 
          fontWeight: '600',
          color: '#fff',
          marginRight: '10px'
        }}>
          {selectedCount} Selected
        </div>

        {/* Actions */}
        <button
          onClick={handleLinkClick}
          disabled={loading}
          style={{
            padding: '12px 24px',
            background: '#4a9eff',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'all 0.12s ease'
          }}
        >
          Link to Vehicle
        </button>

        <button
          onClick={onMarkAsOrganized}
          style={{
            padding: '12px 24px',
            background: '#00c853',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'all 0.12s ease'
          }}
        >
          Mark as Organized
        </button>

        <button
          onClick={onDelete}
          style={{
            padding: '12px 24px',
            background: '#333',
            color: '#fff',
            border: '2px solid #555',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
            transition: 'all 0.12s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#ff4444';
            e.currentTarget.style.borderColor = '#ff4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#333';
            e.currentTarget.style.borderColor = '#555';
          }}
        >
          Delete
        </button>

        <div style={{ 
          width: '2px', 
          height: '40px', 
          background: '#333',
          margin: '0 10px'
        }} />

        <button
          onClick={onCancel}
          style={{
            padding: '12px 24px',
            background: 'transparent',
            color: '#888',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600'
          }}
        >
          Cancel
        </button>
      </div>

      {/* Vehicle Picker Modal */}
      {showVehiclePicker && (
        <div
          onClick={() => setShowVehiclePicker(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1a1a1a',
              border: '2px solid #333',
              borderRadius: '12px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
              padding: '30px'
            }}
          >
            <h2 style={{ 
              margin: '0 0 20px 0',
              fontSize: '24px',
              fontWeight: '600',
              color: '#fff'
            }}>
              Select Vehicle
            </h2>

            <p style={{ 
              margin: '0 0 30px 0',
              color: '#888',
              fontSize: '14px'
            }}>
              Link {selectedCount} photo{selectedCount !== 1 ? 's' : ''} to:
            </p>

            {vehicles.length === 0 ? (
              <div style={{ 
                textAlign: 'center',
                padding: '40px',
                color: '#666'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚗</div>
                <div>No vehicles found. Create a vehicle profile first.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {vehicles.map(vehicle => (
                  <button
                    key={vehicle.id}
                    onClick={() => {
                      onLinkToVehicle(vehicle.id);
                      setShowVehiclePicker(false);
                    }}
                    style={{
                      padding: '16px 20px',
                      background: '#222',
                      color: '#fff',
                      border: '2px solid #333',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '16px',
                      fontWeight: '500',
                      textAlign: 'left',
                      transition: 'all 0.12s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#4a9eff';
                      e.currentTarget.style.background = '#2a2a2a';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#333';
                      e.currentTarget.style.background = '#222';
                    }}
                  >
                    {vehicle.year} {vehicle.make} {vehicle.model}
                    {vehicle.trim && ` ${vehicle.trim}`}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowVehiclePicker(false)}
              style={{
                marginTop: '30px',
                padding: '12px 24px',
                background: '#333',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                width: '100%'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
};

