/**
 * Full-Text Search Service
 * Uses PostgreSQL tsvector for fast, ranked searches
 * Integrates with advancedSearchService for hybrid ranking
 */

import { supabase } from '../lib/supabase';
import { advancedSearchService } from './advancedSearchService';

interface FullTextSearchResult {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  description?: string;
  created_at: string;
  relevance: number;
}

interface FullTextSearchOptions {
  limit?: number;
  usePrefixMatching?: boolean;
}

export class FullTextSearchService {
  /**
   * Convert user query to PostgreSQL tsquery format
   */
  static convertToTSQuery(query: string, usePrefix: boolean = true): string {
    // Remove common stop words and normalize
    const normalized = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => {
        // Filter short words and stop words
        if (word.length <= 2) return false;
        const stopWords = ['the', 'and', 'or', 'for', 'with', 'from', 'near', 'me'];
        return !stopWords.includes(word);
      });

    if (normalized.length === 0) return '';

    // Join with AND operator, add prefix matching if requested
    const operator = usePrefix ? ':*' : '';
    return normalized.map(word => `${word}${operator}`).join(' & ');
  }

  /**
   * Search vehicles using full-text search
   */
  static async searchVehicles(
    query: string,
    options: FullTextSearchOptions = {}
  ): Promise<FullTextSearchResult[]> {
    const { limit = 20, usePrefixMatching = true } = options;
    
    if (!query.trim()) {
      return [];
    }

    const tsQuery = this.convertToTSQuery(query, usePrefixMatching);
    
    if (!tsQuery) {
      return [];
    }

    try {
      const { data, error } = await supabase.rpc('search_vehicles_fulltext', {
        query_text: tsQuery,
        limit_count: limit
      });

      if (error) {
        console.error('Full-text search error:', error);
        return [];
      }

      return (data || []).map((result: any) => ({
        id: result.id,
        year: result.year,
        make: result.make,
        model: result.model,
        color: result.color,
        description: result.description,
        created_at: result.created_at,
        relevance: result.relevance || 0
      }));
    } catch (error) {
      console.error('Full-text search exception:', error);
      return [];
    }
  }

  /**
   * Search timeline events using full-text search
   */
  static async searchTimelineEvents(
    query: string,
    options: FullTextSearchOptions = {}
  ): Promise<any[]> {
    const { limit = 15, usePrefixMatching = true } = options;
    
    if (!query.trim()) {
      return [];
    }

    const tsQuery = this.convertToTSQuery(query, usePrefixMatching);
    
    if (!tsQuery) {
      return [];
    }

    try {
      const { data, error } = await supabase.rpc('search_timeline_events_fulltext', {
        query_text: tsQuery,
        limit_count: limit
      });

      if (error) {
        console.error('Timeline events full-text search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Timeline events search exception:', error);
      return [];
    }
  }

  /**
   * Search businesses using full-text search
   */
  static async searchBusinesses(
    query: string,
    options: FullTextSearchOptions = {}
  ): Promise<any[]> {
    const { limit = 15, usePrefixMatching = true } = options;
    
    if (!query.trim()) {
      return [];
    }

    const tsQuery = this.convertToTSQuery(query, usePrefixMatching);
    
    if (!tsQuery) {
      return [];
    }

    try {
      const { data, error } = await supabase.rpc('search_businesses_fulltext', {
        query_text: tsQuery,
        limit_count: limit
      });

      if (error) {
        console.error('Businesses full-text search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Businesses search exception:', error);
      return [];
    }
  }

  /**
   * Search profiles using full-text search
   */
  static async searchProfiles(
    query: string,
    options: FullTextSearchOptions = {}
  ): Promise<any[]> {
    const { limit = 10, usePrefixMatching = true } = options;
    
    if (!query.trim()) {
      return [];
    }

    const tsQuery = this.convertToTSQuery(query, usePrefixMatching);
    
    if (!tsQuery) {
      return [];
    }

    try {
      const { data, error } = await supabase.rpc('search_profiles_fulltext', {
        query_text: tsQuery,
        limit_count: limit
      });

      if (error) {
        console.error('Profiles full-text search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Profiles search exception:', error);
      return [];
    }
  }

  /**
   * Hybrid search: Full-text + BM25 re-ranking
   */
  static async searchVehiclesHybrid(
    query: string,
    options: FullTextSearchOptions = {}
  ): Promise<FullTextSearchResult[]> {
    // 1. Get initial results from PostgreSQL (fast, ranked)
    const pgResults = await this.searchVehicles(query, { ...options, limit: 50 });
    
    if (pgResults.length === 0) {
      return [];
    }

    // 2. Re-rank using BM25 service (domain knowledge)
    const searchDocs = pgResults.map(result => ({
      id: result.id,
      type: 'vehicle',
      title: `${result.year || ''} ${result.make || ''} ${result.model || ''}`.trim(),
      description: result.description || '',
      content: `${result.year || ''} ${result.make || ''} ${result.model || ''} ${result.color || ''} ${result.description || ''}`.trim(),
      fields: {
        year: result.year,
        make: result.make,
        model: result.model,
        color: result.color
      },
      created_at: result.created_at
    }));

    const reranked = advancedSearchService.rankDocuments(query, searchDocs);
    
    // 3. Combine scores (weighted average)
    const scoreMap = new Map(pgResults.map(r => [r.id, r.relevance]));
    
    return reranked.map(result => {
      const pgScore = scoreMap.get(result.id) || 0;
      // Normalize PostgreSQL score (0-1 range)
      const normalizedPgScore = Math.min(1.0, pgScore / 10);
      // Hybrid score: 60% BM25 (domain knowledge) + 40% PostgreSQL (ranking)
      const hybridScore = (result.relevance_score * 0.6) + (normalizedPgScore * 0.4);
      
      return {
        id: result.id,
        year: result.metadata.year,
        make: result.metadata.make,
        model: result.metadata.model,
        color: result.metadata.color,
        description: result.description,
        created_at: result.created_at,
        relevance: hybridScore
      };
    }).sort((a, b) => b.relevance - a.relevance);
  }
}

export const fullTextSearchService = FullTextSearchService;

