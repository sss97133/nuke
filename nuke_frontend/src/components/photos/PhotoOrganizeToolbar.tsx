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
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'var(--white)',
        border: '2px outset var(--border-medium)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
      }}>
        {/* Selection Count */}
        <div className="text font-bold" style={{ 
          marginRight: '8px'
        }}>
          {selectedCount} Selected
        </div>

        {/* Actions */}
        <button
          onClick={handleLinkClick}
          disabled={loading}
          className="button button-primary"
          style={{
            padding: '8px 16px',
            fontSize: '11px',
            cursor: loading ? 'wait' : 'pointer'
          }}
        >
          Link to Vehicle
        </button>

        <button
          onClick={onMarkAsOrganized}
          className="button button-primary"
          style={{
            padding: '8px 16px',
            fontSize: '11px'
          }}
        >
          Mark as Organized
        </button>

        <button
          onClick={onDelete}
          className="button button-secondary"
          style={{
            padding: '8px 16px',
            fontSize: '11px'
          }}
        >
          Delete
        </button>

        <div style={{ 
          width: '1px', 
          height: '24px', 
          background: 'var(--border-medium)',
          margin: '0 4px'
        }} />

        <button
          onClick={onCancel}
          className="button button-secondary"
          style={{
            padding: '8px 16px',
            fontSize: '11px'
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
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              maxWidth: '500px',
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
          >
            <div className="card-header">
              <h2 className="text font-bold" style={{ margin: 0 }}>
                Select Vehicle
              </h2>
            </div>

            <div className="card-body">
              <p className="text text-small text-muted" style={{ margin: '0 0 16px 0' }}>
                Link {selectedCount} photo{selectedCount !== 1 ? 's' : ''} to:
              </p>

              {vehicles.length === 0 ? (
                <div style={{ 
                  textAlign: 'center',
                  padding: '40px'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>🚗</div>
                  <div className="text text-small text-muted">No vehicles found. Create a vehicle profile first.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  {vehicles.map(vehicle => (
                    <button
                      key={vehicle.id}
                      onClick={() => {
                        onLinkToVehicle(vehicle.id);
                        setShowVehiclePicker(false);
                      }}
                      className="button button-secondary"
                      style={{
                        padding: '12px 16px',
                        fontSize: '11px',
                        textAlign: 'left',
                        justifyContent: 'flex-start'
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
                className="button button-secondary"
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '11px'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

