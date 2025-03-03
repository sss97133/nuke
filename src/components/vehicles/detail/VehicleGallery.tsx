
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { useGalleryData } from './gallery/useGalleryData';
import { GalleryHeader } from './gallery/GalleryHeader';
import { GalleryImages } from './gallery/GalleryImages';
import { ImageUploadModal } from './image-upload/ImageUploadModal';
import { VehicleGalleryProps } from './gallery/types';

const VehicleGallery: React.FC<VehicleGalleryProps> = ({ vehicle }) => {
  const { 
    images, 
    isUploadModalOpen, 
    setIsUploadModalOpen, 
    handleImageUpload 
  } = useGalleryData(vehicle);

  return (
    <Card>
      <GalleryHeader onOpenUploadModal={() => setIsUploadModalOpen(true)} />
      
      <CardContent>
        <GalleryImages 
          images={images} 
          onOpenUploadModal={() => setIsUploadModalOpen(true)} 
        />
      </CardContent>
      
      <ImageUploadModal 
        open={isUploadModalOpen} 
        onOpenChange={setIsUploadModalOpen}
        onUpload={handleImageUpload}
        vehicleInfo={{
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year
        }}
      />
    </Card>
  );
};

export default VehicleGallery;
