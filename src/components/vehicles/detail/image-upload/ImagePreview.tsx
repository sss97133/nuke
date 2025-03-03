
import React from 'react';
import { X } from 'lucide-react';
import { Label } from "@/components/ui/label";
import { ImagePreviewProps } from './types';

export const ImagePreview: React.FC<ImagePreviewProps> = ({ previewUrls, removePreview }) => {
  if (previewUrls.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label>Selected Images ({previewUrls.length})</Label>
      <div className="grid grid-cols-3 gap-2">
        {previewUrls.map((url, index) => (
          <div key={index} className="relative aspect-square rounded-md overflow-hidden group">
            <img 
              src={url} 
              alt={`Preview ${index}`} 
              className="object-cover w-full h-full"
            />
            <button
              type="button"
              onClick={() => removePreview(index)}
              className="absolute top-1 right-1 bg-black/50 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4 text-white" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
