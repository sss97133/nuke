import { useForm } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// Create a Zod schema for validation
const vehicleFormSchema = z.object({
  // Basic Information (required)
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.union([z.string(), z.number()]).refine(val => {
    const year = Number(val);
    return !isNaN(year) && year >= 1885 && year <= new Date().getFullYear() + 1;
  }, "Year must be valid"),
  
  // Ownership Status
  ownership_status: z.enum(['owned', 'claimed', 'discovered']),
  ownership_documents: z.any().optional(),
  
  // Optional fields
  vin: z.string().optional(),
  license_plate: z.string().optional(),
  purchase_date: z.string().optional(),
  purchase_price: z.string().optional(),
  purchase_location: z.string().optional(),
  claim_justification: z.string().optional(),
  discovery_date: z.string().optional(),
  discovery_location: z.string().optional(),
  discovery_notes: z.string().optional(),
  color: z.string().optional(),
  trim: z.string().optional(),
  body_style: z.string().optional(),
  transmission: z.string().optional(),
  engine: z.string().optional(),
  fuel_type: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional(),
  condition: z.string().optional(),
  category: z.string().optional(),
  rarity: z.string().optional(),
  significance: z.string().optional(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  tags: z.string().optional(),
  private_notes: z.string().optional(),
  public_notes: z.string().optional(),
});

export const useVehicleForm = (onSubmit: (data: VehicleFormValues) => Promise<void>) => {
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
    }
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    await onSubmit(data);
  });

  return {
    form,
    handleSubmit,
  };
};
