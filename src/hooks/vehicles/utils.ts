import { Database } from '@/types/supabase';
import { Vehicle } from '@/types/vehicle';

type DbVehicle = Database['public']['Tables']['vehicles']['Row'];

// Helper function to convert timestamp to "X days ago" format
export function getRelativeTimeString(date: Date): string {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) return 'today';
  if (diffInDays === 1) return 'yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  return `${Math.floor(diffInDays / 30)} months ago`;
}

// Adapter function to map database fields to component-expected schema with null safety
export function adaptVehicleFromDB(dbVehicle: DbVehicle): Vehicle {
  return {
    id: dbVehicle.id,
    make: dbVehicle.make,
    model: dbVehicle.model,
    year: dbVehicle.year,
    vin: dbVehicle.vin,
    status: dbVehicle.status,
    metadata: dbVehicle.metadata as Vehicle['metadata'],
    created_at: dbVehicle.created_at,
    updated_at: dbVehicle.updated_at,
    user_id: dbVehicle.user_id
  };
}

// Feature flags for gradual migration
export const USE_REAL_DATA = {
  vehicles: true
};
