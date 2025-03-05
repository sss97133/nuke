import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../../types';

interface UseDocumentUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  fieldName: string;
  maxFiles?: number;
  maxSizeInMB?: number;
}

export const useDocumentUpload = ({
  form,
  fieldName,
  maxFiles = 2,
  maxSizeInMB = 10,
}: UseDocumentUploadProps) => {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const { toast } = useToast();

  const validateFiles = (files: FileList): boolean => {
    // Maximum file size (default 10MB)
    const MAX_FILE_SIZE = maxSizeInMB * 1024 * 1024;
    
    if (files.length > maxFiles) {
      toast({
        title: 'Too many files',
        description: `You can upload a maximum of ${maxFiles} files at once.`,
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
          description: `${file.name} exceeds the maximum file size of ${maxSizeInMB}MB.`,
          variant: 'destructive',
        });
        return false;
      }
      
      // Check if it's an image or PDF
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        toast({
          title: 'Invalid file type',
          description: `${file.name} is not a valid document format. Please upload PDFs or images.`,
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
    
    // Convert FileList to array for easier handling
    const filesArray = Array.from(files);
    
    // Generate previews for images
    const newPreviewUrls: string[] = [];
    
    filesArray.forEach(file => {
      if (file.type.startsWith('image/')) {
        newPreviewUrls.push(URL.createObjectURL(file));
      } else {
        // For PDFs, use a placeholder image or icon
        newPreviewUrls.push('/placeholder.svg');
      }
    });
    
    setPreviewUrls(prevUrls => [...prevUrls, ...newPreviewUrls]);
    
    // Update form value - for now, we're just storing the file objects
    // In a real app, you would likely upload these and store URLs
    form.setValue(fieldName, [...newPreviewUrls], { 
      shouldValidate: true,
      shouldDirty: true
    });
  };

  const clearImage = (index: number) => {
    // Revoke object URL to prevent memory leaks
    if (previewUrls[index].startsWith('blob:')) {
      URL.revokeObjectURL(previewUrls[index]);
    }
    
    // Remove the preview
    const newUrls = previewUrls.filter((_, i) => i !== index);
    setPreviewUrls(newUrls);
    
    // Update form value
    form.setValue(fieldName, newUrls, {
      shouldValidate: true,
      shouldDirty: true
    });
  };

  const clearAllImages = () => {
    // Revoke all object URLs
    previewUrls.forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
    
    // Clear all previews
    setPreviewUrls([]);
    
    // Update form value
    form.setValue(fieldName, [], {
      shouldValidate: true,
      shouldDirty: true
    });
  };

  return {
    previewUrls,
    handleFileChange,
    clearImage,
    clearAllImages
  };
};
