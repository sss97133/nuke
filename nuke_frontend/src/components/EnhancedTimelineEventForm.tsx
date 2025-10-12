import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { imageAPI } from '../services/api';
import { 
  PhotoIcon, 
  DocumentTextIcon, 
  WrenchScrewdriverIcon,
  ClockIcon,
  CurrencyDollarIcon,
  MapPinIcon,
  UserIcon,
  SparklesIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

interface EnhancedTimelineEventData {
  // Basic event data
  event_type: string;
  event_category: string;
  title: string;
  description: string;
  event_date: string;
  mileage_at_event?: number;
  location?: string;
  
  // Work session data
  labor_hours?: number;
  labor_rate?: number;
  technician_level?: 'apprentice' | 'journeyman' | 'master' | 'expert';
  work_complexity?: number;
  tools_required?: string[];
  
  // Parts & materials
  parts_used?: Array<{
    part_number: string;
    part_name: string;
    quantity: number;
    cost: number;
    supplier: string;
    oem_vs_aftermarket: 'oem' | 'aftermarket' | 'rebuilt' | 'used';
    warranty_months?: number;
  }>;
  
  // Professional insights
  diagnostic_findings?: string;
  professional_recommendations?: string;
  follow_up_required?: boolean;
  follow_up_date?: string;
  client_education_provided?: string;
  safety_concerns?: string;
  
  // Quality control
  quality_checklist?: Record<string, boolean>;
  before_photos?: string[];
  during_photos?: string[];
  after_photos?: string[];
  
  // Business metrics
  client_satisfaction_rating?: number;
  efficiency_score?: number;
  learning_outcomes?: string;
  
  // Cost tracking
  receipt_amount?: number;
  estimated_vs_actual_cost?: number;
  
  // Impact assessment
  affects_value: boolean;
  affects_safety: boolean;
  affects_performance: boolean;
}

interface EnhancedTimelineEventFormProps {
  vehicleId: string;
  currentUser: any;
  userRole?: 'owner' | 'professional' | 'contributor';
  onEventCreated: (event: any) => void;
  onClose: () => void;
  initialData?: Partial<EnhancedTimelineEventData>;
}

const EnhancedTimelineEventForm: React.FC<EnhancedTimelineEventFormProps> = ({
  vehicleId,
  currentUser,
  userRole = 'owner',
  onEventCreated,
  onClose,
  initialData
}) => {
  const [formData, setFormData] = useState<EnhancedTimelineEventData>({
    event_type: 'maintenance',
    event_category: 'maintenance',
    title: '',
    description: '',
    event_date: new Date().toISOString().split('T')[0],
    affects_value: false,
    affects_safety: false,
    affects_performance: false,
    ...initialData
  });
  
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [parts, setParts] = useState<EnhancedTimelineEventData['parts_used']>([]);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<Set<string>>(new Set()); // Track uploaded images

  const isProfessional = userRole === 'professional';
  const totalSteps = isProfessional ? 4 : 2; // More steps for professionals

  const handleInputChange = (field: keyof EnhancedTimelineEventData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addPart = () => {
    const newPart = {
      part_number: '',
      part_name: '',
      quantity: 1,
      cost: 0,
      supplier: '',
      oem_vs_aftermarket: 'oem' as const
    };
    setParts(prev => [...(prev || []), newPart]);
  };

  const updatePart = (index: number, field: string, value: any) => {
    setParts(prev => {
      const updated = [...(prev || [])];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removePart = (index: number) => {
    setParts(prev => prev?.filter((_, i) => i !== index) || []);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newImages = Array.from(files);

      // Prevent duplicate file selection by checking name and size
      setSelectedImages(prev => {
        const existingFileIds = new Set(prev.map(f => `${f.name}-${f.size}-${f.lastModified}`));
        const uniqueNewImages = newImages.filter(file => {
          const fileId = `${file.name}-${file.size}-${file.lastModified}`;
          return !existingFileIds.has(fileId);
        });

        if (uniqueNewImages.length !== newImages.length) {
          console.warn(`Duplicate files detected and filtered out: ${newImages.length - uniqueNewImages.length} duplicates`);
        }

        return [...prev, ...uniqueNewImages];
      });
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const saveEvent = async () => {
    setSaving(true);
    
    try {
      // Prepare metadata with all the enhanced data
      const metadata = {
        labor_hours: formData.labor_hours,
        labor_rate: formData.labor_rate,
        technician_level: formData.technician_level,
        work_complexity: formData.work_complexity,
        tools_required: formData.tools_required,
        parts_used: parts,
        diagnostic_findings: formData.diagnostic_findings,
        professional_recommendations: formData.professional_recommendations,
        follow_up_required: formData.follow_up_required,
        follow_up_date: formData.follow_up_date,
        client_education_provided: formData.client_education_provided,
        safety_concerns: formData.safety_concerns,
        quality_checklist: formData.quality_checklist,
        client_satisfaction_rating: formData.client_satisfaction_rating,
        efficiency_score: formData.efficiency_score,
        learning_outcomes: formData.learning_outcomes,
        estimated_vs_actual_cost: formData.estimated_vs_actual_cost,
        route_notes: formData.route_notes,
        session_id: Date.now().toString(36).slice(-8) // Generate unique session ID
      };

      // Create timeline event with enhanced data
      const { data, error } = await supabase
        .from('vehicle_timeline_events')
        .insert({
          vehicle_id: vehicleId,
          user_id: currentUser.id,
          event_type: formData.event_type,
          event_title: formData.title,
          event_description: formData.description,
          event_date: formData.event_date,
          mileage: formData.mileage_at_event,
          location: formData.location,
          cost: formData.receipt_amount,
          metadata: metadata
        })
        .select()
        .single();

      if (error) throw error;

      // Upload images if any are selected (with duplicate prevention)
      if (selectedImages.length > 0) {
        setUploading(true);
        try {
          const uploadPromises = selectedImages.map(async (file) => {
            const fileId = `${file.name}-${file.size}-${file.lastModified}`;

            // Skip if already uploaded
            if (uploadedImages.has(fileId)) {
              console.warn(`Skipping duplicate upload: ${file.name}`);
              return null;
            }

            // Mark as uploading to prevent concurrent uploads
            setUploadedImages(prev => new Set([...prev, fileId]));

            try {
              const uploadFormData = new FormData();
              uploadFormData.append('image', file);
              uploadFormData.append('vehicleId', vehicleId);
              uploadFormData.append('category', 'timeline_event');
              uploadFormData.append('caption', `${formData.title} - ${file.name}`);
              uploadFormData.append('timelineEventId', data.id);

              const result = await imageAPI.uploadVehicleImage(uploadFormData);
              console.log(`Successfully uploaded: ${file.name}`);
              return result;
            } catch (error) {
              // Remove from uploaded set if upload failed
              setUploadedImages(prev => {
                const newSet = new Set(prev);
                newSet.delete(fileId);
                return newSet;
              });
              throw error;
            }
          });

          // Wait for all uploads to complete
          await Promise.allSettled(uploadPromises);
        } catch (uploadError) {
          console.error('Error uploading images:', uploadError);
          // Don't fail the whole operation if image upload fails
        } finally {
          setUploading(false);
        }
      }

      onEventCreated(data);
      onClose();

    } catch (error) {
      console.error('Error saving enhanced timeline event:', error);
    }
    
    setSaving(false);
  };

  const renderStep1_BasicInfo = () => (
    <div className="space-y-4">
      <h3 className="font-medium text-sm">Basic Event Information</h3>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Event Type</label>
          <select
            value={formData.event_type}
            onChange={(e) => handleInputChange('event_type', e.target.value)}
            className="w-full p-2 border rounded text-sm"
          >
            <option value="maintenance">Maintenance</option>
            <option value="repair">Repair</option>
            <option value="modification">Modification</option>
            <option value="inspection">Inspection</option>
            <option value="purchase">Purchase</option>
            <option value="transport">Transport</option>
            <option value="fuel_stop">Fuel Stop</option>
            <option value="route_documentation">Route Documentation</option>
            <option value="pickup_delivery">Pickup/Delivery</option>
            <option value="accident">Accident</option>
            <option value="general">General</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        
        <div>
          <label className="block text-xs font-medium mb-1">Date</label>
          <input
            type="date"
            value={formData.event_date}
            onChange={(e) => handleInputChange('event_date', e.target.value)}
            className="w-full p-2 border rounded text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Title</label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => handleInputChange('title', e.target.value)}
          placeholder="e.g., Oil change and filter replacement"
          className="w-full p-2 border rounded text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => handleInputChange('description', e.target.value)}
          placeholder="Detailed description of work performed..."
          className="w-full p-2 border rounded text-sm h-20 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Mileage</label>
          <input
            type="number"
            value={formData.mileage_at_event || ''}
            onChange={(e) => handleInputChange('mileage_at_event', parseInt(e.target.value))}
            placeholder="Current mileage"
            className="w-full p-2 border rounded text-sm"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium mb-1">Cost</label>
          <input
            type="number"
            step="0.01"
            value={formData.receipt_amount || ''}
            onChange={(e) => handleInputChange('receipt_amount', parseFloat(e.target.value))}
            placeholder="Total cost"
            className="w-full p-2 border rounded text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Location</label>
        <input
          type="text"
          value={formData.location || ''}
          onChange={(e) => handleInputChange('location', e.target.value)}
          placeholder="e.g., Boulder City, NV to St. George, UT"
          className="w-full p-2 border rounded text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Journey/Route Notes</label>
        <textarea
          value={formData.route_notes || ''}
          onChange={(e) => handleInputChange('route_notes', e.target.value)}
          placeholder="Document your journey: U-Haul rental, gas stops, route taken, etc."
          className="w-full p-2 border rounded text-sm h-20 resize-none"
        />
      </div>

      {/* Image Upload Section */}
      <div>
        <label className="block text-xs font-medium mb-2">Photos</label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
          <div className="text-center">
            <PhotoIcon className="mx-auto h-8 w-8 text-gray-400" />
            <div className="mt-2">
              <label htmlFor="image-upload" className="cursor-pointer">
                <span className="text-xs text-blue-600 hover:text-blue-500">
                  Upload photos
                </span>
                <input
                  id="image-upload"
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="sr-only"
                />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">PNG, JPG, GIF up to 10MB</p>
          </div>

          {selectedImages.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {selectedImages.map((file, index) => (
                <div key={index} className="relative">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-16 object-cover rounded border"
                  />
                  <button
                    onClick={() => removeImage(index)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs hover:bg-red-600"
                  >
                    ×
                  </button>
                  <p className="text-xs text-gray-600 mt-1 truncate">{file.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderStep2_ProfessionalDetails = () => (
    <div className="space-y-4">
      <h3 className="font-medium text-sm">Professional Work Details</h3>
      
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Labor Hours</label>
          <input
            type="number"
            step="0.25"
            value={formData.labor_hours || ''}
            onChange={(e) => handleInputChange('labor_hours', parseFloat(e.target.value))}
            className="w-full p-2 border rounded text-sm"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium mb-1">Hourly Rate</label>
          <input
            type="number"
            step="0.01"
            value={formData.labor_rate || ''}
            onChange={(e) => handleInputChange('labor_rate', parseFloat(e.target.value))}
            className="w-full p-2 border rounded text-sm"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium mb-1">Complexity (1-10)</label>
          <input
            type="number"
            min="1"
            max="10"
            value={formData.work_complexity || ''}
            onChange={(e) => handleInputChange('work_complexity', parseInt(e.target.value))}
            className="w-full p-2 border rounded text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Technician Level</label>
        <select
          value={formData.technician_level || ''}
          onChange={(e) => handleInputChange('technician_level', e.target.value)}
          className="w-full p-2 border rounded text-sm"
        >
          <option value="">Select level</option>
          <option value="apprentice">Apprentice</option>
          <option value="journeyman">Journeyman</option>
          <option value="master">Master</option>
          <option value="expert">Expert</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Diagnostic Findings</label>
        <textarea
          value={formData.diagnostic_findings || ''}
          onChange={(e) => handleInputChange('diagnostic_findings', e.target.value)}
          placeholder="What did you discover during diagnosis?"
          className="w-full p-2 border rounded text-sm h-16 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Professional Recommendations</label>
        <textarea
          value={formData.professional_recommendations || ''}
          onChange={(e) => handleInputChange('professional_recommendations', e.target.value)}
          placeholder="What should be done next? Future maintenance needs?"
          className="w-full p-2 border rounded text-sm h-16 resize-none"
        />
      </div>
    </div>
  );

  const renderStep3_PartsTracking = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Parts & Materials Used</h3>
        <button
          type="button"
          onClick={addPart}
          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add Part
        </button>
      </div>

      {parts && parts.length > 0 ? (
        <div className="space-y-3">
          {parts.map((part, index) => (
            <div key={index} className="bg-gray-50 p-3 rounded border">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Part Number</label>
                  <input
                    type="text"
                    value={part.part_number}
                    onChange={(e) => updatePart(index, 'part_number', e.target.value)}
                    placeholder="e.g., 15400-PLM-A02"
                    className="w-full p-2 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Part Name</label>
                  <input
                    type="text"
                    value={part.part_name}
                    onChange={(e) => updatePart(index, 'part_name', e.target.value)}
                    placeholder="e.g., Oil Filter"
                    className="w-full p-2 border rounded text-sm"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={part.quantity}
                    onChange={(e) => updatePart(index, 'quantity', parseInt(e.target.value))}
                    className="w-full p-2 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={part.cost}
                    onChange={(e) => updatePart(index, 'cost', parseFloat(e.target.value))}
                    className="w-full p-2 border rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Type</label>
                  <select
                    value={part.oem_vs_aftermarket}
                    onChange={(e) => updatePart(index, 'oem_vs_aftermarket', e.target.value)}
                    className="w-full p-2 border rounded text-sm"
                  >
                    <option value="oem">OEM</option>
                    <option value="aftermarket">Aftermarket</option>
                    <option value="rebuilt">Rebuilt</option>
                    <option value="used">Used</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => removePart(index)}
                    className="w-full p-2 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-medium mb-1">Supplier</label>
                <input
                  type="text"
                  value={part.supplier}
                  onChange={(e) => updatePart(index, 'supplier', e.target.value)}
                  placeholder="e.g., AutoZone, Honda Dealer, etc."
                  className="w-full p-2 border rounded text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-gray-500">
          <WrenchScrewdriverIcon className="w-6 h-6 mx-auto mb-2 text-gray-400" />
          <p className="text-xs">No parts added yet</p>
          <p className="text-xs">Click "Add Part" to track materials used</p>
        </div>
      )}
    </div>
  );

  const renderStep4_QualityControl = () => (
    <div className="space-y-4">
      <h3 className="font-medium text-sm">Quality Control & Follow-up</h3>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Client Satisfaction (1-5)</label>
          <select
            value={formData.client_satisfaction_rating || ''}
            onChange={(e) => handleInputChange('client_satisfaction_rating', parseInt(e.target.value))}
            className="w-full p-2 border rounded text-sm"
          >
            <option value="">Not rated</option>
            <option value="5">5 - Excellent</option>
            <option value="4">4 - Good</option>
            <option value="3">3 - Average</option>
            <option value="2">2 - Poor</option>
            <option value="1">1 - Terrible</option>
          </select>
        </div>
        
        <div>
          <label className="block text-xs font-medium mb-1">Efficiency Score (1-100)</label>
          <input
            type="number"
            min="1"
            max="100"
            value={formData.efficiency_score || ''}
            onChange={(e) => handleInputChange('efficiency_score', parseInt(e.target.value))}
            placeholder="How efficient was this work?"
            className="w-full p-2 border rounded text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Safety Concerns</label>
        <textarea
          value={formData.safety_concerns || ''}
          onChange={(e) => handleInputChange('safety_concerns', e.target.value)}
          placeholder="Any safety issues discovered or addressed?"
          className="w-full p-2 border rounded text-sm h-16 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Learning Outcomes</label>
        <textarea
          value={formData.learning_outcomes || ''}
          onChange={(e) => handleInputChange('learning_outcomes', e.target.value)}
          placeholder="What did you learn? Any process improvements?"
          className="w-full p-2 border rounded text-sm h-16 resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium">Impact Assessment</label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={formData.affects_value}
              onChange={(e) => handleInputChange('affects_value', e.target.checked)}
            />
            Affects vehicle value
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={formData.affects_safety}
              onChange={(e) => handleInputChange('affects_safety', e.target.checked)}
            />
            Affects safety
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={formData.affects_performance}
              onChange={(e) => handleInputChange('affects_performance', e.target.checked)}
            />
            Affects performance
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={formData.follow_up_required || false}
          onChange={(e) => handleInputChange('follow_up_required', e.target.checked)}
          id="follow-up"
        />
        <label htmlFor="follow-up" className="text-xs">Follow-up required</label>
        {formData.follow_up_required && (
          <input
            type="date"
            value={formData.follow_up_date || ''}
            onChange={(e) => handleInputChange('follow_up_date', e.target.value)}
            className="p-1 border rounded text-xs"
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">
            {isProfessional ? 'Professional Work Documentation' : 'Add Timeline Event'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* Progress Indicator */}
        <div className="px-4 py-2 bg-gray-50 border-b">
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`flex-1 h-1 rounded ${
                  i + 1 <= currentStep ? 'bg-blue-500' : 'bg-gray-300'
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-1">
            Step {currentStep} of {totalSteps}
          </p>
        </div>

        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {currentStep === 1 && renderStep1_BasicInfo()}
          {currentStep === 2 && isProfessional && renderStep2_ProfessionalDetails()}
          {currentStep === 3 && isProfessional && renderStep3_PartsTracking()}
          {currentStep === 4 && isProfessional && renderStep4_QualityControl()}
          {currentStep === 2 && !isProfessional && renderStep4_QualityControl()}
        </div>

        <div className="flex justify-between p-4 border-t">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="px-4 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            
            {currentStep < totalSteps ? (
              <button
                onClick={() => setCurrentStep(currentStep + 1)}
                disabled={!formData.title.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Next
              </button>
            ) : (
              <button
                onClick={saveEvent}
                disabled={saving || uploading || !formData.title.trim()}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {uploading ? 'Uploading Images...' : saving ? 'Saving...' : 'Save Event'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedTimelineEventForm;
