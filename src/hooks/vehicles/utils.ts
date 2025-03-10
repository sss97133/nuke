
import { Vehicle } from '../../components/vehicles/discovery/types';

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

// Adapter function to map database fields to component-expected schema
export function adaptVehicleFromDB(dbVehicle: any): Vehicle {
  return {
    id: dbVehicle.id,
    make: dbVehicle.make || '',
    model: dbVehicle.model || '',
    year: dbVehicle.year || 0,
    price: dbVehicle.price || 0,
    market_value: dbVehicle.market_value || dbVehicle.price || 0,
    price_trend: dbVehicle.price_trend || 'stable',
    mileage: dbVehicle.mileage || 0,
    image: dbVehicle.image_url || '/placeholder.png',
    location: dbVehicle.location || '',
    added: dbVehicle.created_at ? getRelativeTimeString(new Date(dbVehicle.created_at)) : '',
    tags: dbVehicle.tags || [],
    condition_rating: dbVehicle.condition_rating || 5,
    vehicle_type: dbVehicle.vehicle_type || '',
    body_type: dbVehicle.body_type || '',
    transmission: dbVehicle.transmission || '',
    drivetrain: dbVehicle.drivetrain || '',
    rarity_score: dbVehicle.rarity_score || 0,
    era: dbVehicle.era || '',
    restoration_status: dbVehicle.restoration_status || 'original',
    special_edition: dbVehicle.special_edition || false,
    status: dbVehicle.status || 'discovered',
    source: dbVehicle.source || '',
    source_url: dbVehicle.source_url || '',
  };
}

// Feature flags for gradual migration
export const USE_REAL_DATA = {
  vehicles: true
};
