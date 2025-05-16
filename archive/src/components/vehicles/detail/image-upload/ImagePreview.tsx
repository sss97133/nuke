
import React from 'react';
import { X } from 'lucide-react';
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ImagePreviewProps } from './types';
import { ScrollArea } from "@/components/ui/scroll-area";

export const ImagePreview: React.FC<ImagePreviewProps> = ({ previewUrls, removePreview }) => {
  if (previewUrls.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label>Selected Images ({previewUrls.length})</Label>
      <ScrollArea className="h-[180px] rounded-md border">
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-2">
          {previewUrls.map((url, index) => (
            <div key={index} className="relative aspect-square rounded-md overflow-hidden group">
              <img 
                src={url} 
                alt={`Preview ${index}`} 
                className="object-cover w-full h-full"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={() => removePreview(index)}
                className="absolute top-1 right-1 h-6 w-6 bg-black/70 hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3 text-white" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
