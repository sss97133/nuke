
import { useState } from 'react';

export const usePreviewManagement = () => {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  
  // Generate preview URLs from files
  const createPreviews = (files: FileList, append: boolean = false) => {
    const newPreviewUrls = Array.from(files).map(file => URL.createObjectURL(file));
    
    if (append) {
      setPreviewUrls(prev => [...prev, ...newPreviewUrls]);
    } else {
      // Clean up previous preview URLs to avoid memory leaks
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      setPreviewUrls(newPreviewUrls);
    }
    
    return newPreviewUrls;
  };
  
  // Remove a specific preview
  const removePreview = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };
  
  // Clear all previews
  const clearPreviews = () => {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls([]);
  };
  
  return {
    previewUrls,
    createPreviews,
    removePreview,
    clearPreviews
  };
};
