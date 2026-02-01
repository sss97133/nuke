/**
 * useImageSelection Hook
 * Manages multi-select state for image gallery with bulk operations
 */

import { useState, useCallback } from 'react';

export interface UseImageSelectionReturn {
  selectedImages: Set<string>;
  isSelected: (imageId: string) => boolean;
  toggleImage: (imageId: string) => void;
  selectImage: (imageId: string) => void;
  deselectImage: (imageId: string) => void;
  selectMultiple: (imageIds: string[]) => void;
  deselectMultiple: (imageIds: string[]) => void;
  selectAll: (imageIds: string[]) => void;
  clearSelection: () => void;
  getSelectedArray: () => string[];
  selectedCount: number;
}

export const useImageSelection = (): UseImageSelectionReturn => {
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  const isSelected = useCallback(
    (imageId: string) => selectedImages.has(imageId),
    [selectedImages]
  );

  const toggleImage = useCallback((imageId: string) => {
    setSelectedImages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  }, []);

  const selectImage = useCallback((imageId: string) => {
    setSelectedImages((prev) => {
      const newSet = new Set(prev);
      newSet.add(imageId);
      return newSet;
    });
  }, []);

  const deselectImage = useCallback((imageId: string) => {
    setSelectedImages((prev) => {
      const newSet = new Set(prev);
      newSet.delete(imageId);
      return newSet;
    });
  }, []);

  const selectMultiple = useCallback((imageIds: string[]) => {
    setSelectedImages((prev) => {
      const newSet = new Set(prev);
      imageIds.forEach((id) => newSet.add(id));
      return newSet;
    });
  }, []);

  const deselectMultiple = useCallback((imageIds: string[]) => {
    setSelectedImages((prev) => {
      const newSet = new Set(prev);
      imageIds.forEach((id) => newSet.delete(id));
      return newSet;
    });
  }, []);

  const selectAll = useCallback((imageIds: string[]) => {
    setSelectedImages(new Set(imageIds));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedImages(new Set());
  }, []);

  const getSelectedArray = useCallback(() => {
    return Array.from(selectedImages);
  }, [selectedImages]);

  return {
    selectedImages,
    isSelected,
    toggleImage,
    selectImage,
    deselectImage,
    selectMultiple,
    deselectMultiple,
    selectAll,
    clearSelection,
    getSelectedArray,
    selectedCount: selectedImages.size,
  };
};

