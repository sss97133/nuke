import { useState, useCallback } from 'react';
import { useForm, SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { vehicleFormSchema, VehicleFormValues } from '../schema';

interface UseVehicleFormProps {
  defaultValues?: Partial<VehicleFormValues>;
  onSubmitSuccess?: (data: VehicleFormValues) => void;
  onSubmitError?: (errors: any) => void;
}

/**
 * Custom hook to manage vehicle form state, validation, and submission
 * 
 * This hook provides a complete form management solution using react-hook-form
 * with zod validation schema for vehicle information.
 * 
 * @example
 * ```tsx
 * const { form, handleSubmit, isSubmitting, submitError, reset } = useVehicleForm({
 *   onSubmitSuccess: (data) => {
 *     toast.success("Vehicle saved successfully");
 *     router.push('/vehicles');
 *   }
 * });
 * ```
 */
export const useVehicleForm = ({
  defaultValues = {},
  onSubmitSuccess,
  onSubmitError
}: UseVehicleFormProps = {}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  
  // Create the form with default values and validation
  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: {
      make: '',
      model: '',
      year: new Date().getFullYear().toString(),
      ownership_status: 'owned',
      ownership_documents: [],
      vin: '',
      license_plate: '',
      purchase_date: '',
      purchase_price: '',
      purchase_location: '',
      claim_justification: '',
      discovery_date: '',
      discovery_location: '',
      discovery_notes: '',
      color: '',
      trim: '',
      body_style: '',
      transmission: '',
      engine: '',
      fuel_type: '',
      mileage: '',
      condition: '',
      category: '',
      rarity: '',
      significance: '',
      tags: '',
      private_notes: '',
      public_notes: '',
      ...defaultValues
    }
  });
  
  // Handle successful form submission
  const onSubmitSuccessHandler: SubmitHandler<VehicleFormValues> = useCallback(async (data) => {
    try {
      setIsSubmitting(true);
      setSubmitError(null);
      
      // Call the user's success handler if provided
      if (onSubmitSuccess) {
        await onSubmitSuccess(data);
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setSubmitError(error instanceof Error ? error.message : 'Unknown error occurred');
      
      // Call the user's error handler if provided
      if (onSubmitError) {
        onSubmitError(error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [onSubmitSuccess, onSubmitError]);
  
  // Handle form validation errors
  const onSubmitErrorHandler: SubmitErrorHandler<VehicleFormValues> = useCallback((errors) => {
    console.error('Form validation errors:', errors);
    
    // Extract first error message to display to user
    const firstError = Object.values(errors)[0];
    const errorMessage = firstError?.message || 'Please correct the errors in the form';
    setSubmitError(errorMessage as string);
    
    // Call the user's error handler if provided
    if (onSubmitError) {
      onSubmitError(errors);
    }
  }, [onSubmitError]);
  
  // Reset form and state
  const reset = useCallback((values?: Partial<VehicleFormValues>) => {
    form.reset(values);
    setSubmitError(null);
  }, [form]);
  
  // Create a submit handler that captures both success and error paths
  const handleSubmit = useCallback(() => {
    return form.handleSubmit(onSubmitSuccessHandler, onSubmitErrorHandler)();
  }, [form, onSubmitSuccessHandler, onSubmitErrorHandler]);
  
  return {
    form,
    handleSubmit,
    isSubmitting,
    submitError,
    reset,
    formState: form.formState
  };
};
