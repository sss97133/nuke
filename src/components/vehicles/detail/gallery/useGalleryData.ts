
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { GalleryImage } from './types';

export const useGalleryData = (vehicle: any) => {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { toast } = useToast();

  // Fetch images when the component mounts
  useEffect(() => {
    const fetchVehicleImages = async () => {
      if (!vehicle?.id) return;
      
      setIsLoading(true);
      
      try {
        // First try to fetch images from Supabase
        const { data: imageData, error } = await supabase
          .from('vehicle_images')
          .select('*')
          .eq('vehicle_id', vehicle.id);
        
        if (error) {
          throw error;
        }
        
        if (imageData && imageData.length > 0) {
          // Convert to our GalleryImage format
          const galleryImages: GalleryImage[] = imageData.map(img => ({
            id: img.id,
            url: img.image_url,
            type: img.image_type || 'exterior',
            user: {
              name: img.uploaded_by || 'User'
            },
            isVerified: img.is_verified || false,
            caption: img.caption
          }));
          
          setImages(galleryImages);
        } else if (vehicle.image_url || vehicle.image) {
          // If no gallery images but vehicle has a primary image, use it
          setImages([{
            id: 1,
            url: vehicle.image_url || vehicle.image,
            type: 'exterior',
            user: {
              name: 'System'
            },
            isVerified: true
          }]);
        } else {
          // No images found
          setImages([]);
        }
      } catch (error) {
        console.error('Error fetching vehicle images:', error);
        // If there was an error, still try to use the primary image if available
        if (vehicle.image_url || vehicle.image) {
          setImages([{
            id: 1,
            url: vehicle.image_url || vehicle.image,
            type: 'exterior',
            user: {
              name: 'System'
            },
            isVerified: true
          }]);
        }
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchVehicleImages();
  }, [vehicle]);

  // Handle image upload
  const handleImageUpload = async (files: FileList | null, type: string, description: string) => {
    if (!files || files.length === 0 || !vehicle?.id) return;
    
    setIsLoading(true);
    
    try {
      // For each file, upload to Supabase storage
      const uploadedImages: GalleryImage[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${vehicle.id}_${Date.now()}_${i}.${fileExt}`;
        const filePath = `vehicles/${vehicle.id}/${fileName}`;
        
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(filePath, file);
        
        if (uploadError) {
          console.error(`Error uploading file ${i}:`, uploadError);
          continue;
        }
        
        // Get the public URL
        const { data: urlData } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(filePath);
          
        const publicUrl = urlData.publicUrl;
        
        // Create record in vehicle_images table
        const { data: imageRecord, error: dbError } = await supabase
          .from('vehicle_images')
          .insert([{
            vehicle_id: vehicle.id,
            image_url: publicUrl,
            image_type: type,
            caption: description,
            uploaded_by: 'Current User'
          }])
          .select()
          .single();
        
        if (dbError) {
          console.error(`Error saving image ${i} to database:`, dbError);
          continue;
        }
        
        // Add to our list of uploaded images
        uploadedImages.push({
          id: imageRecord.id,
          url: publicUrl,
          type: type,
          user: {
            name: 'Current User'
          },
          isVerified: false,
          caption: description
        });
      }
      
      // Add new images to the list
      if (uploadedImages.length > 0) {
        setImages(prev => [...uploadedImages, ...prev]);
        
        toast({
          title: 'Images uploaded',
          description: `Successfully uploaded ${uploadedImages.length} images`,
        });
      } else {
        throw new Error('No images were successfully uploaded');
      }
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
