
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../../types';
import { useFileUpload } from './hooks/useFileUpload';

interface UseImageUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  name: keyof VehicleFormValues;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
}

export const useImageUpload = ({
  form,
  name,
  multiple = false,
  maxSize = 5 * 1024 * 1024, // 5MB
  maxFiles = 10
}: UseImageUploadProps) => {
  const {
    isUploading,
    previewUrls,
    handleFileChange,
    processFiles,
    clearImage,
    clearAllImages
  } = useFileUpload({
    form,
    name,
    multiple,
    maxSize,
    maxFiles
  });

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
