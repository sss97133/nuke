
import { supabase } from '@/integrations/supabase/client';
import Papa from 'papaparse';
import { mockFetchICloudImages } from '@/utils/icloud-integration';

export interface CarImportData {
  id?: string;
  make: string;
  model: string;
  year: number | string;
  color?: string;
  purchase_date?: string;
  purchase_price?: number | string;
  current_value?: number | string;
  mileage?: number | string;
  condition?: string;
  location?: string;
  vin?: string;
  license_plate?: string;
  insurance_policy?: string;
  notes?: string;
  icloud_album_link?: string;
  icloud_folder_id?: string;
}

export interface CarImageData {
  car_id: string;
  file_path: string;
  public_url?: string;
  file_name: string;
  is_primary?: boolean;
  image_type?: string;
  source: 'supabase' | 'icloud';
}

// Parse CSV file with car data
export function parseCarCsv(file: File): Promise<CarImportData[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        // Validate required fields
        const validData = results.data.filter((car: any) => {
          return car.make && car.model && car.year;
        });
        
        resolve(validData as CarImportData[]);
      },
      error: (error) => {
        reject(error);
      }
    });
  });
}

// Import car data to Supabase
export async function importCarsToSupabase(carData: CarImportData[]): Promise<string[]> {
  // Get current user ID
  const { data: { user } } = await supabase.auth.getUser();
  
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
      };
      
      // Insert or update the car record
      const { data, error } = await supabase
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

// Connect iCloud images to a car
export async function connectICloudImages(
  carId: string, 
  icloudLink?: string, 
  folderId?: string
): Promise<boolean> {
  try {
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    // Skip if no iCloud data provided
    if (!icloudLink && !folderId) {
      return false;
    }
    
    // Update the car with iCloud information
    const { error } = await supabase
      .from('vehicles')
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

// Save uploaded images to car_images table
export async function saveCarImages(
  carId: string, 
  imagePaths: string[], 
  source: 'supabase' | 'icloud' = 'supabase'
): Promise<boolean> {
  try {
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    
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
      .from('vehicle_images')
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

// Fetch car images
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
