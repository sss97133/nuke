// AddVehicle - Vehicle Form State Management Hook
import { useState, useCallback, useEffect } from 'react';
import type { VehicleFormData, VerificationProgress, AutoSaveState } from '../types';
import { calculateVerificationProgress } from '../utils/verificationProgress';

const AUTOSAVE_KEY = 'addVehicleFormData';
const AUTOSAVE_INTERVAL = 2000; // 2 seconds

interface UseVehicleFormResult {
  // Form state
  formData: VehicleFormData;
  verificationProgress: VerificationProgress;
  autoSaveState: AutoSaveState;
  error: string | null;

  // Form actions
  updateField: (name: keyof VehicleFormData, value: any) => void;
  updateFormData: (data: Partial<VehicleFormData>) => void;
  resetForm: () => void;
  clearAutosave: () => void;

  // Validation
  validateForm: () => boolean;
  getRequiredFieldErrors: () => string[];
}

const DEFAULT_FORM_DATA: VehicleFormData = {
  make: '',
  model: '',
  relationship_type: 'owned',
  is_public: true,
  status: 'active',
  scanned_fields: [],
  import_url: '',
  discoverer_opinion: '',
  listing_source: '',
  listing_url: ''
};

export function useVehicleForm(initialData: Partial<VehicleFormData> = {}): UseVehicleFormResult {
  // Load initial data from localStorage or props
  const [formData, setFormData] = useState<VehicleFormData>(() => {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      try {
        const parsedData = JSON.parse(saved);
        return { ...DEFAULT_FORM_DATA, ...parsedData, ...initialData };
      } catch (error) {
        console.warn('Failed to parse saved form data:', error);
      }
    }
    return { ...DEFAULT_FORM_DATA, ...initialData };
  });

  const [verificationProgress, setVerificationProgress] = useState<VerificationProgress>(() =>
    calculateVerificationProgress(formData)
  );

  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>({
    lastSaved: '',
    hasUnsavedChanges: false
  });

  const [error, setError] = useState<string | null>(null);

  // Auto-save form data
  useEffect(() => {
    if (autoSaveState.hasUnsavedChanges) {
      const timeoutId = setTimeout(() => {
        try {
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(formData));
          setAutoSaveState(prev => ({
            ...prev,
            lastSaved: new Date().toISOString(),
            hasUnsavedChanges: false
          }));
        } catch (error) {
          console.warn('Failed to autosave form data:', error);
        }
      }, AUTOSAVE_INTERVAL);

      return () => clearTimeout(timeoutId);
    }
  }, [formData, autoSaveState.hasUnsavedChanges]);

  // Update field value with validation and processing
  const updateField = useCallback((name: keyof VehicleFormData, value: any) => {
    let processedValue = value;

    // Process specific field types
    switch (name) {
      case 'year':
      case 'doors':
      case 'seats':
      case 'horsepower':
      case 'torque':
      case 'weight_lbs':
      case 'length_inches':
      case 'width_inches':
      case 'height_inches':
      case 'wheelbase_inches':
      case 'fuel_capacity_gallons':
      case 'mpg_city':
      case 'mpg_highway':
      case 'mpg_combined':
      case 'msrp':
      case 'current_value':
      case 'purchase_price':
      case 'asking_price':
      case 'mileage':
      case 'previous_owners':
      case 'condition_rating':
        processedValue = value ? parseInt(value, 10) : undefined;
        if (processedValue !== undefined && isNaN(processedValue)) {
          processedValue = undefined;
        }
        break;

      case 'vin':
        processedValue = value ? value.toString().toUpperCase().trim() : '';
        break;

      case 'license_plate':
        processedValue = value ? value.toString().toUpperCase().trim() : '';
        break;

      case 'make':
      case 'model':
        processedValue = value ? value.toString().trim() : '';
        break;
    }

    setFormData(prev => {
      const newData = { ...prev, [name]: processedValue };

      // Update verification progress
      setVerificationProgress(calculateVerificationProgress(newData));

      return newData;
    });

    // Mark as having unsaved changes
    setAutoSaveState(prev => ({ ...prev, hasUnsavedChanges: true }));
    setError(null);
  }, []);

  // Update multiple fields at once
  const updateFormData = useCallback((data: Partial<VehicleFormData>) => {
    setFormData(prev => {
      const newData = { ...prev, ...data };
      setVerificationProgress(calculateVerificationProgress(newData));
      return newData;
    });

    setAutoSaveState(prev => ({ ...prev, hasUnsavedChanges: true }));
    setError(null);
  }, []);

  // Reset form to default state
  const resetForm = useCallback(() => {
    setFormData(DEFAULT_FORM_DATA);
    setVerificationProgress(calculateVerificationProgress(DEFAULT_FORM_DATA));
    setAutoSaveState({ lastSaved: '', hasUnsavedChanges: false });
    setError(null);
    localStorage.removeItem(AUTOSAVE_KEY);
  }, []);

  // Clear autosave data and reset form
  const clearAutosave = useCallback(() => {
    localStorage.removeItem(AUTOSAVE_KEY);
    setFormData(DEFAULT_FORM_DATA);
    setVerificationProgress(calculateVerificationProgress(DEFAULT_FORM_DATA));
    setAutoSaveState({ lastSaved: '', hasUnsavedChanges: false });
    setError(null);
  }, []);

  // Validate required fields
  const validateForm = useCallback((): boolean => {
    const errors = getRequiredFieldErrors();
    if (errors.length > 0) {
      setError(`Required fields missing: ${errors.join(', ')}`);
      return false;
    }
    setError(null);
    return true;
  }, [formData]);

  // Get list of required field validation errors
  const getRequiredFieldErrors = useCallback((): string[] => {
    const errors: string[] = [];

    if (!formData.make?.trim()) errors.push('Make');
    if (!formData.model?.trim()) errors.push('Model');

    return errors;
  }, [formData]);

  return {
    // State
    formData,
    verificationProgress,
    autoSaveState,
    error,

    // Actions
    updateField,
    updateFormData,
    resetForm,
    clearAutosave,

    // Validation
    validateForm,
    getRequiredFieldErrors
  };
}

export default useVehicleForm;