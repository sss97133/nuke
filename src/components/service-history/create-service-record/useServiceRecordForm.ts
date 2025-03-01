
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PartItem } from '../types';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

interface ServiceRecordFormState {
  vehicleId: string;
  description: string;
  serviceType: string;
  status: string;
  technicianNotes: string;
  laborHours?: number;
  parts: PartItem[];
}

export function useServiceRecordForm() {
  const [formState, setFormState] = useState<ServiceRecordFormState>({
    vehicleId: '',
    description: '',
    serviceType: 'routine_maintenance',
    status: 'pending',
    technicianNotes: '',
    laborHours: undefined,
    parts: []
  });

  const [newPart, setNewPart] = useState<PartItem>({ 
    name: '', 
    quantity: 1, 
    cost: 0 
  });

  const resetForm = useCallback(() => {
    setFormState({
      vehicleId: '',
      description: '',
      serviceType: 'routine_maintenance',
      status: 'pending',
      technicianNotes: '',
      laborHours: undefined,
      parts: []
    });
    setNewPart({ name: '', quantity: 1, cost: 0 });
  }, []);

  // Form field updaters
  const updateVehicle = (id: string) => {
    setFormState(prev => ({ ...prev, vehicleId: id }));
  };

  const updateDescription = (description: string) => {
    setFormState(prev => ({ ...prev, description }));
  };

  const updateServiceType = (serviceType: string) => {
    setFormState(prev => ({ ...prev, serviceType }));
  };

  const updateStatus = (status: string) => {
    setFormState(prev => ({ ...prev, status }));
  };

  const updateTechnicianNotes = (technicianNotes: string) => {
    setFormState(prev => ({ ...prev, technicianNotes }));
  };

  const updateLaborHours = (hours: number | undefined) => {
    setFormState(prev => ({ ...prev, laborHours: hours }));
  };

  // Parts management
  const addPart = () => {
    if (newPart.name.trim() === '') return;
    
    setFormState(prev => ({
      ...prev,
      parts: [...prev.parts, { ...newPart }]
    }));
    setNewPart({ name: '', quantity: 1, cost: 0 });
  };

  const removePart = (index: number) => {
    setFormState(prev => ({
      ...prev,
      parts: prev.parts.filter((_, i) => i !== index)
    }));
  };

  const updateNewPart = (part: Partial<PartItem>) => {
    setNewPart(prev => ({ ...prev, ...part }));
  };

  // Form validation
  const validateForm = (): string | null => {
    if (!formState.description) {
      return 'Description is required';
    }
    
    if (!formState.vehicleId) {
      return 'Please select a vehicle';
    }
    
    return null;
  };

  // Fetch vehicles
  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year')
        .order('make');
        
      if (error) throw error;
      return data as Vehicle[];
    }
  });

  return {
    formState,
    resetForm,
    updateVehicle,
    updateDescription,
    updateServiceType,
    updateStatus,
    updateTechnicianNotes,
    updateLaborHours,
    addPart,
    removePart,
    updateNewPart,
    newPart,
    vehicles,
    validateForm
  };
}
