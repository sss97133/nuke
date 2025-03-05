
import React from 'react';
import { Card } from '@/components/ui/card';
import { GalleryImagesProps } from './types';
import { EmptyGallery } from './EmptyGallery';
import { Skeleton } from '@/components/ui/skeleton';

export const GalleryImages: React.FC<GalleryImagesProps> = ({ 
  images, 
  isLoading = false,
  onOpenUploadModal 
}) => {
  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        </div>
      </Card>
    );
  }
  
  if (!images || images.length === 0) {
    return <EmptyGallery vehicle={{make: '', model: '', year: ''}} onOpenUploadModal={onOpenUploadModal} />;
  }
  
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Gallery ({images.length} images)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((image, index) => (
            <div 
              key={index} 
              className="aspect-square rounded-md overflow-hidden border border-border hover:opacity-90 transition-opacity cursor-pointer"
            >
              <img 
                src={image.url} 
                alt={`${image.type} view`} 
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};
