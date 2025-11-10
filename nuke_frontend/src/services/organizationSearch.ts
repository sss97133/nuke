/**
 * Organization Search Service
 * Full-text search across organizations with keyword matching
 */

import { supabase } from '../lib/supabase';

export interface OrganizationSearchResult {
  id: string;
  business_name: string;
  business_type: string;
  city?: string;
  state?: string;
  specializations: string[];
  services_offered: string[];
  logo_url?: string;
  total_vehicles: number;
  total_images: number;
  relevance_score?: number;
}

export class OrganizationSearchService {
  
  /**
   * Search organizations by keyword
   * Uses full-text search + keyword array matching
   */
  static async search(query: string, limit: number = 20): Promise<OrganizationSearchResult[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchTerm = query.toLowerCase().trim();
    const tsQuery = searchTerm.split(' ').join(' & '); // AND operator for multi-word

    try {
      // Use full-text search with ts_rank for relevance scoring
      const { data, error } = await supabase
        .from('businesses')
        .select(`
          id,
          business_name,
          business_type,
          city,
          state,
          specializations,
          services_offered,
          logo_url,
          total_vehicles,
          total_images,
          search_vector,
          search_keywords
        `)
        .or(`search_vector.fts(english).${tsQuery},search_keywords.cs.{${searchTerm}}`)
        .eq('is_public', true)
        .order('total_vehicles', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Search error:', error);
        return [];
      }

      // Map results
      const results: OrganizationSearchResult[] = (data || []).map((org: any) => ({
        id: org.id,
        business_name: org.business_name,
        business_type: org.business_type,
        city: org.city,
        state: org.state,
        specializations: org.specializations || [],
        services_offered: org.services_offered || [],
        logo_url: org.logo_url,
        total_vehicles: org.total_vehicles || 0,
        total_images: org.total_images || 0
      }));

      return results;
    } catch (error) {
      console.error('Organization search failed:', error);
      return [];
    }
  }

  /**
   * Get suggested searches based on common keywords
   */
  static getSuggestedSearches(): string[] {
    return [
      'paint',
      'upholstery',
      'restoration',
      'fabrication',
      'welding',
      'bodywork',
      'mechanical',
      'performance',
      'suspension',
      'engine',
      'transmission',
      'electrical',
      'detailing',
      'custom',
      'classic',
      'vintage'
    ];
  }

  /**
   * Get organizations by specialty
   */
  static async getBySpecialty(specialty: string, limit: number = 10): Promise<OrganizationSearchResult[]> {
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .contains('specializations', [specialty.toLowerCase()])
        .eq('is_public', true)
        .order('total_vehicles', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map((org: any) => ({
        id: org.id,
        business_name: org.business_name,
        business_type: org.business_type,
        city: org.city,
        state: org.state,
        specializations: org.specializations || [],
        services_offered: org.services_offered || [],
        logo_url: org.logo_url,
        total_vehicles: org.total_vehicles || 0,
        total_images: org.total_images || 0
      }));
    } catch (error) {
      console.error('Error fetching by specialty:', error);
      return [];
    }
  }

  /**
   * Get organizations by location
   */
  static async searchByLocation(
    city?: string,
    state?: string,
    limit: number = 20
  ): Promise<OrganizationSearchResult[]> {
    try {
      let query = supabase
        .from('businesses')
        .select('*')
        .eq('is_public', true);

      if (city) {
        query = query.ilike('city', `%${city}%`);
      }

      if (state) {
        query = query.eq('state', state.toUpperCase());
      }

      const { data, error } = await query
        .order('total_vehicles', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map((org: any) => ({
        id: org.id,
        business_name: org.business_name,
        business_type: org.business_type,
        city: org.city,
        state: org.state,
        specializations: org.specializations || [],
        services_offered: org.services_offered || [],
        logo_url: org.logo_url,
        total_vehicles: org.total_vehicles || 0,
        total_images: org.total_images || 0
      }));
    } catch (error) {
      console.error('Error searching by location:', error);
      return [];
    }
  }
}

