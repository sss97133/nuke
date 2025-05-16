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
export function hasValidVin(obj: unknown): obj is { vin: string } {
  return obj !== null && typeof obj === 'object' && 'vin' in obj && typeof (obj as { vin: unknown }).vin === 'string' && (obj as { vin: string }).vin.length > 0;
}

// Helper function to convert nullable fields to undefined
export function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

// Helper to transform database vehicle to our internal type
export function mapDbToVehicle(dbVehicle: unknown): VehicleWithId {
  if (!dbVehicle || typeof dbVehicle !== 'object') {
    throw new Error("Cannot adapt undefined or null vehicle data");
  }
  
  const vehicle = dbVehicle as Record<string, unknown>;
  
  return {
    id: String(vehicle.id || ''),
    make: String(vehicle.make || ''),
    model: String(vehicle.model || ''),
    year: Number(vehicle.year || 0),
    vin: nullToUndefined(typeof vehicle.vin === 'string' ? vehicle.vin : null),
    notes: nullToUndefined(typeof vehicle.notes === 'string' ? vehicle.notes : null),
    description: nullToUndefined(
      typeof vehicle.description === 'string' ? vehicle.description :
      typeof vehicle.condition_description === 'string' ? vehicle.condition_description :
      null
    ),
    status: nullToUndefined(
      typeof vehicle.status === 'string' &&
      ['active', 'inactive', 'maintenance', 'sold'].includes(vehicle.status)
        ? vehicle.status as VehicleWithId['status']
        : null
    ),
    mileage: typeof vehicle.mileage === 'number' ? vehicle.mileage : undefined,
    image_url: nullToUndefined(typeof vehicle.image_url === 'string' ? vehicle.image_url : null),
    rarity_score: typeof vehicle.rarity_score === 'number' ? vehicle.rarity_score : undefined
  };
}

export interface VehicleImage {
  id: string;
  url: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface VehicleModification {
  id: string;
  name: string;
  description: string;
  value: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface VehicleOperationResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface VehicleOperationOptions {
  metadata?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface VehicleProcessingResult {
  status: 'success' | 'error' | 'pending';
  message: string;
  data?: Record<string, unknown>;
}

export interface VehicleImportOptions {
  format: 'csv' | 'json' | 'xml';
  validate: boolean;
  metadata?: Record<string, unknown>;
}
