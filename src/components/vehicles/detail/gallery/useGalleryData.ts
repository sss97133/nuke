import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface GalleryImage {
  id: string;
  url: string;
  type: string;
  user: {
    name: string;
  };
  isVerified: boolean;
  caption?: string;
}

export const useGalleryData = (vehicle: any) => {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchVehicleImages = async () => {
      if (!vehicle?.id) return;
      
      setIsLoading(true);
      try {
        const { data: imageRecords, error } = await supabase
          .from('vehicle_images')
          .select('*')
          .eq('car_id', vehicle.id)
          .order('uploaded_at', { ascending: false });

        if (error) throw error;

        if (imageRecords && imageRecords.length > 0) {
          const formattedImages = imageRecords.map(record => ({
            id: record.id,
            url: record.public_url || '',
            type: record.image_type || 'exterior',
            user: {
              name: 'System'
            },
            isVerified: false,
            caption: record.source || undefined
          }));
          setImages(formattedImages);
        } else if (vehicle.image_url || vehicle.image) {
          setImages([{
            id: '1',
            url: vehicle.image_url || vehicle.image,
            type: 'exterior',
            user: {
              name: 'System'
            },
            isVerified: true
          }]);
        }
      } catch (error) {
        console.error('Error fetching vehicle images:', error);
        if (vehicle.image_url || vehicle.image) {
          setImages([{
            id: '1',
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

  const handleImageUpload = async (files: FileList | null, type: string, description: string) => {
    if (!files || files.length === 0 || !vehicle?.id) return;
    
    setIsLoading(true);
    const uploadedImages: GalleryImage[] = [];
    
    try {
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
            car_id: vehicle.id,
            file_name: fileName,
            file_path: filePath,
            image_type: type,
            is_primary: false,
            public_url: publicUrl,
            source: 'user_upload',
            uploaded_at: new Date().toISOString()
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