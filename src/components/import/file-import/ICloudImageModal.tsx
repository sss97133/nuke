
import React, { useState } from 'react';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { parseICloudSharedLink } from '@/utils/icloud';
import { supabase } from '@/integrations/supabase/client';

// Import refactored components
import { ICloudLinkInput } from './components/icloud-modal/ICloudLinkInput';
import { FileUploader } from './components/icloud-modal/FileUploader';
import { ImagePreview } from './components/icloud-modal/ImagePreview';
import { UploadProgress } from './components/icloud-modal/UploadProgress';
import { ErrorDisplay } from './components/icloud-modal/ErrorDisplay';
import { ModalActions } from './components/icloud-modal/ModalActions';

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
  const [sharedAlbumLink, setSharedAlbumLink] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [linkValidation, setLinkValidation] = useState<'valid' | 'invalid' | null>(null);

  // Validate iCloud link
  const validateLink = () => {
    try {
      if (!sharedAlbumLink) {
        setLinkValidation(null);
        return false;
      }
      
      parseICloudSharedLink(sharedAlbumLink);
      setLinkValidation('valid');
      setError(null);
      return true;
    } catch (err) {
      setLinkValidation('invalid');
      setError('Invalid iCloud shared album link format');
      return false;
    }
  };

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(e.target.files);
      setError(null);
    }
  };

  // Generate a folder ID based on vehicle info
  const generateFolderId = () => {
    if (!vehicleInfo) return '';
    return `${vehicleInfo.make}${vehicleInfo.model}${vehicleInfo.year}_FOLDER`.toUpperCase();
  };

  // Upload files to Supabase
  const uploadFiles = async () => {
    if (!selectedFiles || !vehicleId || !vehicleInfo) return [];
    
    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    
    const uploadedPaths: string[] = [];
    
    try {
      const folderPath = `vehicles/${vehicleInfo.make}_${vehicleInfo.model}_${vehicleInfo.year}`;
      
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `${folderPath}/${fileName}`;
        
        const { error } = await supabase.storage
          .from('car-images')
          .upload(filePath, file);
        
        if (error) throw error;
        
        uploadedPaths.push(filePath);
        
        // Update progress
        setUploadProgress(Math.round(((i + 1) / selectedFiles.length) * 100));
      }
      
      return uploadedPaths;
    } catch (err: any) {
      setError(`Upload error: ${err.message || 'Unknown error'}`);
      return uploadedPaths;
    } finally {
      setIsUploading(false);
    }
  };

  // Handle connect button click
  const handleConnect = async () => {
    if (!vehicleId) {
      setError('No vehicle selected');
      return;
    }
    
    let uploadedImages: string[] = [];
    let validLink = false;
    
    // Process iCloud link if provided
    if (sharedAlbumLink) {
      validLink = validateLink();
    }
    
    // Upload images if selected
    if (selectedFiles && selectedFiles.length > 0) {
      uploadedImages = await uploadFiles();
    }
    
    // Ensure at least one option is provided
    if (!validLink && uploadedImages.length === 0) {
      setError('Please provide either an iCloud shared album link or select images to upload');
      return;
    }
    
    // Call the connect callback with the data
    onConnect({
      vehicleId,
      icloudLink: validLink ? sharedAlbumLink : undefined,
      icloudFolderId: validLink ? generateFolderId() : undefined,
      uploadedImages: uploadedImages.length > 0 ? uploadedImages : undefined
    });
    
    // Close the modal
    onOpenChange(false);
  };

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
