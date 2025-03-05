
import React, { useCallback, useState } from 'react';
import { useDropzone, DropzoneOptions } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Upload, Image } from 'lucide-react';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  accept?: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number;
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  onFilesSelected,
  accept = {
    'image/*': ['.jpeg', '.jpg', '.png', '.webp']
  },
  maxFiles = 5,
  maxSize = 5 * 1024 * 1024, // 5MB
  disabled = false
}) => {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  
  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Create preview URLs
    const newPreviewUrls = acceptedFiles.map(file => URL.createObjectURL(file));
    setPreviewUrls(prevUrls => [...prevUrls, ...newPreviewUrls]);
    
    // Pass files up to parent
    onFilesSelected(acceptedFiles);
  }, [onFilesSelected]);
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles,
    maxSize,
    disabled,
    multiple: maxFiles > 1
  } as DropzoneOptions);
  
  return (
    <div className="space-y-4">
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
          ${isDragActive ? 'border-primary bg-primary/10' : 'border-gray-300 hover:border-primary/50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        <div className="flex flex-col items-center justify-center space-y-2">
          <Upload className="h-10 w-10 text-muted-foreground" />
          
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {isDragActive ? 'Drop files here...' : 'Drag & drop files here or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground">
              {accept['image/*'] ? 'Images' : 'Files'} up to {Math.round(maxSize / (1024 * 1024))}MB
              {maxFiles > 1 ? ` (max ${maxFiles} files)` : ''}
            </p>
          </div>
        </div>
      </div>
      
      {/* Image previews */}
      {previewUrls.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {previewUrls.map((url, index) => (
            <div key={index} className="relative aspect-square rounded-md overflow-hidden">
              <img src={url} alt={`Preview ${index + 1}`} className="w-full h-full object-cover" />
              <Button
                size="sm"
                variant="destructive"
                className="absolute top-1 right-1 h-6 w-6 p-0 rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  URL.revokeObjectURL(url);
                  setPreviewUrls(prevUrls => prevUrls.filter(prevUrl => prevUrl !== url));
                }}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUploader;
