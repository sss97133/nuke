import React, { useState, useEffect } from 'react';
import type { BusinessFormData, BusinessType } from '../types/business';
import type { BUSINESS_TYPES, SPECIALIZATIONS, SERVICES_OFFERED } from '../types/business';
import type { BusinessService } from '../services/businessService';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import type { useAuth } from '../hooks/useAuth';

interface BusinessFormProps {
  onSuccess?: (business: any) => void;
  onCancel?: () => void;
  initialData?: Partial<BusinessFormData>;
  mode?: 'create' | 'edit';
}

export const BusinessForm: React.FC<BusinessFormProps> = ({
  onSuccess,
  onCancel,
  initialData,
  mode = 'create'
}) => {
  const [formData, setFormData] = useState<BusinessFormData>({
    business_name: initialData?.business_name || '',
    legal_name: initialData?.legal_name || '',
    business_type: initialData?.business_type || 'garage',
    industry_focus: initialData?.industry_focus || [],
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    website: initialData?.website || '',
    address: initialData?.address || '',
    city: initialData?.city || '',
    state: initialData?.state || '',
    zip_code: initialData?.zip_code || '',
    description: initialData?.description || '',
    specializations: initialData?.specializations || [],
    services_offered: initialData?.services_offered || [],
    years_in_business: initialData?.years_in_business || undefined,
    employee_count: initialData?.employee_count || undefined,
    facility_size_sqft: initialData?.facility_size_sqft || undefined,
    accepts_dropoff: initialData?.accepts_dropoff || false,
    offers_mobile_service: initialData?.offers_mobile_service || false,
    has_lift: initialData?.has_lift || false,
    has_paint_booth: initialData?.has_paint_booth || false,
    has_dyno: initialData?.has_dyno || false,
    has_alignment_rack: initialData?.has_alignment_rack || false,
    hours_of_operation: initialData?.hours_of_operation || {},
    hourly_rate_min: initialData?.hourly_rate_min || undefined,
    hourly_rate_max: initialData?.hourly_rate_max || undefined,
    service_radius_miles: initialData?.service_radius_miles || undefined,
    business_license: initialData?.business_license || '',
    tax_id: initialData?.tax_id || '',
    registration_state: initialData?.registration_state || '',
    registration_date: initialData?.registration_date || ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleInputChange = (field: keyof BusinessFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const handleArrayInputChange = (field: keyof BusinessFormData, value: string) => {
    const currentArray = formData[field] as string[];
    const newArray = value.split(',').map(item => item.trim()).filter(item => item);
    handleInputChange(field, newArray);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.business_name.trim()) {
      newErrors.business_name = 'Business name is required';
    }

    if (!formData.business_type) {
      newErrors.business_type = 'Business type is required';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (formData.website && !formData.website.startsWith('http')) {
      newErrors.website = 'Website must start with http:// or https://';
    }

    if (formData.hourly_rate_min && formData.hourly_rate_max && 
        formData.hourly_rate_min > formData.hourly_rate_max) {
      newErrors.hourly_rate_max = 'Max rate must be greater than min rate';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    
    try {
      const business = await BusinessService.createBusiness(formData);
      console.log('Business created successfully:', business);
      onSuccess?.(business);
    } catch (error) {
      console.error('Error creating business:', error);
      setErrors({ submit: 'Failed to create business. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <div className="card-header">
          {mode === 'create' ? 'Create New Business' : 'Edit Business'}
        </div>
        <div className="card-body">

      <form onSubmit={handleSubmit}>
        {/* Basic Information */}
        <div className="section">
          <h3 className="text font-bold">Basic Information</h3>
          
          <div className="grid grid-cols-2">
            <div className="form-group">
              <label className="form-label">
                Business Name *
              </label>
              <input
                type="text"
                value={formData.business_name}
                onChange={(e) => handleInputChange('business_name', e.target.value)}
                className="form-input"
                placeholder="Enter business name"
              />
              {errors.business_name && (
                <p className="text-red-500 text-sm mt-1">{errors.business_name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Legal Name (if different)
              </label>
              <input
                type="text"
                value={formData.legal_name}
                onChange={(e) => handleInputChange('legal_name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter legal business name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Business Type *
              </label>
              <select
                value={formData.business_type}
                onChange={(e) => handleInputChange('business_type', e.target.value as BusinessType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BUSINESS_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              {errors.business_type && (
                <p className="text-red-500 text-sm mt-1">{errors.business_type}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Years in Business
              </label>
              <input
                type="number"
                value={formData.years_in_business || ''}
                onChange={(e) => handleInputChange('years_in_business', e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
                min="0"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Business Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Describe your business, services, and specialties..."
            />
          </div>
        </div>

        {/* Contact Information */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="business@example.com"
              />
              {errors.email && (
                <p className="text-red-500 text-sm mt-1">{errors.email}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="(555) 123-4567"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Website
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => handleInputChange('website', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://www.example.com"
              />
              {errors.website && (
                <p className="text-red-500 text-sm mt-1">{errors.website}</p>
              )}
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Location</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Address
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="123 Main Street"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => handleInputChange('city', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="City"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  State
                </label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => handleInputChange('state', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="State"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ZIP Code
                </label>
                <input
                  type="text"
                  value={formData.zip_code}
                  onChange={(e) => handleInputChange('zip_code', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="12345"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Services & Capabilities */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Services & Capabilities</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Specializations (comma-separated)
              </label>
              <input
                type="text"
                value={formData.specializations.join(', ')}
                onChange={(e) => handleArrayInputChange('specializations', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="engine_rebuild, paint_and_bodywork, electrical_systems"
              />
              <p className="text-sm text-gray-500 mt-1">
                Available: {SPECIALIZATIONS.join(', ')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Services Offered (comma-separated)
              </label>
              <input
                type="text"
                value={formData.services_offered.join(', ')}
                onChange={(e) => handleArrayInputChange('services_offered', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="maintenance, repair, restoration, custom_build"
              />
              <p className="text-sm text-gray-500 mt-1">
                Available: {SERVICES_OFFERED.join(', ')}
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.accepts_dropoff}
                  onChange={(e) => handleInputChange('accepts_dropoff', e.target.checked)}
                  className="mr-2"
                />
                Accepts Drop-off
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.offers_mobile_service}
                  onChange={(e) => handleInputChange('offers_mobile_service', e.target.checked)}
                  className="mr-2"
                />
                Mobile Service
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.has_lift}
                  onChange={(e) => handleInputChange('has_lift', e.target.checked)}
                  className="mr-2"
                />
                Has Lift
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.has_paint_booth}
                  onChange={(e) => handleInputChange('has_paint_booth', e.target.checked)}
                  className="mr-2"
                />
                Paint Booth
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.has_dyno}
                  onChange={(e) => handleInputChange('has_dyno', e.target.checked)}
                  className="mr-2"
                />
                Has Dyno
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.has_alignment_rack}
                  onChange={(e) => handleInputChange('has_alignment_rack', e.target.checked)}
                  className="mr-2"
                />
                Alignment Rack
              </label>
            </div>
          </div>
        </div>

        {/* Business Details */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Business Details</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Employee Count
              </label>
              <input
                type="number"
                value={formData.employee_count || ''}
                onChange={(e) => handleInputChange('employee_count', e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Facility Size (sq ft)
              </label>
              <input
                type="number"
                value={formData.facility_size_sqft || ''}
                onChange={(e) => handleInputChange('facility_size_sqft', e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Service Radius (miles)
              </label>
              <input
                type="number"
                value={formData.service_radius_miles || ''}
                onChange={(e) => handleInputChange('service_radius_miles', e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
                min="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Min Hourly Rate ($)
              </label>
              <input
                type="number"
                value={formData.hourly_rate_min || ''}
                onChange={(e) => handleInputChange('hourly_rate_min', e.target.value ? parseFloat(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                step="0.01"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Hourly Rate ($)
              </label>
              <input
                type="number"
                value={formData.hourly_rate_max || ''}
                onChange={(e) => handleInputChange('hourly_rate_max', e.target.value ? parseFloat(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
                step="0.01"
                min="0"
              />
              {errors.hourly_rate_max && (
                <p className="text-red-500 text-sm mt-1">{errors.hourly_rate_max}</p>
              )}
            </div>
          </div>
        </div>

        {/* Legal Information */}
        <div className="bg-gray-50 p-6 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Legal Information</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Business License #
              </label>
              <input
                type="text"
                value={formData.business_license}
                onChange={(e) => handleInputChange('business_license', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="License number"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tax ID / EIN
              </label>
              <input
                type="text"
                value={formData.tax_id}
                onChange={(e) => handleInputChange('tax_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="XX-XXXXXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Registration State
              </label>
              <input
                type="text"
                value={formData.registration_state}
                onChange={(e) => handleInputChange('registration_state', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="State"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Registration Date
              </label>
              <input
                type="date"
                value={formData.registration_date}
                onChange={(e) => handleInputChange('registration_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-4 pt-6 border-t">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Cancel
            </button>
          )}
          
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : mode === 'create' ? 'Create Business' : 'Update Business'}
          </button>
        </div>

        {errors.submit && (
          <div className="text-red-500 text-sm text-center">
            {errors.submit}
          </div>
        )}
      </form>
        </div>
      </div>
    </div>
  );
};
