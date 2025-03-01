
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PartItem } from '../types';

interface FormState {
  vehicleId: string;
  description: string;
  serviceType: string;
  status: string;
  laborHours?: number;
  technicianNotes: string;
  parts: PartItem[];
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

export const useServiceRecordForm = (onClose: () => void, onSuccess: () => void) => {
  const initialFormState: FormState = {
    vehicleId: '',
    description: '',
    serviceType: 'routine_maintenance',
    status: 'pending',
    laborHours: undefined,
    technicianNotes: '',
    parts: []
  };

  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [newPart, setNewPart] = useState<PartItem>({ name: '', quantity: 1, cost: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVehicles = async () => {
      setVehiclesLoading(true);
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, make, model, year')
          .order('year', { ascending: false });
        
        if (error) throw error;
        setVehicles(data || []);
      } catch (err: any) {
        console.error('Error fetching vehicles:', err);
      } finally {
        setVehiclesLoading(false);
      }
    };

    fetchVehicles();
  }, []);

  const updateFormState = (key: keyof FormState, value: any) => {
    setFormState(prev => ({ ...prev, [key]: value }));
  };

  const updateNewPart = (partialPart: Partial<PartItem>) => {
    setNewPart(prev => ({ ...prev, ...partialPart }));
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    
    try {
      // Map our form fields to the database column names and wrap in an array for Supabase
      const { error } = await supabase
        .from('service_tickets')
        .insert([{
          vehicle_id: formState.vehicleId,
          description: formState.description,
          service_type: formState.serviceType,
          status: formState.status,
          labor_hours: formState.laborHours,
          technician_notes: formState.technicianNotes,
          parts_used: formState.parts.length > 0 ? formState.parts : null
        }]);

      if (error) throw error;
      
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error creating service record:', err);
      setSubmitError(err.message || 'Failed to create service record');
    } finally {
      setIsSubmitting(false);
    }
  };

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
    handleSubmit
  };
};
