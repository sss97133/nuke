
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export const useImageUpload = (onUpload: (files: FileList | null, type: string, description: string) => void) => {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [imageType, setImageType] = useState<string>('exterior');
  const [description, setDescription] = useState<string>('');
  const { toast } = useToast();

  const validateFiles = (files: FileList): boolean => {
    // Maximum file size (10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    // Maximum number of files
    const MAX_FILES = 10;
    
    if (files.length > MAX_FILES) {
      toast({
        title: 'Too many files',
        description: `You can upload a maximum of ${MAX_FILES} images at once.`,
        variant: 'destructive',
      });
      return false;
    }
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds the maximum file size of 10MB.`,
          variant: 'destructive',
        });
        return false;
      }
      
      // Check file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid file type',
          description: `${file.name} is not an image file.`,
          variant: 'destructive',
        });
        return false;
      }
    }
    
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    if (!validateFiles(files)) {
      e.target.value = '';
      return;
    }
    
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
