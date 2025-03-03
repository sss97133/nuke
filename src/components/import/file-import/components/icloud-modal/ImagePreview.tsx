
import React, { useEffect } from 'react';

interface ImagePreviewProps {
  selectedFiles: FileList | null;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ selectedFiles }) => {
  const previewImages = selectedFiles 
    ? Array.from(selectedFiles).map(file => URL.createObjectURL(file))
    : [];

  // Clean up object URLs when component unmounts or files change
  useEffect(() => {
    return () => {
      previewImages.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewImages]);

  if (previewImages.length === 0) return null;

  return (
    <div>
      <Label className="text-sm font-medium">Selected Images ({previewImages.length})</Label>
      <div className="grid grid-cols-4 gap-2 mt-2">
        {previewImages.map((url, index) => (
          <div key={index} className="relative aspect-square rounded-md overflow-hidden">
            <img 
              src={url} 
              alt={`Preview ${index}`} 
              className="object-cover w-full h-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// Need to import Label from UI components
import { Label } from "@/components/ui/label";
