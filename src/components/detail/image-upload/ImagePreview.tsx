import React, { useState, useEffect } from 'react';
import { FileIcon, ImageIcon, AlertTriangle } from 'lucide-react';

interface ImagePreviewProps {
  file: File;
  className?: string;
  maxPreviewSize?: number; // In pixels
  showFileName?: boolean;
}

export function ImagePreview({ 
  file, 
  className = '', 
  maxPreviewSize = 300,
  showFileName = false
}: ImagePreviewProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset state when file changes
    setLoading(true);
    setError(null);
    setPreview(null);
    
    // Only create preview for image files
    if (!file.type.startsWith('image/')) {
      setLoading(false);
      return;
    }
    
    const reader = new FileReader();
    
    reader.onloadstart = () => {
      setLoading(true);
    };
    
    reader.onloadend = () => {
      setLoading(false);
      setPreview(reader.result as string);
    };
    
    reader.onerror = () => {
      setLoading(false);
      setError('Failed to load image preview');
      console.error('Error reading file:', reader.error);
    };
    
    try {
      reader.readAsDataURL(file);
    } catch (e) {
      setLoading(false);
      setError('Failed to read file');
      console.error('Error initiating file read:', e);
    }
    
    // Cleanup function
    return () => {
      reader.abort(); // Cancel any pending reads when component unmounts
    };
  }, [file]);

  const getFileTypeLabel = () => {
    // Extract file extension
    const extension = file.name.split('.').pop()?.toUpperCase() || '';
    
    if (file.type.includes('pdf')) return 'PDF';
    if (file.type.includes('word') || extension === 'DOC' || extension === 'DOCX') return 'DOC';
    if (file.type.includes('excel') || extension === 'XLS' || extension === 'XLSX') return 'XLS';
    if (file.type.includes('powerpoint') || extension === 'PPT' || extension === 'PPTX') return 'PPT';
    if (file.type.includes('text') || extension === 'TXT') return 'TXT';
    
    // Return extension for other types
    return extension || file.type.split('/').pop() || 'FILE';
  };

  return (
    <div 
      className={`relative aspect-video bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden ${className}`}
      aria-label={`Preview of ${file.name}`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse flex flex-col items-center">
            <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin mb-2" />
            <span className="text-xs text-gray-500">Loading preview...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center text-red-500">
            <AlertTriangle className="h-8 w-8 mb-2" />
            <span className="text-xs">Error loading preview</span>
          </div>
        </div>
      )}
      
      {!loading && !error && (
        <>
          {file.type.startsWith('image/') && preview ? (
            <div className="w-full h-full relative">
              <img
                src={preview}
                alt={file.name}
                className="w-full h-full object-contain"
                style={{ maxHeight: `${maxPreviewSize}px`, maxWidth: `${maxPreviewSize}px` }}
                onError={() => setError('Failed to display image')}
              />
              {showFileName && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs py-1 px-2 truncate">
                  {file.name}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-4 text-gray-500">
              {file.type.includes('pdf') ? (
                <FileIcon className="h-12 w-12 mb-2" />
              ) : (
                <div className="flex flex-col items-center">
                  <div className="bg-gray-200 dark:bg-gray-700 rounded p-2 mb-2">
                    <span className="font-medium text-sm">{getFileTypeLabel()}</span>
                  </div>
                  <span className="text-sm mt-1 truncate max-w-full">
                    {showFileName ? file.name : getFileTypeLabel() + ' Document'}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
