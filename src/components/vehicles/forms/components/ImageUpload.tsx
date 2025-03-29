import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { ImageUpload as SharedImageUpload } from '@/components/shared/ImageUpload';

interface ImageUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  name: keyof VehicleFormValues;
  label: string;
  description?: string;
  multiple?: boolean;
  maxSize?: number;
  maxFiles?: number;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  form,
  name,
  label,
  description,
  multiple = false,
  maxSize,
  maxFiles
}) => {
  return (
    <SharedImageUpload
      form={form}
      name={name}
      label={label}
      description={description}
      multiple={multiple}
      maxSize={maxSize}
      maxFiles={maxFiles}
    />
  );
};
