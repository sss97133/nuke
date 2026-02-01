import React, { useState, useEffect } from 'react';
import { DynamicFieldService, type DynamicField } from '../services/dynamicFieldService';
import type { FieldAuditTrail } from '../services/dynamicFieldService';
import { supabase } from '../lib/supabase';

interface DynamicVehicleFieldsProps {
  vehicleId: string;
  isOwner: boolean;
  className?: string;
}

const DynamicVehicleFields: React.FC<DynamicVehicleFieldsProps> = ({
  vehicleId,
  isOwner,
  className = ''
}) => {
  const [dynamicFields, setDynamicFields] = useState<DynamicField[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditTrail, setAuditTrail] = useState<{
    isOpen: boolean;
    fieldName: string;
  }>({ isOpen: false, fieldName: '' });
  const [provenance, setProvenance] = useState<{
    open: boolean;
    fieldName: string;
    entries: Array<{ field_value: string; source_type?: string; source_name?: string; user_id?: string; is_verified?: boolean; updated_at: string; metadata?: any }>;
  }>({ open: false, fieldName: '', entries: [] });

  const [showAddForm, setShowAddForm] = useState(false);
  const [newField, setNewField] = useState({ name: '', value: '', category: 'specs' });

  useEffect(() => {
    loadDynamicFields();
  }, [vehicleId]);

  const loadDynamicFields = async () => {
    try {
      setLoading(true);
      const fields = await DynamicFieldService.getDynamicFields(vehicleId);
      setDynamicFields(fields);
    } catch (error) {
      console.error('Error loading dynamic fields:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyField = async (fieldName: string) => {
    try {
      await DynamicFieldService.verifyField(vehicleId, fieldName, 'current-user-id');
      loadDynamicFields(); // Reload to show verification status
    } catch (error) {
      console.error('Error verifying field:', error);
    }
  };

  const showAuditTrail = async (fieldName: string) => {
    try {
      // Load provenance from vehicle_field_sources (single source of truth for field origins)
      const { data, error } = await supabase
        .from('vehicle_field_sources')
        .select('field_value, source_type, source_name, user_id, is_verified, updated_at, metadata')
        .eq('vehicle_id', vehicleId)
        .eq('field_name', fieldName)
        .order('updated_at', { ascending: false });

      if (error) {
        console.warn('Field provenance unavailable:', error.message);
        setProvenance({ open: true, fieldName, entries: [] });
        return;
      }

      setProvenance({ open: true, fieldName, entries: (data as any[]) || [] });
    } catch (e) {
      console.warn('Error loading provenance:', e);
      setProvenance({ open: true, fieldName, entries: [] });
    }
  };

  const groupedFields = dynamicFields.reduce((acc, field) => {
    if (!acc[field.field_category]) {
      acc[field.field_category] = [];
    }
    acc[field.field_category].push(field);
    return acc;
  }, {} as Record<string, DynamicField[]>);

  const getCategoryTitle = (category: string) => {
    switch (category) {
      case 'specs': return 'Specifications';
      case 'pricing': return 'Pricing Information';
      case 'history': return 'Vehicle History';
      case 'maintenance': return 'Maintenance Records';
      case 'legal': return 'Legal Documents';
      default: return 'Additional Information';
    }
  };

  const formatFieldValue = (field: DynamicField) => {
    switch (field.field_type) {
      case 'number':
        return parseFloat(field.field_value).toLocaleString();
      case 'date':
        return new Date(field.field_value).toLocaleDateString();
      case 'boolean':
        return field.field_value === 'true' ? 'Yes' : 'No';
      case 'url':
        return (
          <a
            href={field.field_value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {field.field_value}
          </a>
        );
      default:
        return field.field_value;
    }
  };

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 rounded w-full"></div>
          <div className="h-3 bg-gray-200 rounded w-3/4"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  const handleAddField = async () => {
    if (!newField.name || !newField.value) {
      alert('Field name and value are required.');
      return;
    }
    try {
      await DynamicFieldService.addDynamicField(vehicleId, newField.name, newField.value, {
        fieldCategory: newField.category as any,
        sourceType: 'manual_entry',
        userId: 'current-user-id' // Replace with actual user ID
      });
      setNewField({ name: '', value: '', category: 'specs' });
      setShowAddForm(false);
      loadDynamicFields();
    } catch (error) {
      console.error('Failed to add dynamic field', error);
    }
  };

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 rounded w-full"></div>
          <div className="h-3 bg-gray-200 rounded w-3/4"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {isOwner && (
        <div className="mb-4">
          <button onClick={() => setShowAddForm(!showAddForm)} className="text-sm text-blue-600 hover:underline">
            {showAddForm ? 'Cancel' : '+ Add Data Field'}
          </button>
          {showAddForm && (
            <div className="mt-2 p-3 border rounded bg-gray-50 space-y-2">
              <input 
                type="text" 
                placeholder="Field Name (e.g., curb_weight_lbs)" 
                value={newField.name} 
                onChange={(e) => setNewField({...newField, name: e.target.value})} 
                className="input w-full text-sm"
              />
              <input 
                type="text" 
                placeholder="Field Value (e.g., 4500)" 
                value={newField.value} 
                onChange={(e) => setNewField({...newField, value: e.target.value})} 
                className="input w-full text-sm"
              />
              <select 
                value={newField.category} 
                onChange={(e) => setNewField({...newField, category: e.target.value})} 
                className="input w-full text-sm"
              >
                <option value="specs">Specifications</option>
                <option value="pricing">Pricing</option>
                <option value="history">History</option>
                <option value="maintenance">Maintenance</option>
                <option value="legal">Legal</option>
                <option value="other">Other</option>
              </select>
              <button onClick={handleAddField} className="button button-primary w-full mt-2">Save Field</button>
            </div>
          )}
        </div>
      )}
      {dynamicFields.length > 0 && Object.entries(groupedFields).map(([category, fields]) => (
        <div key={category} className="mb-6">
          <h4 className="text-sm font-normal mb-2 text-gray-600">
            {getCategoryTitle(category)}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((field) => (
              <div
                key={field.id}
                className="bg-gray-100 rounded-lg p-3 border border-gray-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-700 capitalize text-sm">
                    {field.field_name.replace(/_/g, ' ')}
                  </span>
                  
                  <div className="flex items-center space-x-2">
                    {field.is_verified ? (
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                        ✓ Verified
                      </span>
                    ) : (
                      <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded" style={{fontSize: '8pt'}}>
                        AI Generated
                      </span>
                    )}
                    
                    <button
                      onClick={() => showAuditTrail(field.field_name)}
                      className="text-blue-600 hover:text-blue-800 text-xs underline"
                      title="View data source"
                    >
                      Source
                    </button>
                  </div>
                </div>
                
                <div className="text-gray-800 mb-2 text-sm">
                  {formatFieldValue(field)}
                </div>
                
                {isOwner && !field.is_verified && (
                  <button
                    onClick={() => handleVerifyField(field.field_name)}
                    className="text-xs bg-gray-300 text-gray-800 px-2 py-1 rounded hover:bg-gray-400"
                  >
                    Verify as Accurate
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* FieldAuditTrail component temporarily removed due to type issues */}

      {/* Provenance Modal */}
      {provenance.open && (
        <div
          className="fixed inset-0"
          style={{ background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setProvenance(prev => ({ ...prev, open: false }))}
        >
          <div
            className="bg-white rounded shadow-xl border"
            style={{ width: 'min(720px, 95vw)', maxHeight: '80vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text font-bold">Sources for “{provenance.fieldName.replace(/_/g, ' ')}”</h3>
              <button className="button button-small" onClick={() => setProvenance(prev => ({ ...prev, open: false }))}>Close</button>
            </div>
            <div className="p-4">
              {provenance.entries.length === 0 ? (
                <div className="text-sm text-gray-600">
                  No sources recorded yet for this field. Add sources via Price Data Wizard or edit flows.
                </div>
              ) : (
                <div className="space-y-2">
                  {provenance.entries.map((e, idx) => (
                    <div key={idx} className="border rounded p-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{e.field_value}</div>
                        <div className="text-xs text-gray-600">
                          {new Date(e.updated_at).toLocaleString()} • {e.source_type || 'unknown'}
                          {e.source_name ? ` • ${e.source_name}` : ''}
                          {e.is_verified ? ' • verified' : ''}
                        </div>
                      </div>
                      {e.user_id && (
                        <span className="text-xs text-gray-400">by {e.user_id.slice(0,8)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DynamicVehicleFields;

// Inline modal rendering for provenance (kept simple and local to this component)
/**
 * Note: This component augments the default export by rendering a lightweight modal
 * when provenance.open is true. Since React components must return a single tree,
 * we rely on portal-like fixed positioning within the same tree where used.
 */
