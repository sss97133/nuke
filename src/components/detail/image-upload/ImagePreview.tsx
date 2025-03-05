import React, { useState, useEffect } from 'react';

interface ImagePreviewProps {
  file: File;
}

export function ImagePreview({ file }: ImagePreviewProps) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    // Only create preview for image files
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    
    // Cleanup function to prevent memory leaks
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [file, preview]);

  return (
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
  );
}
