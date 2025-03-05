import React from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ImagePreviewProps {
  urls: string[];
  onClearAll: () => void;
  onClearImage: (index: number) => void;
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ 
  urls, 
  onClearAll, 
  onClearImage 
}) => {
  if (urls.length === 0) return null;

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {urls.length} {urls.length === 1 ? 'file' : 'files'}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6"
          onClick={onClearAll}
        >
          Clear all
        </Button>
      </div>
      
      <ScrollArea className="h-32 border rounded-md">
        <div className="grid grid-cols-3 gap-2 p-2">
          {urls.map((url, index) => (
            <div key={index} className="relative aspect-square rounded-md overflow-hidden group">
              <img 
                src={url} 
                alt={`Document preview ${index + 1}`} 
                className="w-full h-full object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onClearImage(index)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );
};
