
import React from 'react';
import { GalleryImagesProps } from './types';
import { GalleryImageItem } from './GalleryImageItem';
import { EmptyGallery } from './EmptyGallery';

export const GalleryImages: React.FC<GalleryImagesProps> = ({ images, onOpenUploadModal }) => {
  if (images.length === 0) {
    return <EmptyGallery onOpenUploadModal={onOpenUploadModal} />;
  }

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Featured/main image */}
      {images.length > 0 && (
        <div className="w-full aspect-video overflow-hidden rounded-lg">
          <img 
            src={images[0].url} 
            alt={`${images[0].type}`}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      
      {/* Gallery grid - improved mobile layout */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
        {images.map((image, index) => (
          index === 0 ? null : (
            <GalleryImageItem 
              key={image.id} 
              image={image} 
              vehicleName={`${image.type}`} 
            />
          )
        ))}
      </div>
    </div>
  );
};
