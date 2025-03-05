
import { useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { useFileValidation } from './useFileValidation';
import { usePreviewManagement } from './usePreviewManagement';
import { VehicleFormValues } from '../../../types';

interface UseFileUploadOptions {
  form: UseFormReturn<VehicleFormValues>;
  name: keyof VehicleFormValues;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
}

export const useFileUpload = ({
  form,
  name,
  multiple = false,
  maxSize = 5 * 1024 * 1024, // 5MB
  maxFiles = 10
}: UseFileUploadOptions) => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { validateFiles } = useFileValidation();
  const { previewUrls, createPreviews, removePreview, clearPreviews } = usePreviewManagement();

  // Process files for upload
  const processFiles = (files: FileList) => {
    const isValid = validateFiles(files, {
      maxSize,
      allowedTypes: ['image/'],
      maxFiles: multiple ? maxFiles : 1
    });
    
    if (!isValid) return;
    
    // Create preview URLs
    const newPreviewUrls = createPreviews(files, multiple);
    
    // Simulate upload process
    simulateUpload(newPreviewUrls);
  };
  
  // Simulate the upload process (in a real app, this would be an actual upload)
  const simulateUpload = (previewUrls: string[]) => {
    setIsUploading(true);
    
    // In a real implementation, you would upload the files to your storage here
    // For now, we'll simulate the upload with a timeout
    setTimeout(() => {
      // After "upload", set the URLs in the form
      const imageValue = multiple 
        ? previewUrls 
        : previewUrls[0] || '';
      
      form.setValue(name as any, imageValue);
      setIsUploading(false);
      
      toast({
        title: 'Images uploaded',
        description: `${previewUrls.length} image(s) have been uploaded successfully`,
      });
    }, 1500);
  };
  
  // Handler for file input change events
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    processFiles(files);
  };
  
  // Clear a specific image
  const clearImage = (index: number) => {
    removePreview(index);
    
    if (multiple) {
      const currentValue = form.watch(name as any) as string[];
      const newValue = [...currentValue];
      newValue.splice(index, 1);
      form.setValue(name as any, newValue as any);
    } else if (index === 0) {
      form.setValue(name as any, '' as any);
    }
  };
  
  // Clear all images
  const clearAllImages = () => {
    clearPreviews();
    form.setValue(name as any, multiple ? [] as any : '' as any);
  };

  return {
    isUploading,
    previewUrls,
    handleFileChange,
    processFiles,
    clearImage,
    clearAllImages
  };
};
