
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

  // Create a unique file name
  const fileExt = file.name.split('.').pop();
  const fileName = `${vehicleId}/${Date.now()}.${fileExt}`;
  const filePath = `vehicle-images/${fileName}`;

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('vehicles')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;

  // Get the public URL
  const { data: { publicUrl } } = supabase.storage
    .from('vehicles')
    .getPublicUrl(filePath);

  // Return the public URL
  return publicUrl;
};
