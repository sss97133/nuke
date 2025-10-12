import { useState, useCallback, useEffect } from 'react';

export interface ImageData {
  id: string;
  image_url: string;
  created_at?: string;
  is_primary?: boolean;
  is_sensitive?: boolean;
  sensitive_type?: string | null;
  storage_path?: string | null;
}

export interface ImageViewerFilters {
  stage: string;
  role: string;
  area: string;
  part: string;
}

export type SortMode = 'primary_newest' | 'newest' | 'oldest';

export const useImageViewerState = (vehicleId: string) => {
  // Main state
  const [loadedImages, setLoadedImages] = useState<ImageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [workingIds, setWorkingIds] = useState<Record<string, boolean>>({});

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ url: string; id: string } | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Interaction state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  // Filter and sort state
  const [sortMode, setSortMode] = useState<SortMode>('primary_newest');
  const [filters, setFilters] = useState<ImageViewerFilters>({
    stage: '',
    role: '',
    area: '',
    part: ''
  });
  const [showFilters, setShowFilters] = useState<boolean>(false);

  // Authorization state
  const [isAuthorizedForSensitive, setIsAuthorizedForSensitive] = useState<boolean>(false);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState<{
    total: number;
    completed: number;
    uploading: boolean;
  }>({total: 0, completed: 0, uploading: false});

  // Load images from database
  const loadImages = useCallback(async () => {
    if (!vehicleId) return;

    // Throttle duplicate loads within 800ms and prevent overlapping
    const now = Date.now();
    (loadImages as any)._last = (loadImages as any)._last || 0;
    if (now - (loadImages as any)._last < 800) return;
    (loadImages as any)._last = now;

    if ((loadImages as any)._inflight) return;
    (loadImages as any)._inflight = true;

    const { supabase } = await import('../../lib/supabase');

    let query = supabase
      .from('vehicle_images')
      .select('id, image_url, created_at, is_primary, is_sensitive, sensitive_type, storage_path')
      .eq('vehicle_id', vehicleId);

    // Apply filters
    if (filters.stage) query = query.eq('process_stage', filters.stage);
    if (filters.role) query = query.eq('workflow_role', filters.role);
    if (filters.area) query = query.ilike('area', `%${filters.area}%`);
    if (filters.part) query = query.ilike('part', `%${filters.part}%`);

    // Apply ordering based on sortMode
    if (sortMode === 'primary_newest') {
      query = query.order('is_primary', { ascending: false }).order('created_at', { ascending: false });
    } else if (sortMode === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else if (sortMode === 'oldest') {
      query = query.order('created_at', { ascending: true });
    }

    try {
      const { data, error } = await query;

      if (error) {
        console.error('Error loading images:', error);
        setLoadedImages([]);
      } else {
        setLoadedImages(data || []);
      }
    } catch (err) {
      console.error('Exception loading images:', err);
      setLoadedImages([]);
    } finally {
      (loadImages as any)._inflight = false;
    }
  }, [vehicleId, filters, sortMode]);

  // Update filters
  const updateFilters = useCallback((newFilters: Partial<ImageViewerFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  // Reset filters
  const resetFilters = useCallback(() => {
    setFilters({ stage: '', role: '', area: '', part: '' });
  }, []);

  // Lightbox controls
  const openLightbox = useCallback((image: ImageData, index: number) => {
    setSelectedImage({ url: image.image_url, id: image.id });
    setCurrentImageIndex(index);
    setLightboxOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setSelectedImage(null);
  }, []);

  const nextImage = useCallback(() => {
    if (loadedImages.length === 0) return;
    const nextIndex = (currentImageIndex + 1) % loadedImages.length;
    const nextImg = loadedImages[nextIndex];
    setCurrentImageIndex(nextIndex);
    setSelectedImage({ url: nextImg.image_url, id: nextImg.id });
  }, [currentImageIndex, loadedImages]);

  const prevImage = useCallback(() => {
    if (loadedImages.length === 0) return;
    const prevIndex = (currentImageIndex - 1 + loadedImages.length) % loadedImages.length;
    const prevImg = loadedImages[prevIndex];
    setCurrentImageIndex(prevIndex);
    setSelectedImage({ url: prevImg.image_url, id: prevImg.id });
  }, [currentImageIndex, loadedImages]);

  return {
    // State
    loadedImages,
    isLoading,
    workingIds,
    lightboxOpen,
    selectedImage,
    currentImageIndex,
    draggedIndex,
    editMode,
    selectedImages,
    sortMode,
    filters,
    showFilters,
    isAuthorizedForSensitive,
    uploadProgress,

    // Actions
    setLoadedImages,
    setIsLoading,
    setWorkingIds,
    setDraggedIndex,
    setEditMode,
    setSelectedImages,
    setSortMode,
    setShowFilters,
    setIsAuthorizedForSensitive,
    setUploadProgress,

    // Methods
    loadImages,
    updateFilters,
    resetFilters,
    openLightbox,
    closeLightbox,
    nextImage,
    prevImage
  };
};