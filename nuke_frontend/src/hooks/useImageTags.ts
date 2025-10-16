/**
 * Unified Image Tags Hook
 * Single hook for all tag operations - replaces fragmented tag hooks
 */

import { useState, useEffect, useCallback } from 'react';
import { TagService, type Tag } from '../services/tagService';
import { supabase } from '../lib/supabase';

export function useImageTags(imageId?: string) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);

  // Get session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  // Load tags when imageId changes
  const loadTags = useCallback(async () => {
    if (!imageId) {
      setTags([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const loadedTags = await TagService.getTagsForImage(imageId);
      setTags(loadedTags);
      console.log(`✅ Loaded ${loadedTags.length} tags for image ${imageId}`);
    } catch (err: any) {
      console.error('Error loading tags:', err);
      setError(err.message);
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  // Auto-load on mount and when imageId changes
  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Verify tag
  const verifyTag = useCallback(async (tagId: string) => {
    if (!session?.user) {
      console.error('No user session');
      return false;
    }

    const success = await TagService.verifyTag(tagId, session.user.id);
    if (success) {
      await loadTags(); // Reload to show updated status
    }
    return success;
  }, [session, loadTags]);

  // Reject tag
  const rejectTag = useCallback(async (tagId: string) => {
    const success = await TagService.rejectTag(tagId);
    if (success) {
      await loadTags(); // Reload to remove deleted tag
    }
    return success;
  }, [loadTags]);

  // Create manual tag
  const createTag = useCallback(async (
    vehicleId: string,
    tagData: {
      tag_name: string;
      tag_type: string;
      x_position?: number;
      y_position?: number;
      width?: number;
      height?: number;
    }
  ) => {
    if (!session?.user || !imageId) {
      console.error('No user session or image ID');
      return null;
    }

    const tag = await TagService.createManualTag(imageId, vehicleId, tagData, session.user.id);
    if (tag) {
      await loadTags(); // Reload to show new tag
    }
    return tag;
  }, [session, imageId, loadTags]);

  // Trigger AI analysis
  const triggerAIAnalysis = useCallback(async (imageUrl: string, vehicleId: string) => {
    setLoading(true);
    const result = await TagService.triggerAIAnalysis(imageUrl, vehicleId, imageId);
    setLoading(false);
    
    if (result.success) {
      // Wait a moment for tags to be created, then reload
      setTimeout(() => loadTags(), 2000);
    }
    
    return result;
  }, [imageId, loadTags]);

  return {
    tags,
    loading,
    error,
    loadTags,
    verifyTag,
    rejectTag,
    createTag,
    triggerAIAnalysis,
    canEdit: !!session?.user
  };
}
