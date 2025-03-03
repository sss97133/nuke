
import React from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { FileUploader } from './FileUploader';
import { ImageTypeSelect } from './ImageTypeSelect';
import { DescriptionInput } from './DescriptionInput';
import { ImagePreview } from './ImagePreview';
import { ModalFooter } from './ModalFooter';
import { useImageUpload } from './useImageUpload';
import { ImageUploadModalProps } from './types';

export const ImageUploadModal: React.FC<ImageUploadModalProps> = ({
  open,
  onOpenChange,
  onUpload,
  vehicleInfo
}) => {
  const {
    selectedFiles,
    previewUrls,
    imageType,
    setImageType,
    description,
    setDescription,
    handleFileChange,
    handleSubmit,
    resetForm,
    removePreview,
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
          
          <FileUploader handleFileChange={handleFileChange} />
          
          <ImagePreview 
            previewUrls={previewUrls} 
            removePreview={removePreview} 
          />
          
          <div className="bg-muted p-3 rounded-md">
            <p className="text-sm">
              <strong>Note:</strong> Uploaded images will be reviewed for quality and relevance 
              before being fully published. Images from verified users or PTZ garages 
              are prioritized in the verification process.
            </p>
          </div>
        </div>

        <ModalFooter 
          handleSubmit={handleSubmit} 
          hasSelectedFiles={selectedFiles !== null && selectedFiles.length > 0}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
};
