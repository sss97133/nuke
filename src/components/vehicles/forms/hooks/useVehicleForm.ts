
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { VehicleFormValues } from '../types';

export const useVehicleForm = (onSubmit: (data: VehicleFormValues) => Promise<void>) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Set up form with react-hook-form
  const form = useForm<VehicleFormValues>({
    defaultValues: {
      make: '',
      model: '',
      year: String(new Date().getFullYear()),
      color: '',
      mileage: '',
      image: [],
      tags: '',
    }
  });
  
  // Process form submission
  const handleSubmit = async (data: VehicleFormValues) => {
    setIsSubmitting(true);
    
    try {
      await onSubmit(data);
      // Optionally reset the form after successful submission
      // form.reset();
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return {
    form,
    isSubmitting,
    handleSubmit: form.handleSubmit(handleSubmit),
  };
};
