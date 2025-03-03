
import React from 'react';
import { Camera } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { EmptyGalleryProps } from './types';

export const EmptyGallery: React.FC<EmptyGalleryProps> = ({ onOpenUploadModal }) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Camera className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No Images Available</h3>
      <p className="text-muted-foreground mb-4">
        There are no images available for this vehicle yet.
      </p>
      <Button 
        variant="outline"
        onClick={onOpenUploadModal}
      >
        Upload Images
      </Button>
    </div>
  );
};
