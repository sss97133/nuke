
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { GalleryImage } from './types';

export const useGalleryData = (vehicle: any) => {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { toast } = useToast();

  // Handle image upload
  const handleImageUpload = async (files: FileList | null, type: string, description: string) => {
    if (!files || files.length === 0) return;
    
    setIsLoading(true);
    
    try {
      // Fake upload for demo purposes
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Create new image records
      const newImages: GalleryImage[] = Array.from(files).map((file, index) => ({
        id: Date.now() + index,
        url: URL.createObjectURL(file),
        type: type,
        user: {
          name: 'Current User'
        },
        isVerified: false
      }));
      
      // Add new images to the list
      setImages(prev => [...newImages, ...prev]);
      
      toast({
        title: 'Images uploaded',
        description: `Successfully uploaded ${files.length} images`,
      });
    } catch (error) {
      console.error('Error uploading images:', error);
      toast({
        title: 'Upload failed',
        description: 'There was an error uploading your images. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsUploadModalOpen(false);
    }
  };

  return {
    images,
    isLoading,
    isUploadModalOpen,
    setIsUploadModalOpen,
    handleImageUpload
  };
};
