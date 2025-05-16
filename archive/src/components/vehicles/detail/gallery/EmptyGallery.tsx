
import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import { EmptyGalleryProps } from './types';

export const EmptyGallery: React.FC<EmptyGalleryProps> = ({ vehicle, onOpenUploadModal }) => {
  return (
    <Card className="p-6">
      <div className="text-center py-12 space-y-4">
        <h3 className="text-lg font-medium">No Images Yet</h3>
        <p className="text-muted-foreground max-w-md mx-auto">
          {vehicle.make && vehicle.model ? 
            `There are no images for your ${vehicle.year} ${vehicle.make} ${vehicle.model} yet.` : 
            "There are no images for this vehicle yet."}
        </p>
        <Button 
          onClick={onOpenUploadModal} 
          className="mt-4"
        >
          <Upload className="mr-2 h-4 w-4" />
          Upload Images
        </Button>
      </div>
    </Card>
  );
};
