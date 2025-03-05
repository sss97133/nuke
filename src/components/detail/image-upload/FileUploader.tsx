import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { XCircle } from 'lucide-react';
import { ImagePreview } from './ImagePreview';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  acceptedFileTypes?: string[];
  maxFiles?: number;
  selectedFiles: File[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
}

export function FileUploader({
  onFilesSelected,
  acceptedFileTypes = ['image/*', 'application/pdf'],
  maxFiles = 5,
  selectedFiles,
  setSelectedFiles
}: FileUploaderProps) {
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);

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
    accept: acceptedFileTypes.reduce((acc, type) => {
      acc[type] = [];
      return acc;
    }, {} as Record<string, string[]>),
    maxFiles: maxFiles - selectedFiles.length,
    disabled: selectedFiles.length >= maxFiles
  });

  return (
    <div className="w-full space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-primary bg-primary/10'
            : 'border-gray-300 dark:border-gray-700 hover:border-primary'
        } ${selectedFiles.length >= maxFiles ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="text-4xl">📁</div>
          <div className="font-medium">
            {isDragActive
              ? 'Drop the files here...'
              : `Drag & drop files here, or click to select files`}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Accepted file types: {acceptedFileTypes.join(', ')}
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
              <Card key={`${file.name}-${index}`} className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div className="truncate mr-2 text-sm font-medium">{file.name}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-full"
                      onClick={() => removeFile(file)}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <ImagePreview file={file} />
                  
                  <div className="mt-2 text-xs text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                </CardContent>
              </Card>
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
