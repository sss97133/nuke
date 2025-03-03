
import React from 'react';
import { GalleryImagesProps } from './types';
import { GalleryImageItem } from './GalleryImageItem';
import { EmptyGallery } from './EmptyGallery';

export const GalleryImages: React.FC<GalleryImagesProps> = ({ images, onOpenUploadModal }) => {
  if (images.length === 0) {
    return <EmptyGallery onOpenUploadModal={onOpenUploadModal} />;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {images.map((image) => (
        <GalleryImageItem 
          key={image.id} 
          image={image} 
          vehicleName={`${image.type}`} 
        />
      ))}
    </div>
  );
};
