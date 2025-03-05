import { useState, useCallback } from 'react';
import { useForm, SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// Create a more comprehensive Zod schema for validation
const vehicleFormSchema = z.object({
  // Basic Information (required)
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.union([z.string(), z.number()]).refine(val => {
    const year = Number(val);
    const currentYear = new Date().getFullYear();
    
    return !isNaN(year) && year >= 1885 && year <= currentYear + 1;
  }, `Year must be between 1885 and ${new Date().getFullYear() + 1}`),
  
  // Ownership Status
  ownership_status: z.enum(['owned', 'claimed', 'discovered']),
  ownership_documents: z.any().optional(),
  
  // Ownership-specific fields with conditional validation
  purchase_date: z.string().optional()
    .refine(
      (val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 
      "Date must be in YYYY-MM-DD format"
    ),
  purchase_price: z.string().optional()
    .refine(
      (val) => !val || /^[$]?[0-9,]*\.?[0-9]*$/.test(val),
      "Price must be a valid number"
    ),
  purchase_location: z.string().optional(),
  
  // Claimed specific fields with conditional validation
  claim_justification: z.string().optional()
    .refine(
      (val, ctx) => {
        // If status is 'claimed', justification is required and must be at least 20 chars
        if (ctx.path[0] === 'claim_justification' && 
            ctx.parent.ownership_status === 'claimed') {
          return !!(val && val.length >= 20);
        }
        return true;
      },
      "Please provide a detailed justification for your claim (at least 20 characters)"
    ),
  
  // Discovered specific fields with conditional validation
  discovery_date: z.string().optional()
    .refine(
      (val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 
      "Date must be in YYYY-MM-DD format"
    ),
  discovery_location: z.string().optional(),
  discovery_notes: z.string().optional(),
  
  // Optional fields
  vin: z.string().optional()
    .refine(
      (val) => !val || /^[A-HJ-NPR-Z0-9]{17}$/i.test(val),
      "VIN must be 17 characters (excluding I, O, and Q)"
    ),
  license_plate: z.string().optional(),
  color: z.string().optional(),
  trim: z.string().optional(),
  body_style: z.string().optional(),
  transmission: z.string().optional(),
  engine: z.string().optional(),
  fuel_type: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional()
    .refine(
      (val) => {
        if (val === undefined || val === '') return true;
        const num = Number(val);
        return !isNaN(num) && num >= 0;
      },
      "Mileage must be a positive number"
    ),
  condition: z.string().optional(),
  category: z.string().optional(),
  rarity: z.string().optional(),
  significance: z.string().optional(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  tags: z.string().optional(),
  private_notes: z.string().optional(),
  public_notes: z.string().optional(),
}).refine((data) => {
  // Custom cross-field validation
  if (data.ownership_status === 'owned') {
    // If owned, purchase date should be provided
    if (!data.purchase_date) {
      return false;
    }
  }
  if (data.ownership_status === 'discovered') {
    // If discovered, discovery date should be provided
    if (!data.discovery_date) {
      return false;
    }
  }
  return true;
}, {
  message: "Please complete all required fields for the selected ownership status",
  path: ["ownership_status"]
});

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
