/**
 * Knowledge Library Service
 * Manages user's saved knowledge articles
 */

import { supabase } from '../lib/supabase';

export interface KnowledgeArticle {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export class KnowledgeLibraryService {
  /**
   * Get all knowledge articles for a user
   */
  static async getUserArticles(userId: string, includePublic = false): Promise<KnowledgeArticle[]> {
    try {
      let query = supabase
        .from('user_knowledge_library')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!includePublic) {
        // When includePublic is false, we still want all user's articles (public and private)
        // The filter is only for public viewing
      }

      const { data, error } = await query;
      if (error) {
        // If table doesn't exist (404), return empty array gracefully
        if (error.code === 'PGRST301' || error.code === '42P01') {
          console.warn('user_knowledge_library table does not exist yet');
          return [];
        }
        throw error;
      }
      return data || [];
    } catch (error) {
      console.error('Error loading knowledge articles:', error);
      return [];
    }
  }

  /**
   * Get public knowledge articles (for profile display)
   */
  static async getPublicArticles(userId: string): Promise<KnowledgeArticle[]> {
    try {
      const { data, error } = await supabase
        .from('user_knowledge_library')
        .select('*')
        .eq('user_id', userId)
        .eq('is_public', true)
        .order('created_at', { ascending: false });

      if (error) {
        // If table doesn't exist (404), return empty array gracefully
        if (error.code === 'PGRST301' || error.code === '42P01') {
          console.warn('user_knowledge_library table does not exist yet');
          return [];
        }
        throw error;
      }
      return data || [];
    } catch (error) {
      console.error('Error loading public knowledge articles:', error);
      return [];
    }
  }

  /**
   * Create a new knowledge article
   */
  static async createArticle(article: Omit<KnowledgeArticle, 'id' | 'created_at' | 'updated_at'>): Promise<KnowledgeArticle | null> {
    try {
      const { data, error } = await supabase
        .from('user_knowledge_library')
        .insert({
          ...article,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating knowledge article:', error);
      throw error;
    }
  }

  /**
   * Update a knowledge article
   */
  static async updateArticle(articleId: string, updates: Partial<KnowledgeArticle>): Promise<KnowledgeArticle | null> {
    try {
      const { data, error } = await supabase
        .from('user_knowledge_library')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', articleId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating knowledge article:', error);
      throw error;
    }
  }

  /**
   * Delete a knowledge article
   */
  static async deleteArticle(articleId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('user_knowledge_library')
        .delete()
        .eq('id', articleId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting knowledge article:', error);
      throw error;
    }
  }

  /**
   * Search articles by title, content, or tags
   */
  static async searchArticles(userId: string, searchTerm: string): Promise<KnowledgeArticle[]> {
    try {
      const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1');
      const searchSafe = escapeILike(searchTerm);
      const { data, error } = await supabase
        .from('user_knowledge_library')
        .select('*')
        .eq('user_id', userId)
        .or(`title.ilike.%${searchSafe}%,content.ilike.%${searchSafe}%`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error searching knowledge articles:', error);
      return [];
    }
  }
}

