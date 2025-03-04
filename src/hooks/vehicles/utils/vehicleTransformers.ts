
import { Vehicle } from '@/components/vehicles/discovery/types';

/**
 * Formats the created date relative to now (e.g., "5 days ago")
 */
export const formatCreatedDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return '1 day ago';
  } else {
    return `${diffDays} days ago`;
  }
};

/**
 * Transform data from Supabase to match our Vehicle type
 */
export const transformVehicleData = (data: any[]): Vehicle[] => {
  if (!data || !Array.isArray(data)) return [];
  
  return data.map(item => ({
    id: parseInt(item.id.toString().replace(/-/g, '').substring(0, 9), 16), // Convert UUID to numeric ID
    make: item.make || '',
    model: item.model || '',
    year: item.year || 0,
    price: typeof item.price === 'string' ? parseFloat(item.price) || 0 : item.price || 0,
    market_value: item.market_value || 0,
    price_trend: item.price_trend as 'up' | 'down' | 'stable' || 'stable',
    mileage: item.mileage || 0,
    image: item.image || '/placeholder.svg',
    location: item.location || 'Unknown',
    added: formatCreatedDate(item.created_at || new Date().toISOString()), // Use created_at instead of added
    tags: item.tags || [],
    condition_rating: item.condition_rating || 5,
    vehicle_type: item.vehicle_type || 'car',
    body_type: item.body_type || '',
    transmission: item.transmission || '',
    drivetrain: item.drivetrain || '',
    rarity_score: item.rarity_score || 0,
    relevance_score: 50 // Default value
  }));
};
