import { useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useToast } from '@/components/ui/use-toast';
import { FormState } from '../types';
import { calculateTotalCost } from '../utils/calculations';
import { PostgrestError } from '@supabase/supabase-js';
import { useAuth } from '@/providers/AuthProvider';
import { useUserStore } from '@/stores/userStore';

interface ServiceRecord {
  id: string;
  vehicleId: string;
  serviceDate: string;
  description: string;
  serviceType: string;
  cost: number;
  parts: Array<{
    id: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  metadata: Record<string, unknown>;
}

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
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
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
      const { data: result, error: dbError } = await supabase
        .from('service_records')
        .insert(serviceRecord)
        .select()
        .single();

      if (dbError) {
        throw dbError;
      }

      toast({
        title: 'Service Record Created',
        description: 'Your service record has been saved successfully.',
      });

      onSuccess();
      onClose();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to save service record');
      console.error('Error saving service record:', error);
      setSubmitError(error.message);
      toast({
        title: 'Error',
        description: error.message,
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
