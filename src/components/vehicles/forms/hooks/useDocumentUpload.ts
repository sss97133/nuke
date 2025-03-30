import { useState, useCallback } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';

interface UseDocumentUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  field: keyof VehicleFormValues;
  maxFiles?: number;
  maxSize?: number; // in bytes
  onValidationError?: (message: string) => void;
  onSuccess?: (count: number) => void;
}

/**
 * Custom hook for handling document uploads in forms
 * 
 * This hook manages the state and validation of file uploads,
 * and integrates with React Hook Form for form submission.
 * 
 * @example
 * ```tsx
 * const { documents, setDocuments, handleDocumentsSelected } = useDocumentUpload({
 *   form,
 *   field: 'ownership_documents',
 *   onValidationError: (message) => {
 *     toast.error(message);
 *   }
 * });
 * ```
 */
export const useDocumentUpload = ({
  form,
  field,
  maxFiles = 5,
  maxSize = 5 * 1024 * 1024, // 5MB
  onValidationError,
  onSuccess
}: UseDocumentUploadProps) => {
  const [documents, setDocuments] = useState<File[]>(() => {
    const value = form.getValues(field);
    return Array.isArray(value) && value.every(item => item instanceof File) ? value : [];
  });

  /**
   * Format file size to a human-readable string
   */
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }, []);
  
  /**
   * Handle selected files, validate them, and update the form
   */
  const handleDocumentsSelected = useCallback((files: File[]) => {
    try {
      // Track valid files and validation errors
      const validFiles: File[] = [];
      const errors: string[] = [];
      
      // Check file size for each file
      files.forEach(file => {
        if (file.size > maxSize) {
          errors.push(`"${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}`);
        } else {
          validFiles.push(file);
        }
      });
      
      // Check if adding new files would exceed the max limit
      if (validFiles.length > 0 && documents.length + validFiles.length > maxFiles) {
        errors.push(`You can only upload a maximum of ${maxFiles} files`);
        
        // Only add files up to the limit
        const availableSlots = maxFiles - documents.length;
        if (availableSlots > 0) {
          const filesToAdd = validFiles.slice(0, availableSlots);
          setDocuments(prev => [...prev, ...filesToAdd]);
          form.setValue(field, [...documents, ...filesToAdd] as VehicleFormValues[typeof field]);
          
          if (onSuccess) {
            onSuccess(filesToAdd.length);
          }
        }
      } else if (validFiles.length > 0) {
        // Add all valid files
        setDocuments(prev => [...prev, ...validFiles]);
        form.setValue(field, [...documents, ...validFiles] as VehicleFormValues[typeof field]);
        
        if (onSuccess) {
          onSuccess(validFiles.length);
        }
      }
      
      // Report errors if any
      if (errors.length > 0 && onValidationError) {
        onValidationError(errors.join('. '));
      }
    } catch (error) {
      console.error('Error processing files:', error);
      if (onValidationError) {
        onValidationError('An unexpected error occurred while processing files');
      }
    }
  }, [documents, maxFiles, maxSize, form, field, formatFileSize, onValidationError, onSuccess]);
  
  /**
   * Clear all documents from the form
   */
  const clearDocuments = useCallback(() => {
    setDocuments([]);
    form.setValue(field, [] as VehicleFormValues[typeof field]);
  }, [form, field]);
  
  /**
   * Set documents and update the form
   */
  const updateDocuments = useCallback((files: File[]) => {
    setDocuments(files);
    form.setValue(field, files as VehicleFormValues[typeof field]);
  }, [form, field]);

  return {
    documents,
    setDocuments: updateDocuments,
    handleDocumentsSelected,
    clearDocuments,
    isAtMaxCapacity: documents.length >= maxFiles
  };
};
