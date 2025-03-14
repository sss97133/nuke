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
  if (error) console.error("Database query error:", error);
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
      // Get current user
      console.log('Checking authentication state...');
      const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      console.log('Auth state:', { user, error: userError });
      
      if (userError || !user) {
        console.error('Authentication error:', userError);
        throw new Error('User not authenticated');
      }

      // Log vehicle ID
      console.log('Vehicle ID:', vehicle.id);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log('Processing file:', {
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified
        });

        // Validate file type
        if (!file.type.startsWith('image/')) {
          console.error(`File ${i} is not an image:`, file.type);
          continue;
        }

        // Validate file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
          console.error(`File ${i} is too large:`, file.size);
          continue;
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${i}.${fileExt}`;
        const filePath = `vehicles/${vehicle.id}/${fileName}`;
        
        console.log('Attempting upload with path:', filePath);
        
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
  if (error) console.error("Database query error:", error);
          .from('vehicle-images')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });
        
        console.log('Upload result:', { 
          data: uploadData, 
          error: uploadError,
          path: filePath,
          fileType: file.type,
          fileSize: file.size,
          bucket: 'vehicle-images'
        });
        
        if (uploadError) {
          console.error(`Error uploading file ${i}:`, uploadError);
          continue;
        }
        
        // Get the public URL
        const { data: urlData } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(filePath);
          
        console.log('Generated public URL:', urlData);
        const publicUrl = urlData.publicUrl;
        
        // Create record in vehicle_images table
        console.log('Creating database record...');
        const { data: imageRecord, error: dbError } = await supabase
  if (error) console.error("Database query error:", error);
          
          .insert([{
            car_id: vehicle.id,
            file_name: fileName,
            file_path: filePath,
            image_type: type,
            is_primary: false,
            public_url: publicUrl,
            source: 'user_upload',
            uploaded_at: new Date().toISOString(),
            user_id: user.id
          }])
          .select()
          .single();
        
        console.log('Database record result:', { record: imageRecord, error: dbError });
        
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
            name: user.user_metadata?.full_name || 'Current User'
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