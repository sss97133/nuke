
import { supabase } from '@/integrations/supabase/client';

export interface CarImportData {
  id?: string;
  make: string;
  model: string;
  year: number | string;
  color?: string;
  purchase_date?: string;
  purchase_price?: number | string;
  current_value?: number | string;
  mileage?: number | string;
  condition?: string;
  location?: string;
  vin?: string; // Changed to optional string (not nullable)
  license_plate?: string;
  insurance_policy?: string;
  notes?: string;
  icloud_album_link?: string;
  icloud_folder_id?: string;
}

export interface CarImageData {
  car_id: string;
  file_path: string;
  public_url?: string;
  file_name: string;
  is_primary?: boolean;
  image_type?: string;
  source: 'supabase' | 'icloud';
}

export type SupabaseClient = typeof supabase;

// Updated type definitions to better support null/undefined handling
export interface VehicleBase {
  make: string;
  model: string;
  year: number;
  vin?: string; // Optional string, not nullable
  notes?: string;
  description?: string;
  image_url?: string;
  rarity_score?: number;
}

export interface VehicleWithId extends VehicleBase {
  id: string;
  status?: 'active' | 'inactive' | 'maintenance' | 'sold';
  mileage?: number;
}

// Type guard to check if a database object has a valid VIN
export function hasValidVin(obj: any): obj is { vin: string } {
  return obj && typeof obj.vin === 'string' && obj.vin.length > 0;
}

// Helper function to convert nullable fields to undefined
export function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

// Helper to transform database vehicle to our internal type
export function mapDbToVehicle(dbVehicle: any): VehicleWithId {
  if (!dbVehicle) {
    throw new Error("Cannot adapt undefined or null vehicle data");
  }
  
  return {
    id: dbVehicle.id,
    make: dbVehicle.make || '',
    model: dbVehicle.model || '',
    year: dbVehicle.year || 0,
    vin: nullToUndefined(dbVehicle.vin),
    notes: nullToUndefined(dbVehicle.notes),
    description: nullToUndefined(dbVehicle.description || dbVehicle.condition_description),
    status: nullToUndefined(dbVehicle.status) as VehicleWithId['status'],
    mileage: typeof dbVehicle.mileage === 'number' ? dbVehicle.mileage : undefined,
    image_url: nullToUndefined(dbVehicle.image_url),
    rarity_score: typeof dbVehicle.rarity_score === 'number' ? dbVehicle.rarity_score : undefined
  };
}
