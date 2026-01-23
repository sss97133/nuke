/**
 * Universal Search Service
 *
 * Connects to the universal-search edge function for rich search results
 * with thumbnails, AI fallback, and multi-entity support
 */

import { supabase } from '../lib/supabase';

export interface UniversalSearchResult {
  id: string;
  type: 'vehicle' | 'organization' | 'user' | 'tag' | 'external_identity' | 'vin_match';
  title: string;
  subtitle?: string;
  description?: string;
  image_url?: string;
  relevance_score: number;
  metadata?: Record<string, any>;
}

export interface UniversalSearchResponse {
  success: boolean;
  results: UniversalSearchResult[];
  query_type: 'vin' | 'url' | 'year' | 'text' | 'empty';
  total_count: number;
  ai_suggestion?: string;
  search_time_ms: number;
}

class UniversalSearchService {
  private cache = new Map<string, { data: UniversalSearchResponse; timestamp: number }>();
  private cacheTimeout = 30000; // 30 seconds

  /**
   * Main search method - calls the edge function
   */
  async search(
    query: string,
    options: {
      limit?: number;
      types?: string[];
      includeAI?: boolean;
    } = {}
  ): Promise<UniversalSearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        success: true,
        results: [],
        query_type: 'empty',
        total_count: 0,
        search_time_ms: 0
      };
    }

    // Check cache
    const cacheKey = `${trimmed}:${options.limit}:${options.types?.join(',')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const { data, error } = await supabase.functions.invoke('universal-search', {
        body: {
          query: trimmed,
          limit: options.limit || 15,
          types: options.types,
          includeAI: options.includeAI ?? true
        }
      });

      if (error) {
        console.error('Universal search error:', error);
        // Fallback to local search
        return this.fallbackLocalSearch(trimmed, options.limit || 15);
      }

      const response = data as UniversalSearchResponse;

      // Cache successful results
      this.cache.set(cacheKey, { data: response, timestamp: Date.now() });

      return response;
    } catch (err) {
      console.error('Universal search failed:', err);
      return this.fallbackLocalSearch(trimmed, options.limit || 15);
    }
  }

  /**
   * Quick autocomplete - optimized for fast typing
   * Uses smaller limit and skips AI
   */
  async autocomplete(query: string): Promise<UniversalSearchResult[]> {
    const response = await this.search(query, {
      limit: 8,
      includeAI: false
    });
    return response.results;
  }

  /**
   * Fallback local search when edge function unavailable
   */
  private async fallbackLocalSearch(
    query: string,
    limit: number
  ): Promise<UniversalSearchResponse> {
    const startTime = Date.now();
    const results: UniversalSearchResult[] = [];
    const searchPattern = `%${query.replace(/([%_\\])/g, '\\$1')}%`;

    // Check if it's a year
    const isYear = /^\d{4}$/.test(query);
    const year = isYear ? parseInt(query) : null;

    try {
      // Search vehicles
      let vehicleQuery = supabase
        .from('vehicles')
        .select('id, year, make, model, vin, sale_price, current_value')
        .eq('is_public', true);

      if (year && year >= 1900 && year <= 2030) {
        vehicleQuery = vehicleQuery.eq('year', year);
      } else {
        vehicleQuery = vehicleQuery.or(`make.ilike.${searchPattern},model.ilike.${searchPattern}`);
      }

      const { data: vehicles } = await vehicleQuery.limit(Math.ceil(limit / 2));

      // Get images for vehicles
      if (vehicles?.length) {
        const vehicleIds = vehicles.map(v => v.id);
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url, is_primary')
          .in('vehicle_id', vehicleIds)
          .order('is_primary', { ascending: false });

        const imageMap = new Map<string, string>();
        for (const img of images || []) {
          if (!imageMap.has(img.vehicle_id)) {
            imageMap.set(img.vehicle_id, img.image_url);
          }
        }

        for (const v of vehicles) {
          const price = v.sale_price || v.current_value;
          results.push({
            id: v.id,
            type: 'vehicle',
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle',
            subtitle: price ? `$${price.toLocaleString()}` : undefined,
            image_url: imageMap.get(v.id),
            relevance_score: 0.8
          });
        }
      }

      // Search organizations
      const { data: orgs } = await supabase
        .from('businesses')
        .select('id, business_name, website, logo_url, profile_image_url')
        .eq('is_public', true)
        .ilike('business_name', searchPattern)
        .limit(Math.ceil(limit / 4));

      for (const org of orgs || []) {
        results.push({
          id: org.id,
          type: 'organization',
          title: org.business_name,
          subtitle: org.website ? new URL(org.website).hostname : undefined,
          image_url: org.logo_url || org.profile_image_url,
          relevance_score: 0.7
        });
      }

      // Sort by relevance
      results.sort((a, b) => b.relevance_score - a.relevance_score);

      return {
        success: true,
        results: results.slice(0, limit),
        query_type: year ? 'year' : 'text',
        total_count: results.length,
        search_time_ms: Date.now() - startTime
      };
    } catch (err) {
      console.error('Fallback search error:', err);
      return {
        success: false,
        results: [],
        query_type: 'text',
        total_count: 0,
        search_time_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }
}

export const universalSearchService = new UniversalSearchService();
export default universalSearchService;
