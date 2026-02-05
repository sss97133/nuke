import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';

interface VehicleEditModalProps {
  vehicleId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface VehicleData {
  [key: string]: any;
}

interface VehicleImage {
  id: string;
  url: string;
  is_primary?: boolean;
}

// Fields to show in the editor, grouped - priority fields first
const FIELD_GROUPS: Record<string, string[]> = {
  'Identity': ['year', 'make', 'model', 'trim', 'series', 'body_style', 'vin', 'license_plate', 'title_number'],
  'Ownership': ['user_id', 'added_by', 'claimed_by', 'owner_id', 'created_by'],
  'Specs': ['mileage', 'engine', 'transmission', 'drivetrain', 'fuel_type', 'horsepower', 'torque', 'cylinders', 'displacement'],
  'Appearance': ['color', 'exterior_color', 'interior_color', 'paint_code'],
  'Value': ['purchase_price', 'current_value', 'sale_price', 'msrp', 'reserve_price', 'starting_bid'],
  'Dates': ['purchase_date', 'sale_date', 'created_at', 'updated_at', 'listed_at', 'sold_at'],
  'Status': ['condition_rating', 'is_modified', 'sale_status', 'status', 'auction_status', 'listing_status'],
  'Notes': ['notes', 'modification_details', 'description', 'seller_notes']
};

// Fields to hide (internal IDs, etc)
const HIDDEN_FIELDS = ['id', 'primary_image_url'];

// Fields that are read-only (show but can't edit)
const READONLY_FIELDS = ['id', 'created_at', 'updated_at', 'user_id', 'added_by', 'created_by', 'claimed_by', 'owner_id'];

export const VehicleEditModal: React.FC<VehicleEditModalProps> = ({
  vehicleId,
  onClose,
  onSaved
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [editedFields, setEditedFields] = useState<VehicleData>({});
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadVehicle();
  }, [vehicleId]);

  const loadVehicle = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load vehicle data and images in parallel
      const [vehicleResult, imagesResult] = await Promise.all([
        supabase
          .from('vehicles')
          .select('*')
          .eq('id', vehicleId)
          .single(),
        supabase
          .from('vehicle_images')
          .select('id, url, is_primary')
          .eq('vehicle_id', vehicleId)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(50)
      ]);

