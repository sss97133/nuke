import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { XCircle, Upload } from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const files = Array.from(e.target.files);
    processFiles(files);
  };
  
  const processFiles = (files: File[]) => {
    // Filter out invalid file types
    const validFiles = files.filter(file => {
      const isValidType = acceptedFileTypes.some(type => {
        if (type.endsWith('/*')) {
          const category = type.split('/')[0];
          return file.type.startsWith(`${category}/`);
        }
        return file.type === type;
      });
      
      if (!isValidType) {
        setRejectedFiles(prev => [...prev, file]);
        return false;
      }
      
      return true;
    });
    
    // Filter out duplicate files
    const uniqueFiles = validFiles.filter(
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
  };
  
  const removeFile = (fileToRemove: File) => {
    const updatedFiles = selectedFiles.filter(file => file !== fileToRemove);
    setSelectedFiles(updatedFiles);
    onFilesSelected(updatedFiles);
  };
  
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };
  
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-primary bg-primary/10'
            : 'border-gray-300 dark:border-gray-700 hover:border-primary'
        } ${selectedFiles.length >= maxFiles ? 'opacity-50 cursor-not-allowed' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
          accept={acceptedFileTypes.join(',')}
          multiple={maxFiles > 1}
          disabled={selectedFiles.length >= maxFiles}
        />
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
