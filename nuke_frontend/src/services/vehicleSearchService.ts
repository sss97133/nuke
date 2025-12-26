import { supabase } from '../lib/supabase';

export interface SearchFilters {
  yearFrom?: number;
  yearTo?: number;
  make?: string;
  model?: string;
  priceFrom?: number;
  priceTo?: number;
  zipCode?: string;
  radius?: number;
  forSale?: boolean;
  textSearch?: string;
}

export interface VehicleSearchResult {
  id: string;
  year: number;
  make: string;
  model: string;
  normalized_model?: string | null; // Canonical model name (e.g., "C10" instead of "Truck")
  generation?: string | null;       // e.g., "Squarebody", "OBS"
  vin: string | null;
  color: string | null;
  mileage: number | null;
  current_value: number | null;
  asking_price: number | null;
  sale_price: number | null;
  purchase_price?: number | null;
  msrp?: number | null;
  winning_bid?: number | null;
  high_bid?: number | null;
  current_bid?: number | null;
  is_for_sale: boolean;
  zip_code: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  is_public: boolean;
  source?: string;
  distance?: number;
  is_daily_driver?: boolean;
  is_weekend_car?: boolean;
  is_track_car?: boolean;
  is_show_car?: boolean;
  is_project_car?: boolean;
  purchase_price?: number | null;
  profiles?: {
    username: string | null;
    full_name: string | null;
  };
}

export class VehicleSearchService {
  static async searchVehicles(filters: SearchFilters): Promise<VehicleSearchResult[]> {
    try {
      // Note: Avoid PostgREST relationship join syntax (profiles:user_id)
      // because the remote schema may not have the FK cached. We fetch
      // vehicles first and then hydrate profile info in a separate query.
      let query = supabase
        .from('vehicles')
        .select('*')
        .eq('is_public', true)
        .neq('status', 'pending');

      // Apply filters
      if (filters.yearFrom) {
        query = query.gte('year', filters.yearFrom);
      }
      if (filters.yearTo) {
        query = query.lte('year', filters.yearTo);
      }
      if (filters.make) {
        query = query.ilike('make', filters.make);
      }
      if (filters.model) {
        query = query.ilike('model', filters.model);
      }
      if (filters.priceFrom) {
        query = query.gte('asking_price', filters.priceFrom * 100); // Convert to cents
      }
      if (filters.priceTo) {
        query = query.lte('asking_price', filters.priceTo * 100); // Convert to cents
      }
      if (filters.forSale) {
        query = query.eq('is_for_sale', true);
      }
      if (filters.zipCode) {
        query = query.eq('zip_code', filters.zipCode);
      }

      // Text search across multiple fields
      if (filters.textSearch) {
        const searchTerm = filters.textSearch.toLowerCase();
        query = query.or(`
          year::text.ilike.%${searchTerm}%,
          make.ilike.%${searchTerm}%,
          model.ilike.%${searchTerm}%,
          vin.ilike.%${searchTerm}%,
          color.ilike.%${searchTerm}%
        `);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Search error:', error);
        throw error;
      }

      let results = (data || []) as VehicleSearchResult[];

      // Hydrate profile info (username, full_name) without relying on FK joins
      try {
        const userIds = Array.from(
          new Set(results.map((v: any) => v.user_id).filter(Boolean))
        );
        if (userIds.length > 0) {
          const { data: profilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('id, username, full_name')
            .in('id', userIds);

          if (!profilesError && profilesData) {
            const profileMap = new Map(
              profilesData.map((p: any) => [p.id, { username: p.username ?? null, full_name: p.full_name ?? null }])
            );
            results = results.map((v: any) => ({
              ...v,
              profiles: v.user_id ? profileMap.get(v.user_id) ?? undefined : undefined,
            }));
          }
        }
      } catch (e) {
        console.warn('Non-fatal: failed to hydrate profiles for vehicles', e);
      }

      // Handle location-based filtering with radius
      if (filters.zipCode && filters.radius) {
        results = await this.filterByDistance(results, filters.zipCode, filters.radius);
      }

      return results;
    } catch (error) {
      console.error('Error in searchVehicles:', error);
      throw error;
    }
  }

  static async filterByDistance(
    vehicles: VehicleSearchResult[], 
    zipCode: string, 
    radiusMiles: number
  ): Promise<VehicleSearchResult[]> {
    try {
      // Get coordinates for the search zip code
      const searchCoords = await this.getZipCodeCoordinates(zipCode);
      if (!searchCoords) {
        return vehicles; // Return all if we can't get coordinates
      }

      // Filter vehicles by distance
      const filteredVehicles: VehicleSearchResult[] = [];
      
      for (const vehicle of vehicles) {
        if (vehicle.latitude && vehicle.longitude) {
          const distance = this.calculateDistance(
            searchCoords.latitude,
            searchCoords.longitude,
            vehicle.latitude,
            vehicle.longitude
          );
          
          if (distance <= radiusMiles) {
            filteredVehicles.push({
              ...vehicle,
              distance: Math.round(distance)
            });
          }
        }
      }

      // Sort by distance
      return filteredVehicles.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    } catch (error) {
      console.error('Error filtering by distance:', error);
      return vehicles; // Return original results on error
    }
  }

  static async getZipCodeCoordinates(zipCode: string): Promise<{latitude: number, longitude: number} | null> {
    try {
      // First try to find coordinates from existing vehicles
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('latitude, longitude')
        .eq('zip_code', zipCode)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(1)
        .single();

      if (existingVehicle) {
        return {
          latitude: existingVehicle.latitude,
          longitude: existingVehicle.longitude
        };
      }

      // If no existing coordinates, use a geocoding service
      // For now, return null - in production you'd integrate with Google Maps API or similar
      console.log(`No coordinates found for zip code: ${zipCode}`);
      return null;
    } catch (error) {
      console.error('Error getting zip code coordinates:', error);
      return null;
    }
  }

  static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  static toRadians(degrees: number): number {
    return degrees * (Math.PI/180);
  }

  static async getSearchSuggestions(): Promise<{
    years: number[];
    makes: string[];
    models: { [make: string]: string[] };
  }> {
    try {
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('year, make, model')
        .eq('is_public', true)
        .not('make', 'is', null)
        .not('model', 'is', null);

      if (error) {
        console.error('Error loading suggestions:', error);
        return { years: [], makes: [], models: {} };
      }

      if (!vehicles) return { years: [], makes: [], models: {} };

      const years = [...new Set(vehicles.map(v => v.year))].sort((a, b) => b - a);
      const makes = [...new Set(vehicles.map(v => v.make))].sort();
      
      const models: { [make: string]: string[] } = {};
      vehicles.forEach(vehicle => {
        if (!models[vehicle.make]) {
          models[vehicle.make] = [];
        }
        if (!models[vehicle.make].includes(vehicle.model)) {
          models[vehicle.make].push(vehicle.model);
        }
      });

      Object.keys(models).forEach(make => {
        models[make].sort();
      });

      return { years, makes, models };
    } catch (error) {
      console.error('Error in getSearchSuggestions:', error);
      return { years: [], makes: [], models: {} };
    }
  }

  static formatPrice(cents: number | null): string {
    if (!cents) return 'Price not listed';
    return `$${(cents / 100).toLocaleString()}`;
  }

  static formatDistance(miles: number | null): string {
    if (!miles) return '';
    return `${miles} miles away`;
  }
}
