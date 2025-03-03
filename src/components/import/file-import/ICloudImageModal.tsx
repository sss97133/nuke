
import React, { useState } from 'react';
import { Cloud, Upload, X, Check, AlertCircle, Image } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose
} from "@/components/ui/dialog";
import { parseICloudSharedLink } from '@/utils/icloud';
import { supabase } from '@/integrations/supabase/client';

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

  // Preview selected images
  const previewImages = selectedFiles 
    ? Array.from(selectedFiles).map(file => URL.createObjectURL(file))
    : [];

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

  // Clean up object URLs when component unmounts or files change
  React.useEffect(() => {
    return () => {
      previewImages.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewImages]);

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
          {/* iCloud Shared Album Option */}
          <div className="space-y-2">
            <Label htmlFor="icloud-link" className="text-base font-medium">
              <Cloud className="h-4 w-4 inline mr-2" />
              Connect iCloud Shared Album
            </Label>
            <Input
              id="icloud-link"
              placeholder="https://share.icloud.com/photos/..."
              value={sharedAlbumLink}
              onChange={(e) => setSharedAlbumLink(e.target.value)}
              onBlur={validateLink}
              className={`${
                linkValidation === 'valid' ? 'border-green-500 focus-visible:ring-green-500' :
                linkValidation === 'invalid' ? 'border-red-500 focus-visible:ring-red-500' : ''
              }`}
            />
            {linkValidation === 'valid' && (
              <p className="text-sm text-green-500 flex items-center">
                <Check className="h-4 w-4 mr-1" />
                Valid iCloud shared album link
              </p>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          {/* File Upload Option */}
          <div className="space-y-2">
            <Label htmlFor="car-images" className="text-base font-medium">
              <Upload className="h-4 w-4 inline mr-2" />
              Upload Images
            </Label>
            <div className="border-2 border-dashed rounded-lg p-4 text-center">
              <Input
                id="car-images"
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <Label htmlFor="car-images" className="cursor-pointer block">
                <Button type="button" variant="outline" className="w-full">
                  <Image className="h-4 w-4 mr-2" />
                  Select Photos
                </Button>
              </Label>
              <p className="text-sm text-muted-foreground mt-2">
                Supported formats: JPG, PNG, HEIC (Max 10MB each)
              </p>
            </div>
          </div>

          {/* Image Preview */}
          {previewImages.length > 0 && (
            <div>
              <Label className="text-sm font-medium">Selected Images ({previewImages.length})</Label>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {previewImages.map((url, index) => (
                  <div key={index} className="relative aspect-square rounded-md overflow-hidden">
                    <img 
                      src={url} 
                      alt={`Preview ${index}`} 
                      className="object-cover w-full h-full"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Uploading images...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2.5 dark:bg-slate-700">
                <div 
                  className="bg-primary h-2.5 rounded-full" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </DialogClose>
          <Button 
            type="button" 
            onClick={handleConnect}
            disabled={isUploading}
          >
            <Check className="h-4 w-4 mr-2" />
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
