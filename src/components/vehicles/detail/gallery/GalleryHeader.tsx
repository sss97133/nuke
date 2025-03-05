
import React from 'react';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import { GalleryHeaderProps } from './types';

export const GalleryHeader: React.FC<GalleryHeaderProps> = ({ 
  vehicle, 
  totalImages,
  onOpenUploadModal 
}) => {
  return (
    <div className="flex justify-between items-center mb-6">
      <div>
        <h2 className="text-2xl font-bold">
          {vehicle.year} {vehicle.make} {vehicle.model} Gallery
        </h2>
        <p className="text-muted-foreground">
          {totalImages} {totalImages === 1 ? 'image' : 'images'}
        </p>
      </div>
      <Button 
        onClick={onOpenUploadModal}
        variant="outline"
      >
        <Upload className="mr-2 h-4 w-4" />
        Add Images
      </Button>
    </div>
  );
};
