/**
 * Mobile Vehicle Data Editor
 * Quick edit for vehicle specs with section collapsing
 */

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface MobileVehicleDataEditorProps {
  vehicleId: string;
  vehicle: any;
  session: any;
  onClose: () => void;
  onSaved?: () => void;
}

export const MobileVehicleDataEditor: React.FC<MobileVehicleDataEditorProps> = ({
  vehicleId,
  vehicle,
  session,
  onClose,
  onSaved
}) => {
  const [expandedSection, setExpandedSection] = useState<string | null>('basic');
  const [formData, setFormData] = useState({ ...vehicle });
  const [saving, setSaving] = useState(false);

  const sections = [
    { 
      id: 'basic', 
      label: '🚗 Basic Info', 
      fields: [
        { key: 'year', label: 'Year', type: 'number' },
        { key: 'make', label: 'Make', type: 'text' },
        { key: 'model', label: 'Model', type: 'text' },
        { key: 'trim', label: 'Trim', type: 'text' },
        { key: 'color', label: 'Color', type: 'text' },
        { key: 'vin', label: 'VIN', type: 'text' },
        { key: 'mileage', label: 'Mileage', type: 'number' }
      ]
    },
    { 
      id: 'technical', 
      label: '⚙️ Technical', 
      fields: [
        { key: 'engine_size', label: 'Engine', type: 'text' },
        { key: 'horsepower', label: 'HP', type: 'number' },
        { key: 'torque', label: 'Torque', type: 'number' },
        { key: 'transmission', label: 'Transmission', type: 'text' },
        { key: 'drivetrain', label: 'Drivetrain', type: 'text' },
        { key: 'fuel_type', label: 'Fuel Type', type: 'text' }
      ]
    },
    { 
      id: 'financial', 
      label: '💰 Financial', 
      fields: [
        { key: 'msrp', label: 'MSRP', type: 'number' },
        { key: 'purchase_price', label: 'Purchase Price', type: 'number' },
        { key: 'current_value', label: 'Current Value', type: 'number' },
        { key: 'asking_price', label: 'Asking Price', type: 'number' }
      ]
    },
    { 
      id: 'dimensions', 
      label: '📏 Dimensions', 
      fields: [
        { key: 'weight_lbs', label: 'Weight (lbs)', type: 'number' },
        { key: 'length_inches', label: 'Length (in)', type: 'number' },
        { key: 'width_inches', label: 'Width (in)', type: 'number' },
        { key: 'height_inches', label: 'Height (in)', type: 'number' }
      ]
    }
  ];

  const handleFieldChange = (key: string, value: any) => {
    setFormData({ ...formData, [key]: value });
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const { error } = await supabase
        .from('vehicles')
        .update(formData)
        .eq('id', vehicleId);

      if (error) throw error;

      window.dispatchEvent(new Event('vehicle_data_updated'));
      onSaved?.();
      onClose();
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>✏️ Edit Vehicle Data</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* Sections */}
        <div style={styles.sectionsContainer}>
          {sections.map(section => (
            <div key={section.id} style={styles.section}>
              <button
                onClick={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
                style={styles.sectionHeader}
              >
                <span>{section.label}</span>
                <span>{expandedSection === section.id ? '▼' : '▶'}</span>
              </button>

              {expandedSection === section.id && (
                <div style={styles.sectionContent}>
                  {section.fields.map(field => (
                    <div key={field.key} style={styles.field}>
                      <label style={styles.label}>{field.label}</label>
                      <input
                        type={field.type}
                        value={formData[field.key] || ''}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        style={styles.input}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={styles.saveBtn}
        >
          {saving ? 'Saving...' : '✓ Save All Changes'}
        </button>
      </div>
    </div>,
    document.body
  );
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.9)',
    zIndex: 999999
  },
  modal: {
    background: '#ffffff',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    borderBottom: '2px solid #000080',
    background: '#f0f0f0'
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontFamily: '"MS Sans Serif", sans-serif',
    fontWeight: 'bold'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer'
  },
  sectionsContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0'
  },
  section: {
    borderBottom: '2px solid #c0c0c0'
  },
  sectionHeader: {
    width: '100%',
    background: '#e0e0e0',
    border: 'none',
    borderBottom: '2px solid #c0c0c0',
    padding: '16px',
    fontSize: '15px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  sectionContent: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px'
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px'
  },
  label: {
    fontSize: '13px',
    fontWeight: 'bold',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  input: {
    padding: '14px',
    border: '2px inset #c0c0c0',
    borderRadius: '4px',
    fontSize: '16px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  saveBtn: {
    margin: '16px',
    padding: '18px',
    background: '#000080',
    color: '#ffffff',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  }
};

