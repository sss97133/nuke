import { useState, useCallback } from 'react';
import { UseFormReturn, Path, FieldValues } from 'react-hook-form';
import { VehicleFormValues } from '../../../types';
import { usePreviewManagement } from './usePreviewManagement';
import { useFileValidation } from './useFileValidation';
import { useToast } from '@/hooks/use-toast';
import { uploadFileToSupabase, removeFileFromSupabase } from '@/lib/storage';
import { supabase } from '@/integrations/supabase/client';

interface UseFileUploadProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
  vehicleId?: string;
}

// Define the structure stored in the form field (URL and Path)
interface StoredImage {
  url: string;
  path: string;
}

// Define the expected value type in the form for the image field
type ImageFieldValue = StoredImage | StoredImage[] | null | undefined;

export const useFileUpload = <T extends VehicleFormValues>({
  form,
  name,
  multiple = false,
  maxSize = 5 * 1024 * 1024, // 5MB
  maxFiles = 10,
  vehicleId
}: UseFileUploadProps<T>) => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { previewUrls, createPreviews, removePreview, clearPreviews } = usePreviewManagement();
  const { validateFiles } = useFileValidation();
  const [userId, setUserId] = useState<string | null>(null);

  // Fetch user ID on mount
  useCallback(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id || null);
    });
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    processFiles(files);
  };

  const processFiles = async (filesInput: FileList) => {
    const isValid = validateFiles(filesInput, {
      maxSize,
      maxFiles: multiple ? maxFiles : 1,
      allowedTypes: ['image/']
    });
    if (!isValid) return;

    setIsUploading(true);
    createPreviews(filesInput, multiple);
    const fileArray = Array.from(filesInput);

    try {
      const currentUserId = userId || 'anonymous'; // Fallback user ID
      const targetVehicleId = vehicleId || 'new'; // Use 'new' if no ID yet
      
      const uploadPromises = fileArray.map(file => {
        // Construct a more structured path
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-_]/g, '_');
        const filePath = `vehicles/${targetVehicleId}/${currentUserId}/${Date.now()}-${sanitizedFileName}`;
        return uploadFileToSupabase(file, 'vehicle-uploads', filePath);
      });

      const results = await Promise.all(uploadPromises);
      
      const successfulUploads: StoredImage[] = results
        .filter(r => !r.error && r.publicUrl && r.path)
        .map(r => ({ url: r.publicUrl as string, path: r.path as string })); // Store URL and Path
        
      const failedUploads = results.filter(r => r.error);

      if (failedUploads.length > 0) {
        console.error('Some files failed to upload:', failedUploads);
        toast({
          title: 'Upload Error',
          description: `${failedUploads.length} file(s) failed to upload. Please try again.`,
          variant: 'destructive',
        });
      }

      if (successfulUploads.length > 0) {
        const currentValues = form.getValues(name) as ImageFieldValue;
        let newValue: StoredImage | StoredImage[];

        if (multiple) {
          const existingImages = Array.isArray(currentValues) ? currentValues : [];
          newValue = [...existingImages, ...successfulUploads];
        } else {
          newValue = successfulUploads[0]; // Assign the first successful image object
        }
        form.setValue(name, newValue as any, { shouldValidate: true }); 
        toast({
          title: 'Upload Complete',
          description: `${successfulUploads.length} file(s) uploaded successfully.`,
          variant: 'default',
        });
      }
    } catch (error) {
      console.error('Error processing files:', error);
      toast({
        title: 'Upload failed',
        description: 'An unexpected error occurred during the upload process.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Refined clearImage to handle stored objects and remove from storage
  const clearImage = async (index: number) => {
    const currentValues = form.getValues(name) as ImageFieldValue;
    let imageToRemove: StoredImage | null = null;
    let newValue: StoredImage | StoredImage[] | null = null;

    if (multiple) {
      if (Array.isArray(currentValues)) {
        const tempValues = [...currentValues];
        if (index >= 0 && index < tempValues.length) {
          imageToRemove = tempValues[index];
          tempValues.splice(index, 1);
          newValue = tempValues;
        }
      }
    } else {
      if (index === 0 && currentValues && !Array.isArray(currentValues)) {
        imageToRemove = currentValues;
        newValue = null; // Set to null for single image
      }
    }
    
    form.setValue(name, newValue as any, { shouldValidate: true });
    removePreview(index); // Remove the local preview

    // If we identified an image to remove, delete from storage
    if (imageToRemove?.path) {
      const { error } = await removeFileFromSupabase('vehicle-uploads', imageToRemove.path);
      if (error) {
        console.error('Failed to remove file from storage:', error);
        toast({ title: 'Storage Error', description: 'Failed to remove image from storage.', variant: 'destructive' });
      } else {
        toast({ title: 'Image Removed', description: 'Image successfully removed from storage.' });
      }
    } else {
      console.warn('Could not determine storage path for image removal at index:', index);
    }
  };

  // Refined clearAllImages
  const clearAllImages = async () => {
    const currentValues = form.getValues(name) as ImageFieldValue;
    const pathsToRemove: string[] = [];

    if (multiple && Array.isArray(currentValues)) {
      pathsToRemove.push(...currentValues.map(img => img.path).filter(p => !!p));
      form.setValue(name, [] as any, { shouldValidate: true });
    } else if (!multiple && currentValues && !Array.isArray(currentValues)) {
      if(currentValues.path) pathsToRemove.push(currentValues.path);
      form.setValue(name, null as any, { shouldValidate: true });
    }
    
    clearPreviews();

    // Remove all identified files from storage
    if (pathsToRemove.length > 0) {
      console.log(`Attempting to remove ${pathsToRemove.length} files from storage...`);
      const { error } = await removeFileFromSupabase('vehicle-uploads', pathsToRemove);
      if (error) {
        console.error('Failed to remove some files from storage:', error);
        toast({ title: 'Storage Error', description: 'Failed to remove some images from storage.', variant: 'destructive' });
      } else {
        toast({ title: 'All Images Removed', description: 'All images successfully removed from storage.' });
      }
    }
  };

  // Get display URLs (handle stored objects)
  const formValue = form.watch(name) as ImageFieldValue;
  const storedUrls = Array.isArray(formValue) ? formValue.map(img => img.url) 
                   : (formValue ? [formValue.url] : []);
  const displayUrls = previewUrls.length > 0 ? previewUrls : storedUrls;

  return {
    isUploading,
    previewUrls: displayUrls, // Combine previews and stored URLs for display
    handleFileChange,
    processFiles,
    clearImage,
    clearAllImages
  };
};
