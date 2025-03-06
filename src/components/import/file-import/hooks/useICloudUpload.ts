import { useState } from 'react';
import { parseICloudSharedLink } from '@/utils/icloud';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface UseICloudUploadProps {
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

export const useICloudUpload = ({ vehicleId, vehicleInfo, onConnect }: UseICloudUploadProps) => {
  const [sharedAlbumLink, setSharedAlbumLink] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [linkValidation, setLinkValidation] = useState<'valid' | 'invalid' | null>(null);
  const { toast } = useToast();

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
          .from('vehicle-images')
          .upload(filePath, file);
        
        if (error) throw error;
        
        uploadedPaths.push(filePath);
        
        // Update progress
        setUploadProgress(Math.round(((i + 1) / selectedFiles.length) * 100));
      }
      
      return uploadedPaths;
    } catch (err: any) {
      setError(`Upload error: ${err.message || 'Unknown error'}`);
      toast({
        variant: "destructive",
        title: "Upload Error",
        description: err.message || 'Unknown error occurred during upload',
      });
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

    // Reset form state
    setSharedAlbumLink('');
    setSelectedFiles(null);
    setUploadProgress(0);
    setError(null);
    setLinkValidation(null);
  };

  return {
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
  };
};
