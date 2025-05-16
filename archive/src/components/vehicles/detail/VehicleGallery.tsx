
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { useGalleryData } from './gallery/useGalleryData';
import { GalleryImages } from './gallery/GalleryImages';
import { ImageUploadModal } from './image-upload/ImageUploadModal';
import { VehicleGalleryProps } from './gallery/types';
import { Upload } from 'lucide-react';
import { Button } from "@/components/ui/button";

const VehicleGallery: React.FC<VehicleGalleryProps> = ({ vehicle }) => {
  const { 
    images, 
    isLoading,
    isUploadModalOpen, 
    setIsUploadModalOpen, 
    handleImageUpload 
  } = useGalleryData(vehicle);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button 
          size="sm" 
          variant="outline"
          onClick={() => setIsUploadModalOpen(true)}
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload Images
        </Button>
      </div>
      
      <GalleryImages 
        images={images} 
        onOpenUploadModal={() => setIsUploadModalOpen(true)} 
      />
      
      <ImageUploadModal 
        open={isUploadModalOpen} 
        onOpenChange={setIsUploadModalOpen}
        onUpload={handleImageUpload}
        vehicleInfo={{
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year
        }}
        isLoading={isLoading}
      />
    </div>
  );
};

export default VehicleGallery;
