
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PartItem } from '../types';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

interface FormState {
  vehicleId: string;
  serviceDate: string;
  description: string;
  serviceType: string;
  status: string;
  laborHours?: number;
  technicianNotes: string;
  parts: PartItem[];
}

export const useServiceRecordForm = (onClose: () => void, onSuccess: () => void) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  
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

  const [newPart, setNewPart] = useState<PartItem>({
    name: '',
    quantity: 1,
    cost: 0
  });

  // Fetch vehicles
  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, make, model, year');
        
        if (error) throw error;
        setVehicles(data || []);
      } catch (error: any) {
        console.error('Error fetching vehicles:', error);
        toast({
          title: 'Error',
          description: 'Failed to load vehicles. Please try again later.',
          variant: 'destructive',
        });
      } finally {
        setVehiclesLoading(false);
      }
    };

    fetchVehicles();
  }, [toast]);

  const updateFormState = (field: keyof FormState, value: any) => {
    setFormState(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const updateNewPart = (partData: Partial<PartItem>) => {
    setNewPart(prev => ({
      ...prev,
      ...partData
    }));
  };

  const addPart = () => {
    if (!newPart.name.trim()) {
      toast({
        title: 'Missing information',
        description: 'Please enter a part name',
        variant: 'destructive',
      });
      return;
    }

    setFormState(prev => ({
      ...prev,
      parts: [...prev.parts, {...newPart}]
    }));

    // Reset the new part form
    setNewPart({
      name: '',
      quantity: 1,
      cost: 0
    });
  };

  const removePart = (index: number) => {
    setFormState(prev => ({
      ...prev,
      parts: prev.parts.filter((_, i) => i !== index)
    }));
  };

  const calculateTotalCost = () => {
    const partsCost = formState.parts.reduce(
      (total, part) => total + (part.cost * part.quantity),
      0
    );
    const laborCost = (formState.laborHours || 0) * 75; // Assuming $75/hour labor rate
    return partsCost + laborCost;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formState.vehicleId || !formState.description) {
      setSubmitError('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    
    try {
      // Get user ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Prepare the record object
      const serviceRecord = {
        vehicle_id: formState.vehicleId,
        technician_id: user.id,
        service_date: formState.serviceDate,
        description: formState.description,
        service_type: formState.serviceType,
        status: formState.status,
        labor_hours: formState.laborHours,
        technician_notes: formState.technicianNotes,
        parts_used: formState.parts,
        total_cost: calculateTotalCost(),
        created_at: new Date().toISOString()
      };

      // Add type assertion to tell TypeScript this is a valid table
      const { error } = await supabase
        .from('service_records' as any)
        .insert([serviceRecord]);

      if (error) throw error;

      toast({
        title: 'Service Record Created',
        description: 'Your service record has been saved successfully.',
      });

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error saving service record:', error);
      setSubmitError(error.message || 'Failed to save service record');
      toast({
        title: 'Error',
        description: error.message || 'Failed to save service record',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formState,
    updateFormState,
    vehicles,
    newPart,
    updateNewPart,
    addPart,
    removePart,
    isSubmitting,
    submitError,
    handleSubmit,
    vehiclesLoading
  };
};
