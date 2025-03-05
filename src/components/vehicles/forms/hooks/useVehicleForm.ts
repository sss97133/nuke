
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { VehicleFormValues, formSchema } from '../types';

export const useVehicleForm = (initialValues: Partial<VehicleFormValues> = {}) => {
  // Create defaultValues with required fields guaranteed to be non-optional
  const defaultValues: VehicleFormValues = {
    make: initialValues.make || '',
    model: initialValues.model || '',
    year: initialValues.year || new Date().getFullYear(),
    color: initialValues.color || '',
    vin: initialValues.vin || '',
    mileage: initialValues.mileage,
    trim: initialValues.trim || '',
    image: initialValues.image || '',
    tags: initialValues.tags || '',
    notes: initialValues.notes || '',
  };

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  return form;
};
