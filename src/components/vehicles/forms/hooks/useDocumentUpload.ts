import { useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { useToast } from '@/hooks/use-toast';

interface UseDocumentUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  field: keyof VehicleFormValues;
  maxFiles?: number;
  maxSize?: number; // in bytes
}

export const useDocumentUpload = ({
  form,
  field,
  maxFiles = 5,
  maxSize = 5 * 1024 * 1024 // 5MB
}: UseDocumentUploadProps) => {
  const [documents, setDocuments] = useState<File[]>([]);
  const { toast } = useToast();
  
  const handleDocumentsSelected = (files: File[]) => {
    // Check file size
    const invalidFiles = files.filter(file => file.size > maxSize);
    if (invalidFiles.length > 0) {
      toast({
        title: "Files too large",
        description: `Some files exceed the maximum size of ${maxSize / (1024 * 1024)}MB`,
        variant: "destructive",
      });
      
      // Filter out invalid files
      const validFiles = files.filter(file => file.size <= maxSize);
      setDocuments(validFiles);
      form.setValue(field as any, validFiles);
      return;
    }
    
    setDocuments(files);
    form.setValue(field as any, files);
  };
  
  return {
    documents,
    setDocuments,
    handleDocumentsSelected
  };
};
