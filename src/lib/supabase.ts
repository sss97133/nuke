
import { createClient } from '@supabase/supabase-js';

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper function to handle image uploads with size validation
export const uploadVehicleImage = async (
  vehicleId: string,
  file: File,
  maxSizeMB: number = 2
) => {
  // Validate file size
  const maxSize = maxSizeMB * 1024 * 1024; // Convert to bytes
  if (file.size > maxSize) {
    throw new Error(`File size exceeds the maximum allowed size of ${maxSizeMB}MB`);
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are allowed');
  }

  try {
    console.log(`Starting upload for vehicle ${vehicleId}, file: ${file.name}`);
    
    // Create a unique file name
    const fileExt = file.name.split('.').pop();
    const fileName = `${vehicleId}/${Date.now()}.${fileExt}`;
    const filePath = `vehicle-images/${fileName}`;

    console.log(`Generated file path: ${filePath}`);
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('vehicles')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Storage upload error:', error);
      throw error;
    }
    
    console.log('File uploaded successfully');

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicles')
      .getPublicUrl(filePath);
      
    console.log('Generated public URL:', publicUrl);

    // Add to vehicle_images table
    const { error: dbError } = await supabase
      .from('vehicle_images')
      .insert({
        car_id: vehicleId,
        image_url: publicUrl,
        uploaded_at: new Date().toISOString(),
        file_name: file.name,
        file_path: filePath,
        is_primary: false // By default, not primary
      });

    if (dbError) {
      console.error('Database insert error:', dbError);
      throw dbError;
    }
    
    console.log('Database record created successfully');

    // Return the public URL
    return publicUrl;
  } catch (error) {
    console.error('Error in uploadVehicleImage:', error);
    throw error;
  }
};
