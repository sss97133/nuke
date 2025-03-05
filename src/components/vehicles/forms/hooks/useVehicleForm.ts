
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
    body_style: initialValues.body_style || '',
    fuel_type: initialValues.fuel_type || '',
    transmission: initialValues.transmission || '',
    drivetrain: initialValues.drivetrain || '',
    engine_type: initialValues.engine_type || '',
    number_of_doors: initialValues.number_of_doors,
    number_of_seats: initialValues.number_of_seats,
    weight: initialValues.weight,
    top_speed: initialValues.top_speed,
  };

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  return form;
};
