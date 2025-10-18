import React, { useState, useEffect } from 'react';
import { 
  X, Save, ChevronDown, ChevronUp, Wand2, Upload, 
  Calendar, MapPin, Ruler, Car, AlertCircle, Image as ImageIcon 
} from 'lucide-react';
import { BulkImageUploader } from './BulkImageUploader';
import type { VehicleSpecService } from '@/services/vehicleSpecService';

interface VehicleDataEditorEnhancedProps {
  vehicleId: string;
  onClose?: () => void;
}

export function VehicleDataEditorEnhanced({ vehicleId, onClose }: VehicleDataEditorEnhancedProps) {
  const [vehicleData, setVehicleData] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState<any>({});
  
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    images: true,  // Start with images section open
    pricing: false,
    financial: false,
    dimensions: false,
    modifications: false
  });

  // Load vehicle data on mount
  useEffect(() => {
    loadVehicleData();
  }, [vehicleId]);

  const loadVehicleData = async () => {
    try {
      const { data } = await fetch(`/api/vehicles/${vehicleId}`).then(r => r.json());
      if (data) {
        setVehicleData(data);
        setFormData(data);
      }
    } catch (error) {
      console.error('Error loading vehicle:', error);
    }
  };

  // Handle image extraction data
  const handleDataExtracted = (extractedData: any) => {
    console.log('Extracted data from images:', extractedData);
    
    // Auto-fill form with extracted data
    setFormData({
      ...formData,
      purchase_date: extractedData.purchaseDate || formData.purchase_date,
      purchase_location: extractedData.purchaseLocation || formData.purchase_location,
    });
    
    // Show what was extracted
    setMessage(`Extracted: ${extractedData.purchaseDate ? 'Purchase Date' : ''} ${extractedData.purchaseLocation ? ', Location' : ''} from images`);
    
    // Clear message after 5 seconds
    setTimeout(() => setMessage(''), 5000);
  };

  // Auto-fill dimensions and specs from database/API
  const handleAutoFillSpecs = async () => {
    if (!vehicleData.make || !vehicleData.model || !vehicleData.year) {
      setMessage('Need make, model, and year to auto-fill specs');
      return;
    }
    
    setIsAutoFilling(true);
    setMessage('Looking up vehicle specifications...');
    
    try {
      const specs = await VehicleSpecService.lookupFromDealerDB(
        vehicleData.make,
        vehicleData.model,
        vehicleData.year,
        vehicleData.trim
      );
      
      if (specs) {
        setFormData({
          ...formData,
          ...specs
        });
        setMessage('Auto-filled specifications from dealer database');
      } else {
        setMessage('No specifications found in database');
      }
    } catch (error) {
      console.error('Error auto-filling specs:', error);
      setMessage('Error looking up specifications');
    } finally {
      setIsAutoFilling(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'number' ? (value === '' ? null : parseFloat(value)) : value
    });
  };

  const toggleSection = (section: string) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section]
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[90%] max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">
              Smart Vehicle Data Editor
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Upload images to automatically extract purchase date, location, and more
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Image Upload Section - Always First */}
          <div className="mb-6">
            <button
              onClick={() => toggleSection('images')}
              className="w-full flex items-center justify-between p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ImageIcon className="w-5 h-5 text-blue-600" />
                <div className="text-left">
                  <h3 className="font-semibold text-blue-900">Upload Images (500+ supported)</h3>
                  <p className="text-sm text-blue-700">Extract purchase date, location, and condition from photos</p>
                </div>
              </div>
              {expandedSections.images ? (
                <ChevronUp className="w-5 h-5 text-blue-600" />
              ) : (
                <ChevronDown className="w-5 h-5 text-blue-600" />
              )}
            </button>
            
            {expandedSections.images && (
              <div className="mt-4 p-4 border rounded-lg bg-gray-50">
                <BulkImageUploader
                  vehicleId={vehicleId}
                  onDataExtracted={handleDataExtracted}
                  onImagesUploaded={() => {
                    console.log('Images uploaded successfully');
                  }}
                />
              </div>
            )}
          </div>

          {/* Auto-extracted Information Alert */}
          {message && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-green-800">{message}</p>
              </div>
            </div>
          )}

          {/* Price Information Section */}
          <div className="mb-6">
            <button
              onClick={() => toggleSection('pricing')}
              className="w-full flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <h3 className="font-semibold flex items-center gap-2">
                Price Information
                {formData.purchase_date && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                    Auto-filled from images
                  </span>
                )}
              </h3>
              {expandedSections.pricing ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
            
            {expandedSections.pricing && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Purchase Date
                    {formData.purchase_date && (
                      <span className="ml-2 text-xs text-green-600">(from EXIF)</span>
                    )}
                  </label>
                  <input
                    type="date"
                    name="purchase_date"
                    value={formData.purchase_date || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <MapPin className="w-4 h-4 inline mr-1" />
                    Purchase Location
                    {formData.purchase_location && (
                      <span className="ml-2 text-xs text-green-600">(from GPS)</span>
                    )}
                  </label>
                  <input
                    type="text"
                    name="purchase_location"
                    value={formData.purchase_location || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Auto-filled from image GPS"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Purchase Price
                  </label>
                  <input
                    type="number"
                    name="purchase_price"
                    value={formData.purchase_price || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Amount paid"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Current Value
                  </label>
                  <input
                    type="number"
                    name="current_value"
                    value={formData.current_value || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Estimated value"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Dimensions & Weight Section with Auto-fill */}
          <div className="mb-6">
            <button
              onClick={() => toggleSection('dimensions')}
              className="w-full flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <h3 className="font-semibold flex items-center gap-2">
                <Ruler className="w-5 h-5" />
                Dimensions & Weight
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAutoFillSpecs();
                  }}
                  disabled={isAutoFilling}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <Wand2 className="w-4 h-4" />
                  {isAutoFilling ? 'Loading...' : 'Auto-fill'}
                </button>
                {expandedSections.dimensions ? (
                  <ChevronUp className="w-5 h-5" />
                ) : (
                  <ChevronDown className="w-5 h-5" />
                )}
              </div>
            </button>
            
            {expandedSections.dimensions && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Length (inches)
                  </label>
                  <input
                    type="number"
                    name="length_inches"
                    value={formData.length_inches || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Auto-filled from database"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Width (inches)
                  </label>
                  <input
                    type="number"
                    name="width_inches"
                    value={formData.width_inches || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Auto-filled from database"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Height (inches)
                  </label>
                  <input
                    type="number"
                    name="height_inches"
                    value={formData.height_inches || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Auto-filled from database"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Weight (lbs)
                  </label>
                  <input
                    type="number"
                    name="weight_lbs"
                    value={formData.weight_lbs || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Auto-filled from database"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Wheelbase (inches)
                  </label>
                  <input
                    type="number"
                    name="wheelbase_inches"
                    value={formData.wheelbase_inches || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Auto-filled from database"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Seating Capacity
                  </label>
                  <input
                    type="number"
                    name="seating_capacity"
                    value={formData.seating_capacity || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Number of seats"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Modifications & Condition Section */}
          <div className="mb-6">
            <button
              onClick={() => toggleSection('modifications')}
              className="w-full flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <h3 className="font-semibold flex items-center gap-2">
                <Car className="w-5 h-5" />
                Modifications & Condition
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded">
                  AI analyzes from images
                </span>
              </h3>
              {expandedSections.modifications ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
            
            {expandedSections.modifications && (
              <div className="mt-4 space-y-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800">
                    Upload images to automatically detect modifications, damage, and overall condition.
                    Our AI analyzes paint quality, aftermarket parts, wear patterns, and more.
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Detected Modifications
                  </label>
                  <textarea
                    name="modification_details"
                    value={formData.modification_details || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Automatically populated from image analysis..."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Condition Notes
                  </label>
                  <textarea
                    name="condition_notes"
                    value={formData.condition_notes || ''}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="AI-detected wear, damage, or exceptional conditions..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <div className="text-sm text-gray-600">
            💡 Upload images first to auto-fill purchase date, location, and condition
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {/* Save logic */}}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
