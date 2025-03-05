import { useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../../../types';
import { usePreviewManagement } from './usePreviewManagement';
import { useFileValidation } from './useFileValidation';
import { useToast } from '@/hooks/use-toast';

interface UseFileUploadProps {
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
}: UseFileUploadProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  
  // Utilize the preview management hook
  const {
    previewUrls,
    createPreviews,
    removePreview,
    clearPreviews
  } = usePreviewManagement();
  
  // Utilize the file validation hook
  const { validateFiles } = useFileValidation();
  
  // Handle file selection from input
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    
    if (!files || files.length === 0) {
      return;
    }
    
    processFiles(files);
  };
  
  // Process files, validate them, create previews, and update form values
  const processFiles = (files: FileList) => {
    // Validate the files
    const isValid = validateFiles(files, {
      maxSize,
      maxFiles: multiple ? maxFiles : 1,
      allowedTypes: ['image/']
    });
    
    if (!isValid) {
      return;
    }
    
    setIsUploading(true);
    
    try {
      // Create preview URLs for the files
      const newPreviews = createPreviews(files, multiple);
      
      // Convert files to data URLs for form values
      const promises = Array.from(files).map(file => 
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        })
      );
      
      // Process all files and update form value
      Promise.all(promises)
        .then(dataUrls => {
          // Update form value based on whether multiple is allowed
          const currentValues = form.getValues(name as any);
          
          if (multiple) {
            // If form value is already an array, append to it
            if (Array.isArray(currentValues)) {
              form.setValue(name as any, [...currentValues, ...dataUrls]);
            } else {
              // Otherwise, create a new array
              form.setValue(name as any, dataUrls);
            }
          } else {
            // For single file uploads, just set the first data URL
            form.setValue(name as any, dataUrls[0]);
          }
          
          toast({
            title: multiple ? 'Images uploaded' : 'Image uploaded',
            description: multiple ? `${dataUrls.length} files have been uploaded.` : 'Image has been uploaded.',
            variant: 'default',
          });
        })
        .catch(error => {
          console.error('Error processing files:', error);
          toast({
            title: 'Upload failed',
            description: 'There was an error processing the files.',
            variant: 'destructive',
          });
        })
        .finally(() => {
          setIsUploading(false);
        });
    } catch (error) {
      console.error('Error in file processing:', error);
      setIsUploading(false);
      toast({
        title: 'Upload error',
        description: 'An unexpected error occurred while processing the files.',
        variant: 'destructive',
      });
    }
  };
  
  // Clear a specific image by index
  const clearImage = (index: number) => {
    removePreview(index);
    
    // Also update the form value
    const currentValues = form.getValues(name as any);
    if (Array.isArray(currentValues)) {
      const newValues = [...currentValues];
      newValues.splice(index, 1);
      form.setValue(name as any, newValues);
    } else if (index === 0) {
      // If it's the only image (index 0) and not an array
      form.setValue(name as any, '');
    }
  };
  
  // Clear all images
  const clearAllImages = () => {
    clearPreviews();
    form.setValue(name as any, multiple ? [] : '');
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
