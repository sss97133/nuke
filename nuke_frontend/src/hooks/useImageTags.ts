import { useState, useEffect, useCallback } from 'react';
import ImageTaggingService, { ImageTag, CreateTagRequest, SpatialTag } from '../services/imageTaggingService';

interface UseImageTagsResult {
  // State
  tags: SpatialTag[];
  loading: boolean;
  error: string | null;
  saving: boolean;

  // Actions
  addTag: (x: number, y: number, text?: string, type?: string) => Promise<boolean>;
  updateTag: (tagId: string, updates: { text?: string; type?: string; x?: number; y?: number }) => Promise<boolean>;
  deleteTag: (tagId: string) => Promise<boolean>;
  refreshTags: () => Promise<void>;

  // Bulk operations
  bulkTag: (imageIds: string[], tagText: string, tagType?: string) => Promise<boolean>;

  // Statistics
  tagCount: number;
  uniqueTagCount: number;
}

export function useImageTags(imageId: string): UseImageTagsResult {
  const [tags, setTags] = useState<SpatialTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load tags for the image
  const loadTags = useCallback(async () => {
    if (!imageId) return;

    try {
      setLoading(true);
      setError(null);

      const dbTags = await ImageTaggingService.getImageTags(imageId);
      const uiTags = ImageTaggingService.convertToUIFormat(dbTags);

      setTags(uiTags);
    } catch (err) {
      console.error('Error loading tags:', err);
      setError(err instanceof Error ? err.message : 'Failed to load tags');
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  // Refresh tags (public method)
  const refreshTags = useCallback(() => loadTags(), [loadTags]);

  // Load tags on mount and when imageId changes
  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Add a new tag
  const addTag = useCallback(async (
    x: number,
    y: number,
    text: string = '',
    type: string = 'general'
  ): Promise<boolean> => {
    if (!imageId) return false;

    try {
      setSaving(true);
      setError(null);

      // Create temporary tag for immediate UI feedback
      const tempId = `temp-${Date.now()}`;
      const tempTag: SpatialTag = {
        id: tempId,
        text: text,
        x: Math.round(x),
        y: Math.round(y),
        type: type
      };

      setTags(prev => [...prev, tempTag]);

      // If no text provided, return true (user will edit inline)
      if (!text.trim()) {
        return true;
      }

      // Create in database
      const tagRequest: CreateTagRequest = {
        image_id: imageId,
        tag_text: text.trim(),
        tag_type: type,
        x_position: Math.round(x),
        y_position: Math.round(y)
      };

      const validation = ImageTaggingService.validateTag(tagRequest);
      if (!validation.valid) {
        setError(validation.errors.join(', '));
        // Remove temp tag on validation failure
        setTags(prev => prev.filter(t => t.id !== tempId));
        return false;
      }

      const newTag = await ImageTaggingService.createTag(tagRequest);

      if (newTag) {
        // Replace temp tag with real tag
        const realTag = ImageTaggingService.convertToUIFormat([newTag])[0];
        setTags(prev => prev.map(t => t.id === tempId ? realTag : t));
        return true;
      } else {
        // Remove temp tag on creation failure
        setTags(prev => prev.filter(t => t.id !== tempId));
        setError('Failed to save tag');
        return false;
      }
    } catch (err) {
      console.error('Error adding tag:', err);
      setError(err instanceof Error ? err.message : 'Failed to add tag');
      return false;
    } finally {
      setSaving(false);
    }
  }, [imageId]);

  // Update an existing tag
  const updateTag = useCallback(async (
    tagId: string,
    updates: { text?: string; type?: string; x?: number; y?: number }
  ): Promise<boolean> => {
    try {
      setSaving(true);
      setError(null);

      // Optimistically update UI
      setTags(prev => prev.map(tag =>
        tag.id === tagId
          ? {
              ...tag,
              text: updates.text ?? tag.text,
              type: updates.type ?? tag.type,
              x: updates.x ?? tag.x,
              y: updates.y ?? tag.y
            }
          : tag
      ));

      // If it's a temporary tag, convert to real tag
      if (tagId.startsWith('temp-')) {
        const tag = tags.find(t => t.id === tagId);
        if (tag && updates.text?.trim()) {
          return await addTag(
            updates.x ?? tag.x,
            updates.y ?? tag.y,
            updates.text.trim(),
            updates.type ?? tag.type
          );
        }
        return true;
      }

      // Update in database
      const dbUpdates: Partial<ImageTag> = {};
      if (updates.text !== undefined) dbUpdates.tag_text = updates.text.trim();
      if (updates.type !== undefined) dbUpdates.tag_type = updates.type;
      if (updates.x !== undefined) dbUpdates.x_position = Math.round(updates.x);
      if (updates.y !== undefined) dbUpdates.y_position = Math.round(updates.y);

      const updatedTag = await ImageTaggingService.updateTag(tagId, dbUpdates);

      if (!updatedTag) {
        // Revert optimistic update on failure
        await loadTags();
        setError('Failed to update tag');
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error updating tag:', err);
      setError(err instanceof Error ? err.message : 'Failed to update tag');
      await loadTags(); // Revert changes
      return false;
    } finally {
      setSaving(false);
    }
  }, [tags, addTag, loadTags]);

  // Delete a tag
  const deleteTag = useCallback(async (tagId: string): Promise<boolean> => {
    try {
      setSaving(true);
      setError(null);

      // Optimistically remove from UI
      setTags(prev => prev.filter(t => t.id !== tagId));

      // If it's a temporary tag, just remove it
      if (tagId.startsWith('temp-')) {
        return true;
      }

      // Delete from database
      const success = await ImageTaggingService.deleteTag(tagId);

      if (!success) {
        // Revert optimistic update on failure
        await loadTags();
        setError('Failed to delete tag');
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error deleting tag:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete tag');
      await loadTags(); // Revert changes
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadTags]);

  // Bulk tag multiple images
  const bulkTag = useCallback(async (
    imageIds: string[],
    tagText: string,
    tagType: string = 'general'
  ): Promise<boolean> => {
    try {
      setSaving(true);
      setError(null);

      const results = await ImageTaggingService.bulkTagImages(imageIds, tagText, tagType);

      if (results.length === 0) {
        setError('Failed to bulk tag images');
        return false;
      }

      // Refresh tags if current image was included
      if (imageIds.includes(imageId)) {
        await loadTags();
      }

      return true;
    } catch (err) {
      console.error('Error bulk tagging:', err);
      setError(err instanceof Error ? err.message : 'Failed to bulk tag images');
      return false;
    } finally {
      setSaving(false);
    }
  }, [imageId, loadTags]);

  return {
    // State
    tags,
    loading,
    error,
    saving,

    // Actions
    addTag,
    updateTag,
    deleteTag,
    refreshTags,

    // Bulk operations
    bulkTag,

    // Statistics
    tagCount: tags.length,
    uniqueTagCount: new Set(tags.map(t => t.text.toLowerCase().trim())).size
  };
}

export default useImageTags;