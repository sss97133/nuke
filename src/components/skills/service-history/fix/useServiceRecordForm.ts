
// This is a fix for the build error in service-history useServiceRecordForm.ts
// The issue is that supabase.from('service_records').insert is being called with an object instead of an array

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface FormData {
  vehicleId: string;
  serviceDate: string;
  description: string;
  priority: string;
  laborHours: number;
  technician: string;
  serviceType: string;
  completionDate: string | null;
  diagnosticResults: string;
  partsUsed: any[];
  status: string;
  cost: number;
}

export const useServiceRecordForm = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    vehicleId: '',
    serviceDate: new Date().toISOString().split('T')[0],
    description: '',
    priority: 'medium',
    laborHours: 1,
    technician: '',
    serviceType: 'maintenance',
    completionDate: null,
    diagnosticResults: '',
    partsUsed: [],
    status: 'pending',
    cost: 0
  });

  const handleFormChange = (
    field: keyof FormData,
    value: string | number | null | any[]
  ) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const navigateToStep = (step: number) => {
    setCurrentStep(step);
  };

  const calculateTotalCost = () => {
    const partsCost = formData.partsUsed.reduce(
      (total, part) => total + (part.price * part.quantity),
      0
    );
    const laborCost = formData.laborHours * 75; // Assuming $75/hour labor rate
    return partsCost + laborCost;
  };

  const saveServiceRecord = async () => {
    setIsLoading(true);
    try {
      // Calculate total cost
      const totalCost = calculateTotalCost();

      // Get user ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Prepare the record object
      const serviceRecord = {
        vehicle_id: formData.vehicleId,
        technician_id: user.id,
        service_date: formData.serviceDate,
        completion_date: formData.completionDate,
        description: formData.description,
        diagnostic_results: formData.diagnosticResults,
        service_type: formData.serviceType,
        priority: formData.priority,
        status: formData.status,
        labor_hours: formData.laborHours,
        parts_used: formData.partsUsed,
        total_cost: totalCost,
        created_at: new Date().toISOString()
      };

      // FIX: Insert serviceRecord as an array with one element
      const { error } = await supabase
        .from('service_records')
        .insert([serviceRecord]);

      if (error) throw error;

      toast({
        title: 'Service Record Created',
        description: 'Your service record has been saved successfully.',
      });

      return true;
    } catch (error: any) {
      console.error('Error saving service record:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save service record',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    formData,
    isLoading,
    currentStep,
    handleFormChange,
    navigateToStep,
    saveServiceRecord,
    calculateTotalCost
  };
};
