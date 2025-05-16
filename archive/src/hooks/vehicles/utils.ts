import { Database } from '@/types/supabase';
import { Vehicle } from '@/components/vehicles/discovery/types';

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
  const metadata = dbVehicle.metadata as {
    mileage?: number;
    image_url?: string;
    location?: string;
    condition_rating?: number;
    vehicle_type?: string;
    price?: number;
    market_value?: number;
    price_trend?: 'up' | 'down' | 'stable';
    tags?: string[];
    body_type?: string;
    engine_type?: string;
    transmission?: string;
    drivetrain?: string;
    condition_description?: string;
    restoration_status?: 'original' | 'restored' | 'modified' | 'project';
    notable_issues?: string[];
    ownership_count?: number;
    accident_history?: boolean;
    service_history?: boolean;
    last_service_date?: string;
    special_edition?: boolean;
    rarity_score?: number;
    market_trends?: {
      price_history: number[];
      similar_sales: number[];
      parts_availability: 'high' | 'medium' | 'low';
    };
    relevance_score?: number;
    views_count?: number;
    saves_count?: number;
    interested_users?: string[];
    source?: string;
    source_url?: string;
  };
  
  return {
    id: Number(dbVehicle.id),
    make: dbVehicle.make,
    model: dbVehicle.model,
    year: dbVehicle.year,
    mileage: metadata?.mileage || 0,
    image: metadata?.image_url || '',
    location: metadata?.location || '',
    added: dbVehicle.created_at,
    condition_rating: metadata?.condition_rating || 5,
    vehicle_type: metadata?.vehicle_type || 'car',
    price: metadata?.price,
    market_value: metadata?.market_value,
    price_trend: metadata?.price_trend as 'up' | 'down' | 'stable',
    tags: metadata?.tags as string[],
    body_type: metadata?.body_type || '',
    engine_type: metadata?.engine_type || '',
    transmission: metadata?.transmission || '',
    drivetrain: metadata?.drivetrain || '',
    condition_description: metadata?.condition_description || '',
    restoration_status: metadata?.restoration_status as 'original' | 'restored' | 'modified' | 'project',
    notable_issues: metadata?.notable_issues as string[],
    ownership_count: metadata?.ownership_count || 0,
    accident_history: metadata?.accident_history || false,
    service_history: metadata?.service_history || false,
    last_service_date: metadata?.last_service_date,
    era: determineEra(dbVehicle.year),
    special_edition: metadata?.special_edition || false,
    rarity_score: metadata?.rarity_score || 0,
    market_trends: metadata?.market_trends,
    relevance_score: metadata?.relevance_score,
    views_count: metadata?.views_count,
    saves_count: metadata?.saves_count,
    interested_users: metadata?.interested_users,
    status: (dbVehicle.status || 'discovered') as 'owned' | 'claimed' | 'discovered' | 'verified' | 'unverified',
    source: metadata?.source || 'database',
    source_url: metadata?.source_url || ''
  } as Vehicle;
}

// Helper to determine the "era" based on year
const determineEra = (year: number): string => {
  if (!year) return '';
  
  if (year < 1920) return 'pre-war';
  if (year < 1930) return '20s';
  if (year < 1940) return '30s';
  if (year < 1950) return '40s';
  if (year < 1960) return '50s';
  if (year < 1970) return '60s';
  if (year < 1980) return '70s';
  if (year < 1990) return '80s';
  if (year < 2000) return '90s';
  if (year < 2010) return '00s';
  if (year < 2020) return '10s';
  
  return 'modern';
};

// Feature flags for gradual migration
export const USE_REAL_DATA = {
  vehicles: true
};
