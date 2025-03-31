import { useState } from 'react';
import { FormState, FormStateValue, ServiceRecordHookReturn } from './types';
import { useVehiclesData } from './hooks/useVehiclesData';
import { usePartsManagement } from './hooks/usePartsManagement';
import { useServiceSubmission } from './hooks/useServiceSubmission';
import { calculateTotalCost } from './utils/calculations';

export const useServiceRecordForm = (
  onClose: () => void, 
  onSuccess: () => void
): ServiceRecordHookReturn => {
  const [formState, setFormState] = useState<FormState>({
    vehicleId: '',
    serviceDate: new Date().toISOString().split('T')[0],
    description: '',
    serviceType: 'routine_maintenance',
    status: 'pending',
    laborHours: 1,
    technicianNotes: '',
    parts: []
  });

  const updateFormState = (field: keyof FormState, value: FormStateValue) => {
    setFormState(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Use the extracted hooks
  const { vehicles, vehiclesLoading } = useVehiclesData();
  
  const { 
    newPart, 
    updateNewPart, 
    addPart, 
    removePart 
  } = usePartsManagement(formState, updateFormState);
  
  const { 
    isSubmitting, 
    submitError, 
    handleSubmit 
  } = useServiceSubmission(formState, onClose, onSuccess);

  // Calculate total cost
  const calculateTotal = () => calculateTotalCost(formState);

  return {
    formState,
    updateFormState,
    vehicles,
    vehiclesLoading,
    newPart,
    updateNewPart,
    addPart,
    removePart,
    isSubmitting,
    submitError,
    handleSubmit,
    calculateTotalCost: calculateTotal
  };
};