      if (vehicleResult.error) throw vehicleResult.error;
      setVehicle(vehicleResult.data);
      setImages(imagesResult.data || []);
      setEditedFields({});
    } catch (err) {
      console.error('Error loading vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to load vehicle');
    } finally {
      setLoading(false);
    }
  };

  const openLightbox = (url: string, index: number) => {
    setLightboxImage(url);
    setLightboxIndex(index);
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  const navigateLightbox = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'next'
      ? (lightboxIndex + 1) % images.length
      : (lightboxIndex - 1 + images.length) % images.length;
    setLightboxIndex(newIndex);
    setLightboxImage(images[newIndex].url);
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditedFields(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (Object.keys(editedFields).length === 0) {
      onClose();
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('vehicles')
        .update(editedFields)
        .eq('id', vehicleId);

      if (updateError) throw updateError;

      onSaved();
      onClose();
    } catch (err) {
      console.error('Error saving vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const getCurrentValue = (field: string) => {
    if (field in editedFields) return editedFields[field];
    return vehicle?.[field] ?? '';
  };

  const renderField = (field: string) => {
    const value = getCurrentValue(field);
    const isModified = field in editedFields;
    const isReadOnly = READONLY_FIELDS.includes(field);

    // Determine input type based on field name
    let inputType = 'text';
    if (field.includes('price') || field.includes('value') || field.includes('msrp') || field.includes('bid') || field.includes('reserve')) {
      inputType = 'number';
    } else if (field.includes('_at') || field.includes('date')) {
      inputType = 'datetime-local';
    } else if (field === 'year' || field === 'mileage' || field === 'horsepower' || field === 'torque' || field === 'condition_rating' || field === 'cylinders' || field === 'displacement') {
      inputType = 'number';
    } else if (field === 'is_modified' || field.startsWith('is_') || field.startsWith('has_')) {
      inputType = 'checkbox';
    } else if (field === 'notes' || field === 'modification_details' || field === 'description' || field === 'seller_notes') {
      inputType = 'textarea';
    }

    const label = field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Format datetime values for display
    let displayValue = value || '';
    if (inputType === 'datetime-local' && displayValue && typeof displayValue === 'string') {
      // Convert ISO string to datetime-local format
      try {
        const date = new Date(displayValue);
        if (!isNaN(date.getTime())) {
          displayValue = date.toISOString().slice(0, 16);
        }
      } catch { /* keep original */ }
    }

    return (
      <div key={field} style={{ marginBottom: '8px' }}>
        <label style={{
          display: 'block',
          fontSize: '7pt',
          color: isReadOnly ? 'var(--text-muted)' : 'var(--text-muted)',
          marginBottom: '2px',
          textTransform: 'uppercase'
        }}>
          {label}
          {isModified && <span style={{ color: '#f59e0b', marginLeft: '4px' }}>*</span>}
          {isReadOnly && <span style={{ color: '#6b7280', marginLeft: '4px', fontSize: '6pt' }}>(read-only)</span>}
        </label>
        {inputType === 'textarea' ? (
          <textarea
            value={displayValue}
            onChange={(e) => handleFieldChange(field, e.target.value || null)}
            disabled={isReadOnly}
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: '9pt',
              border: `1px solid ${isModified ? '#f59e0b' : 'var(--border)'}`,
              background: isReadOnly ? 'var(--grey-100)' : 'var(--surface)',
              borderRadius: '2px',
              minHeight: '60px',
              resize: 'vertical',
              opacity: isReadOnly ? 0.7 : 1
            }}
          />
        ) : inputType === 'checkbox' ? (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleFieldChange(field, e.target.checked)}
            disabled={isReadOnly}
            style={{ marginTop: '4px' }}
          />
        ) : (
          <input
            type={inputType}
            value={displayValue}
            onChange={(e) => {
              let newValue: any = e.target.value;
              if (inputType === 'number' && newValue) {
                newValue = parseFloat(newValue);
                if (isNaN(newValue)) newValue = null;
              }
              if (newValue === '') newValue = null;
              handleFieldChange(field, newValue);
            }}
            disabled={isReadOnly}
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: '9pt',
              border: `1px solid ${isModified ? '#f59e0b' : 'var(--border)'}`,
              background: isReadOnly ? 'var(--grey-100)' : 'var(--surface)',
              borderRadius: '2px',
              opacity: isReadOnly ? 0.7 : 1,
              fontFamily: (field.includes('_id') || field === 'vin') ? 'monospace' : 'inherit'
            }}
          />
        )}
      </div>
    );
  };

  // Get all fields from the vehicle, organized into groups + "Other"
  const getOrganizedFields = () => {
    if (!vehicle) return {};

    const allFields = Object.keys(vehicle).filter(f => !HIDDEN_FIELDS.includes(f));
    const groupedFields = new Set(Object.values(FIELD_GROUPS).flat());
    const otherFields = allFields.filter(f => !groupedFields.has(f));

    // Only include groups that have fields present in the vehicle
    const result: Record<string, string[]> = {};
    for (const [groupName, fields] of Object.entries(FIELD_GROUPS)) {
      const presentFields = fields.filter(f => f in vehicle);
      if (presentFields.length > 0) {
        result[groupName] = presentFields;
      }
    }

    // Add "Other" group for remaining fields
    if (otherFields.length > 0) {
      result['Other Fields'] = otherFields.sort();
    }

    return result;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          width: '90%',
          maxWidth: '700px',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>
              Edit Vehicle
            </h2>
            {vehicle && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16pt',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0 8px'
            }}
          >
            ×
          </button>
        </div>

        {/* Image Carousel */}
        {images.length > 0 && !loading && (
          <div style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--grey-100)'
          }}>
            <div
              ref={carouselRef}
              style={{
                display: 'flex',
                gap: '8px',
                padding: '12px',
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'thin'
              }}
            >
              {images.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => openLightbox(img.url, idx)}
                  style={{
                    flexShrink: 0,
                    width: '80px',
                    height: '60px',
                    padding: 0,
                    border: img.is_primary ? '2px solid var(--primary)' : '1px solid var(--border)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: 'var(--surface)'
                  }}
                >
                  <img
                    src={img.url}
                    alt={`Vehicle ${idx + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            <div style={{
              padding: '0 12px 8px',
              fontSize: '7pt',
              color: 'var(--text-muted)'
            }}>
              {images.length} image{images.length !== 1 ? 's' : ''} • Click to enlarge
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px'
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#dc2626' }}>
              {error}
            </div>
          ) : vehicle ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px'
            }}>
              {Object.entries(getOrganizedFields()).map(([groupName, fields]) => (
                <div key={groupName}>
                  <h3 style={{
                    fontSize: '8pt',
                    fontWeight: 700,
                    color: groupName === 'Ownership' ? '#dc2626' : 'var(--text)',
                    marginBottom: '8px',
                    paddingBottom: '4px',
                    borderBottom: `1px solid ${groupName === 'Ownership' ? '#fca5a5' : 'var(--border)'}`
                  }}>
                    {groupName}
                    {groupName === 'Ownership' && <span style={{ fontWeight: 400, fontSize: '7pt', marginLeft: '6px' }}>Check these for misattribution</span>}
                  </h3>
                  {fields.map(field => renderField(field))}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {Object.keys(editedFields).length > 0 && (
              <span style={{ color: '#f59e0b' }}>
                {Object.keys(editedFields).length} field(s) modified
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '6px 16px',
                fontSize: '9pt',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || Object.keys(editedFields).length === 0}
              style={{
                padding: '6px 16px',
                fontSize: '9pt',
                fontWeight: 600,
                background: Object.keys(editedFields).length > 0 ? 'var(--primary)' : 'var(--grey-300)',
                color: Object.keys(editedFields).length > 0 ? 'white' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '2px',
                cursor: Object.keys(editedFields).length > 0 ? 'pointer' : 'default'
              }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox Popup */}
      {lightboxImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              fontSize: '24px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>

          {/* Previous button */}
          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox('prev');
              }}
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                fontSize: '24px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ‹
            </button>
          )}

          {/* Image */}
          <img
            src={lightboxImage}
            alt="Vehicle"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              objectFit: 'contain',
              borderRadius: '4px'
            }}
          />

          {/* Next button */}
          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox('next');
              }}
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                fontSize: '24px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ›
            </button>
          )}

          {/* Image counter */}
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.6)',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '9pt'
            }}
          >
            {lightboxIndex + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleEditModal;
