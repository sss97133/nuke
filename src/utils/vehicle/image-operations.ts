
import { supabase } from '@/integrations/supabase/client';
import { mockFetchICloudImages } from '@/utils/icloud-integration';

/**
 * Fetch car images
 */
export async function fetchCarImages(carId: string) {
  try {
    // Get car details
    const { data: car, error: carError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', carId)
      .single();
    
    if (carError) throw carError;
    
    // Get Supabase-stored images
    const { data: storedImages, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('car_id', carId)
      .order('uploaded_at', { ascending: false });
    
    if (imagesError) throw imagesError;
    
    // For iCloud integration, we'll use a mock function for now
    let iCloudImages: any[] = [];
    if (car && car.icloud_album_link) {
      // This would use the actual iCloud API in a production environment
      iCloudImages = mockFetchICloudImages(car.icloud_album_link);
    }
    
    return {
      storedImages: storedImages || [],
      iCloudImages,
      car
    };
  } catch (error) {
    console.error('Error fetching car images:', error);
    throw error;
  }
}
