import React, { useState, useEffect } from 'react';
import type { X, Save, AlertCircle, ChevronDown, ChevronUp, Wand2, Upload, FileText, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { useAuth } from '../../hooks/useAuth';
import type { BulkImageUploader } from './BulkImageUploader';
import type { VehicleSpecService } from '../../services/vehicleSpecService';

interface VehicleDataEditorProps {
  vehicleId: string;
  onClose?: () => void;
}

export function VehicleDataEditor({ vehicleId, onClose }: VehicleDataEditorProps) {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [vehicleData, setVehicleData] = useState<any>({});
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    pricing: true,
    financial: false,
    dimensions: false,
    modifications: false,
    images: false
  });
  const [formData, setFormData] = useState<any>({});
  const [activeTab, setActiveTab] = useState('financial');
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [message, setMessage] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'number' ? (value === '' ? null : parseFloat(value)) : value
    });
  };

  const handleSave = async (section?: string) => {
    setIsSaving(true);
    
    try {
      // Build update object - only include fields that have changed
      const updates: any = {};
      const fieldsToUpdate = section ? getSectionFields(section) : Object.keys(formData);
      
      fieldsToUpdate.forEach(field => {
        if (formData[field] !== vehicleData[field]) {
          updates[field] = formData[field];
        }
      });

      if (Object.keys(updates).length === 0) {
        setIsSaving(false);
        return;
      }

      // Store previous state for rollback
      const previousData = { ...vehicleData };

      // Optimistic update - update local state immediately
      setVehicleData({ ...vehicleData, ...updates });

      // Update in database - don't wait for full record fetch
      const { error } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicleId);

      if (error) {
        // Rollback on error
        setVehicleData(previousData);
        throw error;
      }

      setMessage('Saved successfully');
      setIsSaving(false);
      
      // Auto-close message after 2 seconds
      setTimeout(() => setMessage(''), 2000);
      
    } catch (error) {
      console.error('Error updating vehicle:', error);
      setMessage(`Error: ${(error as any).message}`);
      setIsSaving(false);
    }
  };

  const getSectionFields = (section: string) => {
    switch(section) {
      case 'pricing':
        return ['asking_price', 'purchase_price', 'current_value'];
      case 'financial':
        return ['purchase_price', 'purchase_date', 'purchase_location', 'current_value', 'msrp'];
      case 'technical':
        return ['engine_size', 'horsepower', 'torque', 'transmission', 'drivetrain', 'fuel_type'];
      case 'ownership':
        return ['previous_owners', 'is_modified', 'modification_details'];
      case 'condition':
        return ['condition_rating', 'mileage', 'maintenance_notes'];
      case 'dimensions':
        return ['weight_lbs', 'length_inches', 'width_inches', 'height_inches', 'wheelbase_inches'];
      default:
        return [];
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        width: '90%',
        maxWidth: '800px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>
            Edit {vehicleData.year} {vehicleData.make} {vehicleData.model}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6b7280'
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #e5e7eb',
          padding: '0 20px'
        }}>
          {['financial', 'technical', 'ownership', 'condition', 'documents'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 20px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
                color: activeTab === tab ? '#3b82f6' : '#6b7280',
                fontWeight: activeTab === tab ? '600' : '400',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          padding: '20px',
          overflowY: 'auto'
        }}>
          {/* Financial Tab */}
          {activeTab === 'financial' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Purchase Price
                </label>
                <input
                  type="number"
                  name="purchase_price"
                  value={formData.purchase_price || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="Amount paid for vehicle"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Purchase Date
                </label>
                <input
                  type="date"
                  name="purchase_date"
                  value={formData.purchase_date || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Purchase Location
                </label>
                <input
                  type="text"
                  name="purchase_location"
                  value={formData.purchase_location || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="Dealer, auction, private party"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Current Value
                </label>
                <input
                  type="number"
                  name="current_value"
                  value={formData.current_value || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="Estimated current value"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Original MSRP
                </label>
                <input
                  type="number"
                  name="msrp"
                  value={formData.msrp || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="Manufacturer's suggested retail price"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          {/* Technical Tab */}
          {activeTab === 'technical' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Engine Size
                </label>
                <input
                  type="text"
                  name="engine_size"
                  value={formData.engine_size || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="e.g., 4.5L, 2.0T"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Horsepower
                </label>
                <input
                  type="number"
                  name="horsepower"
                  value={formData.horsepower || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="HP"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Torque
                </label>
                <input
                  type="number"
                  name="torque"
                  value={formData.torque || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="lb-ft"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Transmission
                </label>
                <select
                  name="transmission"
                  value={formData.transmission || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  <option value="">Select transmission</option>
                  <option value="manual">Manual</option>
                  <option value="automatic">Automatic</option>
                  <option value="cvt">CVT</option>
                  <option value="dual-clutch">Dual Clutch</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Drivetrain
                </label>
                <select
                  name="drivetrain"
                  value={formData.drivetrain || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  <option value="">Select drivetrain</option>
                  <option value="fwd">FWD</option>
                  <option value="rwd">RWD</option>
                  <option value="awd">AWD</option>
                  <option value="4wd">4WD</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Fuel Type
                </label>
                <select
                  name="fuel_type"
                  value={formData.fuel_type || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  <option value="">Select fuel type</option>
                  <option value="gasoline">Gasoline</option>
                  <option value="diesel">Diesel</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="electric">Electric</option>
                  <option value="flex-fuel">Flex Fuel</option>
                </select>
              </div>
            </div>
          )}

          {/* Ownership Tab */}
          {activeTab === 'ownership' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Previous Owners
                </label>
                <input
                  type="number"
                  name="previous_owners"
                  value={formData.previous_owners || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="Number of previous owners"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Modified?
                </label>
                <select
                  name="is_modified"
                  value={formData.is_modified ? 'true' : 'false'}
                  onChange={(e) => setFormData({...formData, is_modified: e.target.value === 'true'})}
                  className="form-input"
                  style={{ width: '100%' }}
                >
                  <option value="false">Stock</option>
                  <option value="true">Modified</option>
                </select>
              </div>

              {formData.is_modified && (
                <div>
                  <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                    Modification Details
                  </label>
                  <textarea
                    name="modification_details"
                    value={formData.modification_details || ''}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="Describe modifications..."
                    rows={4}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Condition Tab */}
          {activeTab === 'condition' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Condition Rating (1-10)
                </label>
                <input
                  type="number"
                  name="condition_rating"
                  value={formData.condition_rating || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="1 = Poor, 10 = Perfect"
                  min="1"
                  max="10"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Current Mileage
                </label>
                <input
                  type="number"
                  name="mileage"
                  value={formData.mileage || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="Odometer reading"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Maintenance Notes
                </label>
                <textarea
                  name="maintenance_notes"
                  value={formData.maintenance_notes || ''}
                  onChange={handleInputChange}
                  className="form-input"
                  placeholder="Recent maintenance, issues, etc..."
                  rows={4}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          {/* Documents Tab */}
          {activeTab === 'documents' && (
            <div>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4" style={{ marginBottom: '24px' }}>
                <div className="card" style={{ padding: '8px' }}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text text-muted" style={{ fontSize: '11px', margin: '0px' }}>Invested</p>
                      <p className="text font-bold" style={{ fontSize: '14px', margin: '0px' }}>${formData.total_invested || '0'}</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-dollar-sign w-3 h-3" aria-hidden="true">
                      <line x1="12" x2="12" y1="2" y2="22"></line>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  </div>
                </div>
                <div className="card" style={{ padding: '8px' }}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text text-muted" style={{ fontSize: '11px', margin: '0px' }}>Value</p>
                      <p className="text font-bold" style={{ fontSize: '14px', margin: '0px' }}>${formData.current_value || '0'}</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-trending-up w-3 h-3" aria-hidden="true">
                      <path d="M16 7h6v6"></path>
                      <path d="m22 7-8.5 8.5-5-5L2 17"></path>
                    </svg>
                  </div>
                </div>
                <div className="card" style={{ padding: '8px' }}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text text-muted" style={{ fontSize: '11px', margin: '0px' }}>Installed</p>
                      <p className="text font-bold" style={{ fontSize: '14px', margin: '0px' }}>{formData.parts_installed || '0'}</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check-big w-3 h-3" aria-hidden="true">
                      <path d="M21.801 10A10 10 0 1 1 17 3.335"></path>
                      <path d="m9 11 3 3L22 4"></path>
                    </svg>
                  </div>
                </div>
                <div className="card" style={{ padding: '8px' }}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text text-muted" style={{ fontSize: '11px', margin: '0px' }}>Pending</p>
                      <p className="text font-bold" style={{ fontSize: '14px', margin: '0px' }}>{formData.parts_pending || '0'}</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-package w-3 h-3" aria-hidden="true">
                      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"></path>
                      <path d="M12 22V12"></path>
                      <polyline points="3.29 7 12 12 20.71 7"></polyline>
                      <path d="m7.5 4.27 9 5.15"></path>
                    </svg>
                  </div>
                </div>
                <div className="card" style={{ padding: '8px' }}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text text-muted" style={{ fontSize: '11px', margin: '0px' }}>Hours</p>
                      <p className="text font-bold" style={{ fontSize: '14px', margin: '0px' }}>{formData.labor_hours || '0'}</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-clock w-3 h-3" aria-hidden="true">
                      <path d="M12 6v6l4 2"></path>
                      <circle cx="12" cy="12" r="10"></circle>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Documents Section */}
              <div style={{ 
                border: '1px solid #e5e7eb', 
                borderRadius: '8px',
                padding: '16px'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px'
                }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600' }}>Supporting Documents</h3>
                  <button
                    onClick={() => setShowDocumentUpload(true)}
                    className="button button-primary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 16px',
                      fontSize: '14px'
                    }}
                  >
                    <Plus size={16} />
                    Add Documents
                  </button>
                </div>

                {/* Document List */}
                {documents.length === 0 ? (
                  <div style={{ 
                    textAlign: 'center', 
                    color: '#6b7280',
                    padding: '40px 0'
                  }}>
                    <FileText size={48} style={{ margin: '0 auto', opacity: 0.3 }} />
                    <p style={{ marginTop: '12px' }}>No documents uploaded yet</p>
                    <p style={{ fontSize: '14px', marginTop: '4px' }}>Upload receipts, invoices, build sheets, and other supporting documents</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {documents.map(doc => (
                      <div key={doc.id} style={{ 
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px'
                      }}>
                        <FileText size={20} style={{ marginRight: '8px', color: '#6b7280' }} />
                        <span style={{ flex: 1 }}>{doc.name}</span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{doc.type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '20px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          {message && (
            <span style={{
              color: message.includes('Error') ? '#dc2626' : '#059669',
              fontSize: '14px'
            }}>
              {message}
            </span>
          )}
          
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              className="button button-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSave(activeTab)}
              disabled={isSaving}
              className="button button-primary"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleDataEditor;
