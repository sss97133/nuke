import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { XCircle, Upload, AlertCircle } from 'lucide-react';
import { ImagePreview } from './ImagePreview';
import { useToast } from '@/hooks/use-toast';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  acceptedFileTypes?: string[];
  maxFiles?: number;
  maxFileSize?: number; // Size in bytes (default 5MB)
  selectedFiles: File[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  disabled?: boolean;
  ariaLabel?: string;
}

export function FileUploader({
  onFilesSelected,
  acceptedFileTypes = ['image/*', 'application/pdf'],
  maxFiles = 5,
  maxFileSize = 5 * 1024 * 1024, // 5MB
  selectedFiles,
  setSelectedFiles,
  disabled = false,
  ariaLabel = 'File uploader'
}: FileUploaderProps) {
  const [rejectedFiles, setRejectedFiles] = useState<Array<{file: File, reason: string}>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const { toast } = useToast();

  const isAtMaxCapacity = selectedFiles.length >= maxFiles;
  const isDisabled = disabled || isAtMaxCapacity;

  // Format file size to a readable string
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }, []);

  // Validate a single file
  const validateFile = useCallback((file: File): { valid: boolean; reason?: string } => {
    // Check file size
    if (file.size > maxFileSize) {
      return { 
        valid: false, 
        reason: `Size exceeds ${formatFileSize(maxFileSize)}` 
      };
    }

    // Check file type
    const isValidType = acceptedFileTypes.some(type => {
      if (type.endsWith('/*')) {
        const category = type.split('/')[0];
        return file.type.startsWith(`${category}/`);
      }
      return file.type === type;
    });

    if (!isValidType) {
      return { 
        valid: false, 
        reason: 'Invalid file type' 
      };
    }

    // Check for duplicate (by name and size)
    if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
      return { 
        valid: false, 
        reason: 'Duplicate file' 
      };
    }

    return { valid: true };
  }, [acceptedFileTypes, maxFileSize, formatFileSize, selectedFiles]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const files = Array.from(e.target.files);
    processFiles(files);
    
    // Reset the input value so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);
  
  const processFiles = useCallback((files: File[]) => {
    try {
      setIsProcessing(true);
      const newRejectedFiles: Array<{file: File, reason: string}> = [];
      const validFiles: File[] = [];
      
      // Validate all files
      files.forEach(file => {
        const validation = validateFile(file);
        if (validation.valid) {
          validFiles.push(file);
        } else {
          newRejectedFiles.push({ file, reason: validation.reason || 'Unknown error' });
        }
      });
      
      // Check if adding new files would exceed the max limit
      if (selectedFiles.length + validFiles.length > maxFiles) {
        toast({
          title: "Too many files",
          description: `You can only upload a maximum of ${maxFiles} files.`,
          variant: "destructive",
        });
        
        // Only add files up to the limit
        const availableSlots = maxFiles - selectedFiles.length;
        const filesToAdd = validFiles.slice(0, availableSlots);
        
        if (filesToAdd.length > 0) {
          const newFiles = [...selectedFiles, ...filesToAdd];
          setSelectedFiles(newFiles);
          onFilesSelected(newFiles);
        }
        
        // Add the rest to rejected
        validFiles.slice(availableSlots).forEach(file => {
          newRejectedFiles.push({ file, reason: 'Exceeds maximum file count' });
        });
      } else if (validFiles.length > 0) {
        const newFiles = [...selectedFiles, ...validFiles];
        setSelectedFiles(newFiles);
        onFilesSelected(newFiles);
        
        if (validFiles.length > 0) {
          toast({
            title: "Files Added",
            description: `Added ${validFiles.length} file${validFiles.length > 1 ? 's' : ''} successfully.`,
            variant: "default",
          });
        }
      }
      
      if (newRejectedFiles.length > 0) {
        setRejectedFiles(prev => [...prev, ...newRejectedFiles]);
        
        if (newRejectedFiles.length > 0) {
          toast({
            title: "Some files were rejected",
            description: `${newRejectedFiles.length} file${newRejectedFiles.length > 1 ? 's were' : ' was'} invalid.`,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error('Error processing files:', error);
      toast({
        title: "Error",
        description: "There was a problem processing your files. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [validateFile, selectedFiles, maxFiles, onFilesSelected, toast, setSelectedFiles]);
  
  const removeFile = useCallback((fileToRemove: File) => {
    const updatedFiles = selectedFiles.filter(file => file !== fileToRemove);
    setSelectedFiles(updatedFiles);
    onFilesSelected(updatedFiles);
    
    toast({
      title: "File Removed",
      description: `"${fileToRemove.name}" has been removed.`,
      variant: "default",
    });
  }, [selectedFiles, setSelectedFiles, onFilesSelected, toast]);
  
  const clearRejectedFiles = useCallback(() => {
    setRejectedFiles([]);
  }, []);
  
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDisabled) {
      setIsDragActive(true);
    }
  }, [isDisabled]);
  
  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);
  
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (isDisabled) return;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    }
  }, [isDisabled, processFiles]);

  const handleBrowseClick = useCallback(() => {
    if (!isDisabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [isDisabled]);

  return (
    <div 
      className="w-full space-y-4"
      aria-label={ariaLabel}
      aria-busy={isProcessing}
    >
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors relative ${
          isDragActive
            ? 'border-primary bg-primary/10'
            : isDisabled
              ? 'border-gray-300 bg-gray-100 dark:bg-gray-800 cursor-not-allowed'
              : 'border-gray-300 dark:border-gray-700 hover:border-primary cursor-pointer'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        tabIndex={isDisabled ? -1 : 0}
        role="button"
        aria-disabled={isDisabled}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isDisabled) {
            handleBrowseClick();
          }
        }}
        data-testid="file-drop-area"
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
          accept={acceptedFileTypes.join(',')}
          multiple={maxFiles > 1}
          disabled={isDisabled}
          aria-hidden="true"
        />
        
        {isProcessing && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg z-10">
            <div className="animate-pulse text-primary">Processing files...</div>
          </div>
        )}
        
        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="text-4xl" aria-hidden="true">
            {isDisabled ? '🔒' : '📁'}
          </div>
          <div className="font-medium">
            {isDragActive
              ? 'Drop the files here...'
              : isDisabled
                ? `Maximum of ${maxFiles} files reached`
                : `Drag & drop files here, or click to select files`}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Accepted file types: {acceptedFileTypes.join(', ')}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Maximum file size: {formatFileSize(maxFileSize)}
          </p>
          {selectedFiles.length > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {selectedFiles.length} of {maxFiles} files selected
            </p>
          )}
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium" id="selected-files-heading">
            Selected Files ({selectedFiles.length}/{maxFiles})
          </h3>
          
          <div 
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            role="list" 
            aria-labelledby="selected-files-heading"
          >
            {selectedFiles.map((file, index) => (
              <Card 
                key={`${file.name}-${index}`} 
                className="overflow-hidden"
                role="listitem"
              >
                <CardContent className="p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div className="truncate mr-2 text-sm font-medium">{file.name}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(file);
                      }}
                      aria-label={`Remove ${file.name}`}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <ImagePreview file={file} />
                  
                  <div className="mt-2 text-xs text-gray-500">
                    {formatFileSize(file.size)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {rejectedFiles.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4 mt-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-red-400" aria-hidden="true" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-400" id="rejected-files-heading">
                Files not uploaded
              </h3>
              <div className="mt-2">
                <ul 
                  className="list-disc pl-5 space-y-1 text-sm text-red-700 dark:text-red-300"
                  role="list" 
                  aria-labelledby="rejected-files-heading"
                >
                  {rejectedFiles.map((item, index) => (
                    <li key={index}>
                      {item.file.name} - {item.reason}
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearRejectedFiles}
                    className="text-red-600 border-red-600 hover:bg-red-50 dark:text-red-400 dark:border-red-400 dark:hover:bg-red-900/20"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
