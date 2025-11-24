import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface TitleValidationModalProps {
  vehicleId: string;
  titleData: any;
  onClose: () => void;
  onApply: (updates: any) => void;
}

interface FieldComparison {
  field: string;
  displayName: string;
  profileValue: any;
  titleValue: any;
  status: 'match' | 'empty' | 'conflict' | 'suggestion';
  severity?: 'low' | 'medium' | 'high';
  selected: boolean;
  notes?: string;
}

export function TitleValidationModal({ 
  vehicleId, 
  titleData, 
  onClose, 
  onApply 
}: TitleValidationModalProps) {
  const [comparisons, setComparisons] = useState<FieldComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleData, setVehicleData] = useState<any>(null);

  useEffect(() => {
    loadVehicleData();
  }, [vehicleId, titleData]);

  const loadVehicleData = async () => {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('vin, mileage, year, make, model, owner_id')
      .eq('id', vehicleId)
      .single();

    setVehicleData(vehicle);

    // Build field comparisons
    const fields: FieldComparison[] = [];

    // VIN
    if (titleData.vin) {
      const status = !vehicle?.vin ? 'empty' : 
                     vehicle.vin === titleData.vin ? 'match' : 'conflict';
      fields.push({
        field: 'vin',
        displayName: 'VIN',
        profileValue: vehicle?.vin || '(empty)',
        titleValue: titleData.vin,
        status,
        severity: status === 'conflict' ? 'high' : undefined,
        selected: status === 'empty' // Auto-select if empty
      });
    }

    // Mileage
    if (titleData.odometer_reading) {
      let status: 'match' | 'empty' | 'conflict' | 'suggestion' = 'empty';
      let severity: 'low' | 'medium' | 'high' | undefined;
      let notes: string | undefined;

      if (!vehicle?.mileage) {
        status = 'empty';
      } else {
        const diff = Math.abs(vehicle.mileage - titleData.odometer_reading);
        if (diff < 100) {
          status = 'match';
        } else if (diff < 10000) {
          status = 'suggestion';
          severity = 'low';
          notes = `${diff.toLocaleString()} mile difference - likely due to time difference`;
        } else {
          status = 'conflict';
          severity = 'high';
          notes = `${diff.toLocaleString()} mile difference - verify which is correct`;
        }
      }

      fields.push({
        field: 'mileage',
        displayName: 'Mileage',
        profileValue: vehicle?.mileage?.toLocaleString() || '(empty)',
        titleValue: titleData.odometer_reading.toLocaleString() + 
                   (titleData.odometer_date ? ` (as of ${titleData.odometer_date})` : ''),
        status,
        severity,
        notes,
        selected: status === 'empty'
      });
    }

    // Year
    if (titleData.year) {
      const titleYear = parseInt(titleData.year);
      const status = !vehicle?.year ? 'empty' :
                     vehicle.year === titleYear ? 'match' : 'conflict';
      fields.push({
        field: 'year',
        displayName: 'Year',
        profileValue: vehicle?.year || '(empty)',
        titleValue: titleYear,
        status,
        severity: status === 'conflict' ? 'high' : undefined,
        selected: status === 'empty'
      });
    }

    // Make
    if (titleData.make) {
      const status = !vehicle?.make ? 'empty' :
                     vehicle.make.toLowerCase() === titleData.make.toLowerCase() ? 'match' : 'conflict';
      fields.push({
        field: 'make',
        displayName: 'Make',
        profileValue: vehicle?.make || '(empty)',
        titleValue: titleData.make,
        status,
        severity: status === 'conflict' ? 'medium' : undefined,
        selected: status === 'empty'
      });
    }

    // Model
    if (titleData.model) {
      const status = !vehicle?.model ? 'empty' :
                     vehicle.model.toLowerCase() === titleData.model.toLowerCase() ? 'match' : 'conflict';
      fields.push({
        field: 'model',
        displayName: 'Model',
        profileValue: vehicle?.model || '(empty)',
        titleValue: titleData.model,
        status,
        severity: status === 'conflict' ? 'medium' : undefined,
        selected: status === 'empty'
      });
    }

    // State
    if (titleData.state) {
      const status = !vehicle?.registration_state ? 'empty' :
                     vehicle.registration_state === titleData.state ? 'match' : 'conflict';
      fields.push({
        field: 'registration_state',
        displayName: 'Registration State',
        profileValue: vehicle?.registration_state || '(empty)',
        titleValue: titleData.state,
        status,
        severity: status === 'conflict' ? 'low' : undefined,
        selected: status === 'empty'
      });
    }

    setComparisons(fields);
    setLoading(false);

    // Check if validation needed
    const conflicts = fields.filter(f => f.status === 'conflict');
    if (conflicts.length > 0 && onValidationNeeded) {
      onValidationNeeded(conflicts);
    }
  };

  const toggleField = (field: string) => {
    setComparisons(prev => 
      prev.map(f => f.field === field ? { ...f, selected: !f.selected } : f)
    );
  };

  const applySelected = async () => {
    const updates: any = {};
    const selectedFields = comparisons.filter(c => c.selected);

    selectedFields.forEach(field => {
      updates[field.field] = field.titleValue;
    });

    if (Object.keys(updates).length === 0) {
      onClose();
      return;
    }

    // Apply updates to vehicle
    const { error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId);

    if (error) {
      console.error('Failed to apply title data:', error);
      return;
    }

    // Track in field sources
    for (const field of selectedFields) {
      await supabase
        .from('vehicle_field_sources')
        .insert({
          vehicle_id: vehicleId,
          field_name: field.field,
          source_type: 'title_document',
          confidence_score: Math.round((titleData.extraction_confidence || 0.9) * 100),
          source_image_id: titleData.image_id,
          extraction_method: 'ai_vision',
          field_value: String(field.titleValue)
        });
    }

    onApply(updates);
    onClose();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <div className="text-center">Loading title data...</div>
        </div>
      </div>
    );
  }

  const conflictCount = comparisons.filter(c => c.status === 'conflict').length;
  const suggestionCount = comparisons.filter(c => c.status === 'empty').length;
  const selectedCount = comparisons.filter(c => c.selected).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
          <h2 className="text-2xl font-bold">Title Document Data Extracted</h2>
          <p className="mt-2 text-blue-100">
            Review and apply extracted information to your vehicle profile
          </p>
        </div>

        {/* Summary */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center space-x-6 text-sm">
            {suggestionCount > 0 && (
              <div className="flex items-center space-x-2">
                <span className="text-green-600 text-xl">✓</span>
                <span>{suggestionCount} field{suggestionCount !== 1 ? 's' : ''} can be filled</span>
              </div>
            )}
            {conflictCount > 0 && (
              <div className="flex items-center space-x-2">
                <span className="text-yellow-600 text-xl">⚠</span>
                <span className="text-yellow-700 font-medium">
                  {conflictCount} conflict{conflictCount !== 1 ? 's' : ''} need review
                </span>
              </div>
            )}
            <div className="text-gray-500">
              Confidence: {Math.round((titleData.extraction_confidence || 0.9) * 100)}%
            </div>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {comparisons.map(comparison => (
              <div
                key={comparison.field}
                className={`
                  border-2 rounded-lg p-4 transition-all
                  ${comparison.status === 'conflict' ? 'border-yellow-400 bg-yellow-50' : ''}
                  ${comparison.status === 'empty' ? 'border-green-400 bg-green-50' : ''}
                  ${comparison.status === 'match' ? 'border-gray-300 bg-gray-50' : ''}
                  ${comparison.status === 'suggestion' ? 'border-blue-400 bg-blue-50' : ''}
                  ${comparison.selected ? 'ring-2 ring-blue-500' : ''}
                `}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={comparison.selected}
                        onChange={() => toggleField(comparison.field)}
                        disabled={comparison.status === 'match'}
                        className="w-5 h-5 rounded border-gray-300"
                      />
                      <div>
                        <h4 className="font-bold text-lg">{comparison.displayName}</h4>
                        {comparison.severity && (
                          <span className={`
                            text-xs px-2 py-1 rounded
                            ${comparison.severity === 'high' ? 'bg-red-100 text-red-700' : ''}
                            ${comparison.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' : ''}
                            ${comparison.severity === 'low' ? 'bg-blue-100 text-blue-700' : ''}
                          `}>
                            {comparison.severity.toUpperCase()} PRIORITY
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-4 ml-8">
                      <div>
                        <div className="text-xs text-gray-500 font-medium mb-1">PROFILE</div>
                        <div className={`font-mono text-sm ${!vehicleData?.[comparison.field] ? 'text-gray-400 italic' : ''}`}>
                          {comparison.profileValue}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 font-medium mb-1">TITLE DOCUMENT</div>
                        <div className="font-mono text-sm font-bold">
                          {comparison.titleValue}
                        </div>
                      </div>
                    </div>

                    {comparison.notes && (
                      <div className="mt-2 ml-8 text-sm text-gray-600 italic">
                        {comparison.notes}
                      </div>
                    )}

                    {comparison.status === 'conflict' && (
                      <div className="mt-3 ml-8 p-3 bg-white border border-yellow-300 rounded text-sm">
                        <strong>Conflict detected:</strong> Profile and title don't match.
                        Select checkbox to use title value, or leave unchecked to keep profile value.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-200 p-6 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedCount > 0 ? (
                <span className="font-medium">
                  {selectedCount} field{selectedCount !== 1 ? 's' : ''} selected for update
                </span>
              ) : (
                <span>No fields selected</span>
              )}
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={onClose}
                className="px-6 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-100 font-medium"
              >
                Skip for Now
              </button>
              <button
                onClick={applySelected}
                disabled={selectedCount === 0}
                className={`
                  px-6 py-2 rounded-lg font-medium
                  ${selectedCount > 0 
                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }
                `}
              >
                Apply {selectedCount} Update{selectedCount !== 1 ? 's' : ''}
              </button>
            </div>
          </div>

          {conflictCount > 0 && (
            <div className="mt-4 p-4 bg-yellow-50 border-2 border-yellow-300 rounded-lg">
              <div className="flex items-start space-x-2">
                <span className="text-yellow-600 text-xl">⚠️</span>
                <div className="flex-1">
                  <strong className="text-yellow-900">Review Conflicts Carefully</strong>
                  <p className="text-sm text-yellow-800 mt-1">
                    {conflictCount} field{conflictCount !== 1 ? 's' : ''} don't match between 
                    your profile and the title. This could indicate:
                  </p>
                  <ul className="text-sm text-yellow-800 mt-2 ml-4 list-disc">
                    <li>Title is from previous owner (normal)</li>
                    <li>Data entry error in profile</li>
                    <li>Wrong title document uploaded</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

