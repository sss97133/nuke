import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

type FixType = 'price' | 'vin' | 'mileage' | 'color' | 'images';

interface VehicleToFix {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  currentValue?: string | number | null;
  fixed?: boolean;
}

interface QuickFixModalProps {
  isOpen: boolean;
  onClose: () => void;
  fixType: FixType;
  vehicleIds: string[];
  onComplete: () => void;
}

const QuickFixModal: React.FC<QuickFixModalProps> = ({
  isOpen,
  onClose,
  fixType,
  vehicleIds,
  onComplete
}) => {
  const [vehicles, setVehicles] = useState<VehicleToFix[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fixedCount, setFixedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fieldConfig: Record<FixType, {
    title: string;
    fieldName: string;
    placeholder: string;
    inputType: string;
    dbField: string;
  }> = {
    price: {
      title: 'Fix Missing Purchase Prices',
      fieldName: 'Purchase Price',
      placeholder: 'e.g., 45000',
      inputType: 'number',
      dbField: 'purchase_price'
    },
    vin: {
      title: 'Fix Missing VINs',
      fieldName: 'VIN',
      placeholder: 'e.g., 1G1YY22G965104556',
      inputType: 'text',
      dbField: 'vin'
    },
    mileage: {
      title: 'Fix Missing Mileage',
      fieldName: 'Mileage',
      placeholder: 'e.g., 85000',
      inputType: 'number',
      dbField: 'mileage'
    },
    color: {
      title: 'Fix Missing Colors',
      fieldName: 'Color',
      placeholder: 'e.g., Red',
      inputType: 'text',
      dbField: 'color'
    },
    images: {
      title: 'Add Missing Images',
      fieldName: 'Images',
      placeholder: 'Upload images below',
      inputType: 'file',
      dbField: 'images'
    }
  };

  const config = fieldConfig[fixType];

  useEffect(() => {
    if (isOpen && vehicleIds.length > 0) {
      loadVehicles();
    }
  }, [isOpen, vehicleIds]);

  const loadVehicles = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin, mileage, color, purchase_price, current_value')
        .in('id', vehicleIds);

      if (error) throw error;

      const vehicleData: VehicleToFix[] = (data || []).map(v => ({
        id: v.id,
        year: v.year,
        make: v.make,
        model: v.model,
        currentValue: v[config.dbField as keyof typeof v],
        fixed: false
      }));

      setVehicles(vehicleData);
      
      // Initialize values with empty strings
      const initialValues: Record<string, string> = {};
      vehicleData.forEach(v => {
        initialValues[v.id] = '';
      });
      setValues(initialValues);
    } catch (err: any) {
      console.error('Error loading vehicles:', err);
      setError(err.message || 'Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (vehicleId: string, value: string) => {
    setValues(prev => ({
      ...prev,
      [vehicleId]: value
    }));
  };

  const handleSaveSingle = async (vehicleId: string) => {
    const value = values[vehicleId];
    if (!value || !value.trim()) return;

    setSaving(true);
    setError(null);
    try {
      let updateValue: any = value.trim();
      
      // Convert to number for numeric fields
      if (config.inputType === 'number') {
        updateValue = parseFloat(value);
        if (isNaN(updateValue)) {
          setError('Please enter a valid number');
          setSaving(false);
          return;
        }
      }

      const { error } = await supabase
        .from('vehicles')
        .update({ [config.dbField]: updateValue })
        .eq('id', vehicleId);

      if (error) throw error;

      // Mark as fixed
      setVehicles(prev => prev.map(v => 
        v.id === vehicleId ? { ...v, fixed: true, currentValue: updateValue } : v
      ));
      setFixedCount(prev => prev + 1);
    } catch (err: any) {
      console.error('Error saving:', err);
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setError(null);
    
    const toSave = Object.entries(values).filter(([id, value]) => {
      const vehicle = vehicles.find(v => v.id === id);
      return value.trim() && !vehicle?.fixed;
    });

    let savedCount = 0;
    for (const [vehicleId, value] of toSave) {
      try {
        let updateValue: any = value.trim();
        
        if (config.inputType === 'number') {
          updateValue = parseFloat(value);
          if (isNaN(updateValue)) continue;
        }

        const { error } = await supabase
          .from('vehicles')
          .update({ [config.dbField]: updateValue })
          .eq('id', vehicleId);

        if (!error) {
          setVehicles(prev => prev.map(v => 
            v.id === vehicleId ? { ...v, fixed: true, currentValue: updateValue } : v
          ));
          savedCount++;
        }
      } catch (err) {
        console.error('Error saving vehicle:', vehicleId, err);
      }
    }

    setFixedCount(prev => prev + savedCount);
    setSaving(false);

    if (savedCount === toSave.length && savedCount > 0) {
      // All saved successfully
      onComplete();
    }
  };

  const handleClose = () => {
    if (fixedCount > 0) {
      onComplete();
    }
    onClose();
  };

  const remainingCount = vehicles.filter(v => !v.fixed).length;
  const hasValues = Object.values(values).some(v => v.trim());

  if (!isOpen) return null;

  // Don't render for images type yet
  if (fixType === 'images') {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10003,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }} onClick={handleClose}>
        <div
          style={{
            background: '#fff',
            border: '2px solid var(--border)',
            maxWidth: '500px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            padding: '16px',
            borderBottom: '1px solid var(--border-light)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: '10pt', fontWeight: 700 }}>Add Missing Images</span>
            <button
              type="button"
              onClick={handleClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '14pt',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              To add images, please visit each vehicle's profile page directly.
            </p>
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              {vehicleIds.length} vehicles need images
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      zIndex: 10003,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }} onClick={handleClose}>
      <div
        style={{
          background: '#fff',
          border: '2px solid var(--border)',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '10pt', fontWeight: 700 }}>{config.title}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              {fixedCount} of {vehicles.length} fixed • {remainingCount} remaining
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '14pt',
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            ×
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ height: '4px', background: '#e5e7eb' }}>
          <div style={{
            height: '100%',
            width: `${(fixedCount / vehicles.length) * 100}%`,
            background: '#22c55e',
            transition: 'width 0.3s ease'
          }} />
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            padding: '10px 16px',
            background: '#fee2e2',
            color: '#991b1b',
            fontSize: '8pt'
          }}>
            {error}
          </div>
        )}

        {/* Vehicle list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              Loading vehicles...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {vehicles.map(vehicle => (
                <div
                  key={vehicle.id}
                  style={{
                    padding: '12px',
                    background: vehicle.fixed ? '#f0fdf4' : '#f9fafb',
                    border: `1px solid ${vehicle.fixed ? '#86efac' : '#e5e7eb'}`,
                    borderRadius: '4px',
                    opacity: vehicle.fixed ? 0.7 : 1
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px' }}>
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      {vehicle.fixed ? (
                        <div style={{ fontSize: '8pt', color: '#15803d', fontWeight: 500 }}>
                          ✓ Fixed: {vehicle.currentValue}
                        </div>
                      ) : (
                        <input
                          type={config.inputType}
                          value={values[vehicle.id] || ''}
                          onChange={e => handleValueChange(vehicle.id, e.target.value)}
                          placeholder={config.placeholder}
                          disabled={saving || vehicle.fixed}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            fontSize: '9pt',
                            border: '1px solid #d1d5db',
                            borderRadius: '3px',
                            background: '#fff'
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              handleSaveSingle(vehicle.id);
                            }
                          }}
                        />
                      )}
                    </div>
                    {!vehicle.fixed && (
                      <button
                        type="button"
                        onClick={() => handleSaveSingle(vehicle.id)}
                        disabled={saving || !values[vehicle.id]?.trim()}
                        style={{
                          padding: '8px 14px',
                          fontSize: '8pt',
                          fontWeight: 600,
                          background: values[vehicle.id]?.trim() ? '#1e40af' : '#9ca3af',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: values[vehicle.id]?.trim() ? 'pointer' : 'not-allowed'
                        }}
                      >
                        {saving ? '...' : 'SAVE'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-light)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f9fafb'
        }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 600,
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            {fixedCount > 0 ? 'DONE' : 'CANCEL'}
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={saving || !hasValues || remainingCount === 0}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 600,
              background: hasValues && remainingCount > 0 ? '#15803d' : '#9ca3af',
              color: '#fff',
              border: 'none',
              borderRadius: '3px',
              cursor: hasValues && remainingCount > 0 ? 'pointer' : 'not-allowed'
            }}
          >
            {saving ? 'SAVING...' : `SAVE ALL (${Object.values(values).filter(v => v.trim()).length})`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickFixModal;
