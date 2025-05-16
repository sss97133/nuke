import { useState, useCallback } from 'react';
import { useForm, SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { vehicleFormSchema, VehicleFormValues } from '../schema';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface FormErrors {
  [key: string]: {
    message: string;
    type: string;
  };
}

interface UseVehicleFormProps {
  defaultValues?: Partial<VehicleFormValues>;
  onSubmitSuccess?: (data: VehicleFormValues) => void;
  onSubmitError?: (errors: FormErrors) => void;
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
  const { toast } = useToast();
  
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
      
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      // Process the form data
      const vehicleData = {
        ...data,
        user_id: user.id,
        // Convert string values to appropriate types
        year: Number(data.year),
        mileage: data.mileage ? Number(data.mileage) : null,
        purchase_price: data.purchase_price ? parseFloat(data.purchase_price.replace(/[^0-9.-]+/g, '')) : null,
        // Format dates
        purchase_date: data.purchase_date ? new Date(data.purchase_date).toISOString() : null,
        discovery_date: data.discovery_date ? new Date(data.discovery_date).toISOString() : null,
        // Handle tags if it's a string
        tags: typeof data.tags === 'string' ? data.tags.split(',').map(tag => tag.trim()) : data.tags,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Insert into Supabase
      const { data: vehicle, error: insertError } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      // Handle image uploads if present
      if (data.image) {
        const images = Array.isArray(data.image) ? data.image : [data.image];
        
        for (let i = 0; i < images.length; i++) {
          const imageUrl = images[i];
          
          if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
            try {
              // Convert data URL to file
              const res = await fetch(imageUrl);
              const blob = await res.blob();
              const file = new File([blob], `vehicle-${vehicle.id}-${i}.jpg`, { type: 'image/jpeg' });
              
              // Upload to Supabase storage
              const { data: uploadData, error: uploadError } = await supabase.storage
                .from('vehicle-images')
                .upload(`${vehicle.id}/${file.name}`, file);
              
              if (uploadError) {
                console.error('Error uploading image:', uploadError);
                continue;
              }
              
              // Create record in vehicle_images table
              const { error: imageInsertError } = await supabase
                .from('vehicle_images')
                .insert([{
                  vehicle_id: vehicle.id,
                  url: uploadData?.path,
                  is_primary: i === 0,
                  created_at: new Date().toISOString()
                }]);
              
              if (imageInsertError) {
                console.error('Error creating image record:', imageInsertError);
              }
            } catch (err) {
              console.error('Error processing image:', err);
            }
          }
        }
      }

      toast({
        title: "Success",
        description: "Vehicle saved successfully",
      });
      
      // Call the user's success handler if provided
      if (onSubmitSuccess) {
        await onSubmitSuccess(data);
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setSubmitError(errorMessage);
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      
      // Call the user's error handler if provided
      if (onSubmitError) {
        onSubmitError({});
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [onSubmitSuccess, onSubmitError, toast]);
  
  // Handle form validation errors
  const onSubmitErrorHandler: SubmitErrorHandler<VehicleFormValues> = useCallback((errors) => {
    console.error('Form validation errors:', errors);
    
    // Extract first error message to display to user
    const firstError = Object.values(errors)[0];
    const errorMessage = firstError?.message?.toString() || 'Please correct the errors in the form';
    setSubmitError(errorMessage);
    
    toast({
      title: "Validation Error",
      description: errorMessage,
      variant: "destructive",
    });
    
    // Call the user's error handler if provided
    if (onSubmitError) {
      onSubmitError({});
    }
  }, [onSubmitError, toast]);
  
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
