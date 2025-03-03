
import { useState } from 'react';

export const useImageUpload = (onUpload: (files: FileList | null, type: string, description: string) => void) => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [imageType, setImageType] = useState<string>('exterior');
  const [description, setDescription] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setSelectedFiles(files);
    
    // Generate previews
    const urls: string[] = [];
    Array.from(files).forEach(file => {
      urls.push(URL.createObjectURL(file));
    });
    setPreviewUrls(urls);
  };

  const handleSubmit = () => {
    onUpload(selectedFiles, imageType, description);
    // Clean up
    resetForm();
  };

  const resetForm = () => {
    // Revoke object URLs to avoid memory leaks
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls([]);
    setSelectedFiles(null);
    setImageType('exterior');
    setDescription('');
  };

  const removePreview = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
    
    // Remove from FileList - we can't modify FileList directly, so we need to create a new one
    if (selectedFiles) {
      const dataTransfer = new DataTransfer();
      Array.from(selectedFiles)
        .filter((_, i) => i !== index)
        .forEach(file => dataTransfer.items.add(file));
      setSelectedFiles(dataTransfer.files);
    }
  };

  return {
    selectedFiles,
    previewUrls,
    imageType,
    setImageType,
    description,
    setDescription,
    handleFileChange,
    handleSubmit,
    resetForm,
    removePreview,
  };
};
