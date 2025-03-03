
import React from 'react';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

// Import refactored components
import { ICloudLinkInput } from './components/icloud-modal/ICloudLinkInput';
import { FileUploader } from './components/icloud-modal/FileUploader';
import { ImagePreview } from './components/icloud-modal/ImagePreview';
import { UploadProgress } from './components/icloud-modal/UploadProgress';
import { ErrorDisplay } from './components/icloud-modal/ErrorDisplay';
import { ModalActions } from './components/icloud-modal/ModalActions';
import { useICloudUpload } from './hooks/useICloudUpload';

interface ICloudImageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId?: string;
  vehicleInfo?: {
    make: string;
    model: string;
    year: number | string;
  };
  onConnect: (data: {
    vehicleId: string; 
    icloudLink?: string;
    icloudFolderId?: string;
    uploadedImages?: string[];
  }) => void;
}

export const ICloudImageModal: React.FC<ICloudImageModalProps> = ({
  open,
  onOpenChange,
  vehicleId,
  vehicleInfo,
  onConnect
}) => {
  const {
    sharedAlbumLink,
    setSharedAlbumLink,
    selectedFiles,
    isUploading,
    uploadProgress,
    error,
    linkValidation,
    validateLink,
    handleFileChange,
    handleConnect
  } = useICloudUpload({
    vehicleId,
    vehicleInfo,
    onConnect: (data) => {
      onConnect(data);
      onOpenChange(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect Vehicle Images</DialogTitle>
          <DialogDescription>
            {vehicleInfo 
              ? `Add images for your ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`
              : 'Connect images to your vehicle'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* iCloud Shared Album Input */}
          <ICloudLinkInput 
            sharedAlbumLink={sharedAlbumLink}
            setSharedAlbumLink={setSharedAlbumLink}
            linkValidation={linkValidation}
            validateLink={validateLink}
          />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          {/* File Upload Option */}
          <FileUploader handleFileChange={handleFileChange} />

          {/* Image Preview */}
          <ImagePreview selectedFiles={selectedFiles} />

          {/* Upload Progress */}
          <UploadProgress isUploading={isUploading} uploadProgress={uploadProgress} />

          {/* Error Message */}
          <ErrorDisplay error={error} />
        </div>

        <DialogFooter>
          <ModalActions handleConnect={handleConnect} isUploading={isUploading} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
