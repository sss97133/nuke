
import { z } from 'zod';

export interface VehicleFormValues {
  make: string;
  model: string;
  year: number;
  color?: string;
  vin?: string;
  mileage?: number;
  trim?: string;
  image?: string;
  tags?: string; // Keep as string for form input, will be processed to array later
  notes?: string;
  price?: number;
  market_value?: number;
  location?: string;
  condition_rating?: number;
  vehicle_type?: string;
  body_type?: string;
  transmission?: string;
  drivetrain?: string;
  rarity_score?: number;
  era?: string;
  restoration_status?: "original" | "restored" | "modified" | "project";
  special_edition?: boolean;
  // New classification fields
  body_style?: string;
  fuel_type?: string;
  engine_type?: string;
  number_of_doors?: number;
  number_of_seats?: number;
  weight?: number;
  top_speed?: number;
}

// Form validation schema
export const formSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.coerce.number().min(1900).max(new Date().getFullYear() + 1),
  color: z.string().optional(),
  vin: z.string().optional(),
  mileage: z.coerce.number().optional(),
  trim: z.string().optional(),
  image: z.string().optional(),
  tags: z.string().optional(),
  notes: z.string().optional(),
  price: z.coerce.number().optional(),
  market_value: z.coerce.number().optional(),
  location: z.string().optional(),
  condition_rating: z.coerce.number().optional(),
  vehicle_type: z.string().optional(),
  body_type: z.string().optional(),
  transmission: z.string().optional(),
  drivetrain: z.string().optional(),
  rarity_score: z.coerce.number().optional(),
  era: z.string().optional(),
  restoration_status: z.enum(["original", "restored", "modified", "project"]).optional(),
  special_edition: z.boolean().optional(),
  // New classification fields validation
  body_style: z.string().optional(),
  fuel_type: z.string().optional(),
  engine_type: z.string().optional(),
  number_of_doors: z.coerce.number().optional(),
  number_of_seats: z.coerce.number().optional(),
  weight: z.coerce.number().optional(),
  top_speed: z.coerce.number().optional(),
});

