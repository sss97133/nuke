/**
 * useImageUpload Hook
 * Consolidates all image upload logic into one reusable hook
 * Eliminates duplicate code across MobileVehicleProfile
 */

import { useState, useCallback } from 'react';
import { ImageUploadService } from '../services/imageUploadService';

interface UseImageUploadResult {
  uploading: boolean;
  error: string | null;
  upload: (vehicleId: string, files: FileList | null, category?: string) => Promise<boolean>;
}

export const useImageUpload = (
  session: any,
  isOwner: boolean,
  hasContributorAccess: boolean
): UseImageUploadResult => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (
    vehicleId: string,
    files: FileList | null,
    category: string = 'general'
  ): Promise<boolean> => {
    if (!files || files.length === 0) {
      setError('No files selected');
      return false;
    }

    if (!session?.user?.id) {
      setError('Please log in to upload images');
      alert('Please log in to upload images');
      return false;
    }

    if (!isOwner && !hasContributorAccess) {
      setError('Only the vehicle owner or contributors can upload images');
      alert('Only the vehicle owner or contributors can upload images');
      return false;
    }

    setUploading(true);
    setError(null);

    try {
      const results = [];
      
      for (let i = 0; i < files.length; i++) {
        const result = await ImageUploadService.uploadImage(vehicleId, files[i], category);
        results.push(result);
        
        if (!result.success) {
          console.error('Upload failed:', result.error);
          setError(`Upload failed: ${result.error}`);
        }
      }

      // Check if all uploads succeeded
      const allSucceeded = results.every(r => r.success);
      
      if (allSucceeded) {
        // Trigger refresh events
        window.dispatchEvent(new Event('vehicle_images_updated'));
        
        // Show success message
        const count = files.length;
        alert(`✓ ${count} photo${count > 1 ? 's' : ''} uploaded successfully!`);
        
        return true;
      } else {
        const failedCount = results.filter(r => !r.success).length;
        throw new Error(`${failedCount} of ${files.length} uploads failed`);
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Upload failed. Please try again.');
      alert(err.message || 'Upload failed. Please try again.');
      return false;
    } finally {
      setUploading(false);
    }
  }, [session, isOwner, hasContributorAccess]);

  return {
    uploading,
    error,
    upload
  };
};

