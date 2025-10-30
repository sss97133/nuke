import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import {
  ImageData,
  ViewerState,
  TagState,
  CommentState,
  DEFAULT_VIEWER_STATE,
  DEFAULT_TAG_STATE,
  DEFAULT_COMMENT_STATE,
  SpatialTag,
  TagType
} from '../constants';
import ImageTaggingService from '../../../services/imageTaggingService';

interface UseProImageViewerResult {
  // State
  viewerState: ViewerState;
  tagState: TagState;
  commentState: CommentState;
  images: ImageData[];

  // Image Actions
  selectImage: (image: ImageData) => void;
  closeFullscreen: () => void;
  toggleTags: () => void;
  toggleGrid: () => void;
  setImages: (images: ImageData[]) => void;

  // Tag Actions
  loadImageTags: (imageId: string) => Promise<void>;
  addTag: (x: number, y: number) => void;
  saveTag: (tagId: string) => Promise<void>;
  deleteTag: (tagId: string) => Promise<void>;
  updateTagText: (text: string) => void;
  updateTagType: (type: TagType) => void;

  // Comment Actions
  loadComments: (imageId: string) => Promise<void>;
  addComment: (text: string) => Promise<void>;
  updateComment: (commentId: string, text: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;

  // Utility
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export function useProImageViewer(): UseProImageViewerResult {
  const [viewerState, setViewerState] = useState<ViewerState>(DEFAULT_VIEWER_STATE);
  const [tagState, setTagState] = useState<TagState>(DEFAULT_TAG_STATE);
  const [commentState, setCommentState] = useState<CommentState>(DEFAULT_COMMENT_STATE);
  const [images, setImages] = useState<ImageData[]>([]);

  // Image Actions
  const selectImage = useCallback((image: ImageData) => {
    setViewerState(prev => ({
      ...prev,
      selectedImage: image,
      showFullRes: true,
      showGrid: false
    }));

    // Load tags and comments for the selected image
    if (image.id) {
      loadImageTags(image.id);
      loadComments(image.id);
    }
  }, []);

  const closeFullscreen = useCallback(() => {
    setViewerState(prev => ({
      ...prev,
      selectedImage: null,
      showFullRes: false,
      showGrid: true,
      showTags: false
    }));

    // Clear tag and comment state
    setTagState(DEFAULT_TAG_STATE);
    setCommentState(DEFAULT_COMMENT_STATE);
  }, []);

  const toggleTags = useCallback(() => {
    setViewerState(prev => ({
      ...prev,
      showTags: !prev.showTags
    }));
  }, []);

  const toggleGrid = useCallback(() => {
    setViewerState(prev => ({
      ...prev,
      showGrid: !prev.showGrid
    }));
  }, []);

  // Tag Actions
  const loadImageTags = useCallback(async (imageId: string) => {
    try {
      setTagState(prev => ({ ...prev, tagsLoading: true }));

      const dbTags = await ImageTaggingService.getImageTags(imageId);
      const uiTags = ImageTaggingService.convertToUIFormat(dbTags);

      setTagState(prev => ({
        ...prev,
        imageTags: uiTags,
        tagsLoading: false
      }));
    } catch (error) {
      console.error('Error loading image tags:', error);
      setTagState(prev => ({
        ...prev,
        tagsLoading: false,
        imageTags: []
      }));
    }
  }, []);

  const addTag = useCallback((x: number, y: number) => {
    const newTagId = `temp-${Date.now()}`;
    const newTag: SpatialTag = {
      id: newTagId,
      x: Math.round(x),
      y: Math.round(y),
      text: '',
      type: tagState.selectedTagType,
      isEditing: true
    };

    setTagState(prev => ({
      ...prev,
      imageTags: [...prev.imageTags, newTag],
      activeTagId: newTagId
    }));
  }, [tagState.selectedTagType]);

  const saveTag = useCallback(async (tagId: string) => {
    if (!tagState.tagText.trim() || !viewerState.selectedImage) return;

    try {
      setTagState(prev => ({ ...prev, tagSaving: true }));

      const tag = tagState.imageTags.find(t => t.id === tagId);
      if (!tag) return;

      if (tagId.startsWith('temp-')) {
        // Create new tag
        const newTag = await ImageTaggingService.createTag({
          image_id: viewerState.selectedImage.id,
          tag_text: tagState.tagText.trim(),
          tag_type: tagState.selectedTagType,
          x_position: tag.x,
          y_position: tag.y
        });

        if (newTag) {
          const uiTag = ImageTaggingService.convertToUIFormat([newTag])[0];
          setTagState(prev => ({
            ...prev,
            imageTags: prev.imageTags.map(t =>
              t.id === tagId ? { ...uiTag, isEditing: false } : t
            ),
            activeTagId: null,
            tagText: ''
          }));
        }
      } else {
        // Update existing tag
        await ImageTaggingService.updateTag(tagId, {
          tag_text: tagState.tagText.trim(),
          tag_type: tagState.selectedTagType
        });

        setTagState(prev => ({
          ...prev,
          imageTags: prev.imageTags.map(t =>
            t.id === tagId
              ? { ...t, text: tagState.tagText.trim(), type: tagState.selectedTagType, isEditing: false }
              : t
          ),
          activeTagId: null,
          tagText: ''
        }));
      }
    } catch (error) {
      console.error('Error saving tag:', error);
    } finally {
      setTagState(prev => ({ ...prev, tagSaving: false }));
    }
  }, [tagState.tagText, tagState.selectedTagType, viewerState.selectedImage, tagState.imageTags]);

  const deleteTag = useCallback(async (tagId: string) => {
    try {
      setTagState(prev => ({ ...prev, tagSaving: true }));

      // Optimistically remove from UI
      setTagState(prev => ({
        ...prev,
        imageTags: prev.imageTags.filter(t => t.id !== tagId),
        activeTagId: prev.activeTagId === tagId ? null : prev.activeTagId
      }));

      // Delete from database if not temporary
      if (!tagId.startsWith('temp-')) {
        await ImageTaggingService.deleteTag(tagId);
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
      // Reload tags on error
      if (viewerState.selectedImage) {
        loadImageTags(viewerState.selectedImage.id);
      }
    } finally {
      setTagState(prev => ({ ...prev, tagSaving: false }));
    }
  }, [viewerState.selectedImage, loadImageTags]);

  const updateTagText = useCallback((text: string) => {
    setTagState(prev => ({ ...prev, tagText: text }));
  }, []);

  const updateTagType = useCallback((type: TagType) => {
    setTagState(prev => ({ ...prev, selectedTagType: type }));
  }, []);

  // Comment Actions (simplified for now)
  const loadComments = useCallback(async (imageId: string) => {
    try {
      setCommentState(prev => ({ ...prev, commentSaving: true }));
      // TODO: Implement comment loading
      setCommentState(prev => ({ ...prev, commentSaving: false, comments: [] }));
    } catch (error) {
      console.error('Error loading comments:', error);
      setCommentState(prev => ({ ...prev, commentSaving: false, commentError: 'Failed to load comments' }));
    }
  }, []);

  const addComment = useCallback(async (text: string) => {
    if (!viewerState.selectedImage) return;
    
    try {
      const { data, error } = await supabase
        .from('image_comments')
        .insert({
          image_id: viewerState.selectedImage.id,
          comment_text: text,
          user_id: supabase.auth.getUser().then(r => r.data.user?.id)
        })
        .select()
        .single();

      if (error) throw error;

      setCommentState(prev => ({
        ...prev,
        comments: [...prev.comments, data]
      }));
    } catch (error) {
      console.error('Error adding comment:', error);
      setError('Failed to add comment');
    }
  }, [viewerState.selectedImage]);

  const updateComment = useCallback(async (commentId: string, text: string) => {
    try {
      const { error } = await supabase
        .from('image_comments')
        .update({ comment_text: text, updated_at: new Date().toISOString() })
        .eq('id', commentId);

      if (error) throw error;

      setCommentState(prev => ({
        ...prev,
        comments: prev.comments.map(c => 
          c.id === commentId ? { ...c, comment_text: text } : c
        )
      }));
    } catch (error) {
      console.error('Error updating comment:', error);
      setError('Failed to update comment');
    }
  }, []);

  const deleteComment = useCallback(async (commentId: string) => {
    try {
      const { error } = await supabase
        .from('image_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;

      setCommentState(prev => ({
        ...prev,
        comments: prev.comments.filter(c => c.id !== commentId)
      }));
    } catch (error) {
      console.error('Error deleting comment:', error);
      setError('Failed to delete comment');
    }
  }, []);

  // Utility Actions
  const setError = useCallback((error: string | null) => {
    setViewerState(prev => ({ ...prev, error }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setViewerState(prev => ({ ...prev, loading }));
  }, []);

  return {
    // State
    viewerState,
    tagState,
    commentState,
    images,

    // Image Actions
    selectImage,
    closeFullscreen,
    toggleTags,
    toggleGrid,
    setImages,

    // Tag Actions
    loadImageTags,
    addTag,
    saveTag,
    deleteTag,
    updateTagText,
    updateTagType,

    // Comment Actions
    loadComments,
    addComment,
    updateComment,
    deleteComment,

    // Utility
    setError,
    setLoading
  };
}

export default useProImageViewer;