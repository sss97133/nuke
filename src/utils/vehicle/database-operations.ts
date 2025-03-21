
import type { Database } from '../types';
import { supabase } from '@/integrations/supabase/client';
import { CarImportData, CarImageData } from './types';

/**
 * Import car data to Supabase
 */
export async function importCarsToSupabase(carData: CarImportData[]): Promise<string[]> {
  // Get current user ID
  const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
  
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  const importedIds: string[] = [];
  
  // Process each car
  for (const car of carData) {
    try {
      // Prepare the car data with user_id
      const carRecord = {
        ...car,
        user_id: user.id,
        // Ensure year is a number for Supabase schema
        year: typeof car.year === 'string' ? parseInt(car.year, 10) : car.year
      };
      
      // Insert or update the car record
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('vehicles')
        .upsert(carRecord, { onConflict: 'id' })
        .select('id')
        .single();
      
      if (error) throw error;
      
      if (data?.id) {
        importedIds.push(data.id);
      }
    } catch (err) {
      console.error('Error importing car:', car, err);
    }
  }
  
  return importedIds;
}

/**
 * Connect iCloud images to a car
 */
export async function connectICloudImages(
  carId: string, 
  icloudLink?: string, 
  folderId?: string
): Promise<boolean> {
  try {
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
    
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    // Skip if no iCloud data provided
    if (!icloudLink && !folderId) {
      return false;
    }
    
    // Update the car with iCloud information
    const { error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .update({ 
        icloud_album_link: icloudLink,
        icloud_folder_id: folderId
      })
      .eq('id', carId)
      .eq('user_id', user.id);
    
    if (error) throw error;
    
    return true;
  } catch (error) {
    console.error('Error connecting iCloud album:', error);
    throw error;
  }
}

/**
 * Save uploaded images to car_images table
 */
export async function saveCarImages(
  carId: string, 
  imagePaths: string[], 
  source: 'supabase' | 'icloud' = 'supabase'
): Promise<boolean> {
  try {
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
    
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    // Skip if no images
    if (!imagePaths.length) {
      return false;
    }
    
    // Prepare image records
    const imageRecords: CarImageData[] = imagePaths.map((path, index) => {
      // Extract filename from path
      const pathParts = path.split('/');
      const fileName = pathParts[pathParts.length - 1];
      
      // Get public URL for Supabase images
      let publicUrl;
      if (source === 'supabase') {
        const { data } = supabase.storage
          .from('car-images')
          .getPublicUrl(path);
        
        publicUrl = data.publicUrl;
      }
      
      return {
        car_id: carId,
        file_path: path,
        public_url: publicUrl,
        file_name: fileName,
        is_primary: index === 0, // First image is primary
        source
      };
    });
    
    // Insert image records
    const { error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .insert(imageRecords.map(record => ({
        ...record,
        user_id: user.id
      })));
    
    if (error) throw error;
    
    return true;
  } catch (error) {
    console.error('Error saving car images:', error);
    throw error;
  }
}
