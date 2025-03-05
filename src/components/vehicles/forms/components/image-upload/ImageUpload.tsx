
import React from 'react';
import { FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../../types';
import { DropZone } from './DropZone';
import { FileInput } from './FileInput';
import { ImagePreview } from './ImagePreview';
import { useImageUpload } from './useImageUpload';

interface ImageUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  name: keyof VehicleFormValues;
  label: string;
  description?: string;
  multiple?: boolean;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  form,
  name,
  label,
  description,
  multiple = false
}) => {
  const {
    displayUrls,
    isUploading,
    handleFileChange,
    processFiles,
    clearAllImages,
    clearImage
  } = useImageUpload({ form, name, multiple });
  
  return (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <div className="space-y-4">
              {/* Preview Area */}
              <ImagePreview 
                urls={displayUrls} 
                onClearAll={clearAllImages} 
                onClearImage={clearImage} 
              />
              
              {/* Upload Controls */}
              <DropZone onDrop={processFiles} isUploading={isUploading}>
                <FileInput 
                  name={name as string}
                  multiple={multiple} 
                  isUploading={isUploading} 
                  onFileChange={handleFileChange} 
                />
              </DropZone>
              
              {description && <FormDescription>{description}</FormDescription>}
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};
