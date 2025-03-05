
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { XCircle, Upload } from 'lucide-react';

// Updated interface to handle both versions of the component
interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  acceptedFileTypes?: string[];
  maxFiles?: number;
  maxSize?: number;
  disabled?: boolean;
  selectedFiles: File[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
}

export function FileUploader({
  onFilesSelected,
  acceptedFileTypes = ['image/*', 'application/pdf'],
  maxFiles = 5,
  maxSize = 5 * 1024 * 1024, // 5MB
  disabled = false,
  selectedFiles,
  setSelectedFiles
}: FileUploaderProps) {
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);

  // Create an accept object from the acceptedFileTypes array
  const accept = acceptedFileTypes.reduce((acc, type) => {
    acc[type] = [];
    return acc;
  }, {} as Record<string, string[]>);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejected: any) => {
      // Filter out duplicate files
      const uniqueFiles = acceptedFiles.filter(
        file => !selectedFiles.some(f => f.name === file.name && f.size === file.size)
      );

      // Check if adding new files would exceed the max limit
      if (selectedFiles.length + uniqueFiles.length > maxFiles) {
        alert(`You can only upload a maximum of ${maxFiles} files.`);
        return;
      }

      if (uniqueFiles.length > 0) {
        const newFiles = [...selectedFiles, ...uniqueFiles];
        setSelectedFiles(newFiles);
        onFilesSelected(newFiles);
      }

      if (rejected.length > 0) {
        setRejectedFiles(prevRejected => [...prevRejected, ...rejected]);
      }
    },
    [selectedFiles, maxFiles, onFilesSelected, setSelectedFiles]
  );

  const removeFile = (fileToRemove: File) => {
    const updatedFiles = selectedFiles.filter(file => file !== fileToRemove);
    setSelectedFiles(updatedFiles);
    onFilesSelected(updatedFiles);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: maxFiles - selectedFiles.length,
    maxSize,
    disabled: disabled || selectedFiles.length >= maxFiles,
    multiple: maxFiles > 1
  });

  return (
    <div className="w-full space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-primary bg-primary/10'
            : 'border-gray-300 dark:border-gray-700 hover:border-primary'
        } ${(disabled || selectedFiles.length >= maxFiles) ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center space-y-2">
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div className="font-medium">
            {isDragActive
              ? 'Drop the files here...'
              : `Drag & drop files here, or click to select files`}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Accepted file types: {acceptedFileTypes.join(', ')}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Files up to {Math.round(maxSize / (1024 * 1024))}MB
            {maxFiles > 1 ? ` (max ${maxFiles} files)` : ''}
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
          <h3 className="font-medium">Selected Files ({selectedFiles.length}/{maxFiles})</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {selectedFiles.map((file, index) => (
              <FilePreview key={`${file.name}-${index}`} file={file} onRemove={removeFile} />
            ))}
          </div>
        </div>
      )}

      {rejectedFiles.length > 0 && (
        <div className="text-red-500 text-sm">
          <p>Some files were rejected:</p>
          <ul className="list-disc list-inside">
            {rejectedFiles.map((file, index) => (
              <li key={index}>{file.name} - Invalid file type or exceeded limit</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface FilePreviewProps {
  file: File;
  onRemove: (file: File) => void;
}

function FilePreview({ file, onRemove }: FilePreviewProps) {
  const [preview, setPreview] = useState<string | null>(null);

  React.useEffect(() => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    
    // Cleanup
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [file]);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex justify-between items-start mb-2">
          <div className="truncate mr-2 text-sm font-medium">{file.name}</div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full"
            onClick={() => onRemove(file)}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="relative aspect-video bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden">
          {file.type.startsWith('image/') && preview ? (
            <img
              src={preview}
              alt={file.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              {file.type.includes('pdf') ? (
                <span>📄 PDF Document</span>
              ) : (
                <span>📄 {file.type || 'Unknown file'}</span>
              )}
            </div>
          )}
        </div>
        
        <div className="mt-2 text-xs text-gray-500">
          {(file.size / 1024).toFixed(1)} KB
        </div>
      </CardContent>
    </Card>
  );
}

export default FileUploader;
