import React from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { ImageUpload } from '@/components/shared/ImageUpload';
import { ImageTypeSelect } from './ImageTypeSelect';
import { DescriptionInput } from './DescriptionInput';
import { ModalFooter } from './ModalFooter';
import { useImageUpload } from './useImageUpload';
import { ImageUploadModalProps } from './types';
import { Loader2 } from 'lucide-react';

export const ImageUploadModal: React.FC<ImageUploadModalProps> = ({
  open,
  onOpenChange,
  onUpload,
  vehicleInfo,
  isLoading = false,
}) => {
  const {
    imageType,
    setImageType,
    description,
    setDescription,
    handleSubmit,
    resetForm,
  } = useImageUpload(onUpload);

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) resetForm();
      onOpenChange(newOpen);
    }}>
      <DialogContent className="w-[95vw] max-w-md md:max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle>Upload Vehicle Images</DialogTitle>
          <DialogDescription>
            {vehicleInfo 
              ? `Add images for ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`
              : 'Share your vehicle pictures with the community'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          <ImageTypeSelect 
            imageType={imageType} 
            setImageType={setImageType} 
          />
          
          <DescriptionInput 
            description={description} 
            setDescription={setDescription} 
          />
          
          <ImageUpload
            multiple
            maxFiles={10}
            maxSize={10 * 1024 * 1024} // 10MB
            onUploadComplete={(urls) => {
              if (urls.length > 0) {
                handleSubmit(urls, imageType, description);
              }
            }}
            onError={(error) => {
              console.error('Image upload error:', error);
            }}
          />
          
          <div className="bg-muted p-3 rounded-md">
            <p className="text-sm">
              <strong>Note:</strong> Images will be associated with this vehicle and visible in the gallery.
              You can add more images at any time from the vehicle detail page.
            </p>
          </div>
        </div>

        <ModalFooter 
          handleSubmit={() => handleSubmit([], imageType, description)}
          hasSelectedFiles={false}
          onOpenChange={onOpenChange}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  );
};
