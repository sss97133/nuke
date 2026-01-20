import { supabase } from '../lib/supabase';

// PostgREST ILIKE uses % and _ wildcards; escape them so user input can't accidentally turn into a wildcard query.
export const escapePostgrestILike = (value: string): string => String(value || '').replace(/([%_\\])/g, '\\$1');

export const normalizeTextSearchInput = (value: string): string =>
  String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/,+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const extractYearFromTextSearch = (value: string): { year: number | null; rest: string } => {
  const normalized = normalizeTextSearchInput(value);
  if (!normalized) return { year: null, rest: '' };

  const match = normalized.match(/\b(19|20)\d{2}\b/);
  if (!match) return { year: null, rest: normalized };

  const year = parseInt(match[0], 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < 1900 || year > currentYear + 1) {
    return { year: null, rest: normalized };
  }

  const rest = normalizeTextSearchInput(normalized.replace(match[0], ' '));
  return { year, rest };
};

export const buildVehicleTextSearchOrFilter = (args: {
  /** Raw user input */
  text: string;
  /** Optional: user ids whose vehicles should match via user_id/uploaded_by */
  matchingUserIds?: string[];
}): string | null => {
  const raw = normalizeTextSearchInput(args.text);
  if (!raw) return null;

  const tokens = raw
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);

  const baseFieldsForToken = (token: string): string[] => {
    const term = escapePostgrestILike(token);
    // NOTE: keep this list conservative; any missing column breaks the query.
    return [
      `make.ilike.%${term}%`,
      `model.ilike.%${term}%`,
      `description.ilike.%${term}%`,
      `notes.ilike.%${term}%`,
      `vin.ilike.%${term}%`,
      `color.ilike.%${term}%`,
    ];
  };

  // If there's only one token, OR across fields (and optionally owner ids).
  if (tokens.length <= 1) {
    const token = tokens[0] || '';
    const partsSet = new Set<string>(baseFieldsForToken(token));

    // Optional: owner/user search (username/full name -> user ids)
    const ids = (args.matchingUserIds || []).map(String).filter(Boolean);
    if (ids.length > 0) {
      const unique = Array.from(new Set(ids));
      const inList = unique.join(',');
      partsSet.add(`user_id.in.(${inList})`);
      partsSet.add(`uploaded_by.in.(${inList})`);
    }

    // PostgREST expects comma-separated conditions; do not include whitespace/newlines.
    return Array.from(partsSet).join(',');
  }

  // Multi-token: AND across tokens, OR across fields within each token.
  // Implemented as a single OR operand that is an `and(...)` expression:
  //   or=(and(or(...token1...),or(...token2...)))
  const tokenGroups = tokens.map((t) => `or(${baseFieldsForToken(t).join(',')})`);
  return `and(${tokenGroups.join(',')})`;
};

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
      // Precompute zip coordinates if needed (used to avoid the broken "zip + radius" logic).
      let zipCoords: { latitude: number; longitude: number } | null = null;
      if (filters.zipCode && filters.radius) {
        zipCoords = await this.getZipCodeCoordinates(filters.zipCode);
      }

      const isMissingListingKindColumn = (err: any) => {
        const code = String((err as any)?.code || '').toUpperCase();
        const message = String(err?.message || '').toLowerCase();
        if (!message.includes('listing_kind')) return false;
        if (code === '42703' || code === 'PGRST204') return true;
        return message.includes('does not exist') || message.includes('schema cache');
      };

      const runQuery = async (includeListingKind: boolean) => {
        let query = supabase
          .from('vehicles')
          .select('*')
          .neq('status', 'pending');
        // Keep non-vehicle items (parts/tools/memorabilia) out of the default vehicle search (when available).
        if (includeListingKind) {
          query = query.eq('listing_kind', 'vehicle');
        }

        // Apply filters
        if (filters.yearFrom) {
          query = query.gte('year', filters.yearFrom);
        }
        if (filters.yearTo) {
          query = query.lte('year', filters.yearTo);
        }
        if (filters.make) {
          const raw = String(filters.make || '').trim();
          if (raw) {
            const term = escapePostgrestILike(raw);
            // Prefer prefix match for make to avoid weird substring collisions (e.g. "Ford" matching "Oxford").
            query = query.ilike('make', `${term}%`);
          }
        }
        if (filters.model) {
          const raw = String(filters.model || '').trim();
          if (raw) {
            const term = escapePostgrestILike(raw);
            // Models are often stored with trims/variants (e.g. "911 Turbo"), so use contains match.
            query = query.ilike('model', `%${term}%`);
          }
        }
        if (filters.priceFrom) {
          // Prices in `vehicles` are stored as DECIMAL(10,2) USD (not cents).
          query = query.gte('asking_price', filters.priceFrom);
        }
        if (filters.priceTo) {
          // Prices in `vehicles` are stored as DECIMAL(10,2) USD (not cents).
          query = query.lte('asking_price', filters.priceTo);
        }
        if (filters.forSale) {
          query = query.eq('is_for_sale', true);
        }
        if (filters.zipCode) {
          // If radius is provided and we have coordinates, do NOT restrict to the exact zip.
          // Otherwise, fallback to exact zip match (best-effort without geocoding).
          if (!filters.radius || !zipCoords) {
            query = query.eq('zip_code', filters.zipCode);
          }
        }

        // Text search across multiple fields
        if (filters.textSearch) {
          const normalized = normalizeTextSearchInput(filters.textSearch);
          const extracted = extractYearFromTextSearch(normalized);

          // If a year exists in the query (e.g. "1998 Ford"), treat it as a hard filter.
          if (extracted.year) {
            query = query.eq('year', extracted.year);
          }

          const raw = extracted.rest || '';
          if (raw) {
            // Optional: map owner search (username/full name) -> user ids
            let matchingUserIds: string[] = [];
            const term = escapePostgrestILike(raw);
            const idSet = new Set<string>();
            // Be resilient across environments where profiles.username may not exist.
            try {
              const { data: byUsername } = await supabase
                .from('profiles')
                .select('id')
                .ilike('username', `%${term}%`)
                .limit(25);
              (byUsername || []).forEach((p: any) => {
                if (p?.id) idSet.add(String(p.id));
              });
            } catch {
              // ignore
            }
            try {
              const { data: byName } = await supabase
                .from('profiles')
                .select('id')
                .ilike('full_name', `%${term}%`)
                .limit(25);
              (byName || []).forEach((p: any) => {
                if (p?.id) idSet.add(String(p.id));
              });
            } catch {
              // ignore
            }
            matchingUserIds = Array.from(idSet);

            const orFilter = buildVehicleTextSearchOrFilter({ text: raw, matchingUserIds });
            if (orFilter) {
              query = query.or(orFilter);
            }
          }
        }

        // Apply a rough bounding box filter for zip+radius searches (fast pre-filter); precise filtering happens later.
        if (filters.zipCode && filters.radius && zipCoords) {
          const radiusMiles = filters.radius;
          const lat = zipCoords.latitude;
          const lng = zipCoords.longitude;
          const latDelta = radiusMiles / 69; // ~69 miles per degree latitude
          const lngDelta = radiusMiles / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
          query = query
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .gte('latitude', lat - latDelta)
            .lte('latitude', lat + latDelta)
            .gte('longitude', lng - lngDelta)
            .lte('longitude', lng + lngDelta);
        }

        return await query.order('created_at', { ascending: false });
      };

      let { data, error } = await runQuery(true);
      if (error && isMissingListingKindColumn(error)) {
        ({ data, error } = await runQuery(false));
      }

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
          const trySelect = async (select: string) =>
            supabase
              .from('profiles')
              .select(select)
              .in('id', userIds);

          // Prefer username if available, but fall back gracefully if the column doesn't exist.
          let profilesData: any[] | null = null;
          let profilesError: any = null;
          ({ data: profilesData, error: profilesError } = await trySelect('id, username, full_name'));
          if (profilesError) {
            ({ data: profilesData, error: profilesError } = await trySelect('id, full_name'));
          }

          if (!profilesError && profilesData) {
            const profileMap = new Map(
              profilesData.map((p: any) => [
                p.id,
                { username: p.username ?? null, full_name: p.full_name ?? null },
              ])
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
        results = await this.filterByDistance(results, filters.zipCode, filters.radius, zipCoords);
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
    radiusMiles: number,
    zipCoords?: { latitude: number; longitude: number } | null
  ): Promise<VehicleSearchResult[]> {
    try {
      // Get coordinates for the search zip code
      const searchCoords = zipCoords ?? (await this.getZipCodeCoordinates(zipCode));
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

  static formatPrice(value: number | string | null): string {
    if (value == null) return 'Price not listed';
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(num) || num <= 0) return 'Price not listed';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(num);
  }

  static formatDistance(miles: number | null): string {
    if (!miles) return '';
    return `${miles} miles away`;
  }
}
