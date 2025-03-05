
import { useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { VehicleFormValues } from '../../types';

interface UseImageUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  name: keyof VehicleFormValues;
  multiple?: boolean;
}

export const useImageUpload = ({ form, name, multiple = false }: UseImageUploadProps) => {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  
  // Process the selected files
  const processFiles = (files: FileList) => {
    // Validate files
    const validFiles: File[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid file type',
          description: `${file.name} is not an image file`,
          variant: 'destructive',
        });
        continue;
      }
      
      // Validate file size
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
          title: 'File too large',
          description: `${file.name} exceeds the 5MB limit`,
          variant: 'destructive',
        });
        continue;
      }
      
      validFiles.push(file);
    }
    
    if (validFiles.length === 0) return;
    
    // Create preview URLs
    const newPreviewUrls = validFiles.map(file => URL.createObjectURL(file));
    
    // If not multiple, replace the current preview URLs
    const updatedPreviewUrls = multiple 
      ? [...previewUrls, ...newPreviewUrls]
      : newPreviewUrls;
    
    setPreviewUrls(updatedPreviewUrls);
    
    // Simulate uploading
    setIsUploading(true);
    
    // In a real implementation, you would upload the files to your storage here
    // For now, we'll simulate the upload with a timeout
    setTimeout(() => {
      // After "upload", set the URLs in the form
      const imageValue = multiple 
        ? updatedPreviewUrls 
        : updatedPreviewUrls[0] || '';
      
      form.setValue(name as any, imageValue);
      setIsUploading(false);
      
      toast({
        title: 'Images uploaded',
        description: `${validFiles.length} image(s) have been uploaded successfully`,
      });
    }, 1500);
  };
  
  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    // Process each file
    processFiles(files);
  };

  // Clear all images
  const clearAllImages = () => {
    form.setValue(name as any, multiple ? [] : '');
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls([]);
  };
  
  // Clear a specific image
  const clearImage = (index: number) => {
    const newPreviewUrls = [...previewUrls];
    URL.revokeObjectURL(newPreviewUrls[index]);
    newPreviewUrls.splice(index, 1);
    setPreviewUrls(newPreviewUrls);
    
    if (multiple) {
      form.setValue(name as any, newPreviewUrls);
    } else if (newPreviewUrls.length > 0) {
      form.setValue(name as any, newPreviewUrls[0]);
    } else {
      form.setValue(name as any, '');
    }
  };

  // Convert the form value to preview URLs if necessary
  const formValue = form.watch(name as any);
  const displayUrls = previewUrls.length > 0 ? previewUrls : (
    Array.isArray(formValue) ? formValue : (formValue ? [formValue] : [])
  );

  return {
    displayUrls,
    isUploading,
    handleFileChange,
    processFiles,
    clearAllImages,
    clearImage
  };
};
