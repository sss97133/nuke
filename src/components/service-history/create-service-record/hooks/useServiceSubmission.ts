
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { FormState } from '../types';
import { calculateTotalCost } from '../utils/calculations';

export const useServiceSubmission = (
  formState: FormState,
  onClose: () => void,
  onSuccess: () => void
) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
        total_cost: calculateTotalCost(formState),
        created_at: new Date().toISOString()
      };

      // Use type assertion to tell TypeScript this is a valid table
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
    isSubmitting,
    submitError,
    handleSubmit
  };
};
