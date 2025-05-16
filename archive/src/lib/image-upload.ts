import { supabase } from '@/integrations/supabase/client';

export enum VehicleImageCategory {
  EXTERIOR = 'exterior',
  INTERIOR = 'interior',
  ENGINE = 'engine',
  OTHER = 'other',
  DOCUMENTATION = 'documentation',
  TECHNICAL = 'technical',
  PRIMARY = 'primary'
}

export enum ImagePosition {
  FRONT_34 = 'front_34',
  SIDE_DRIVER = 'side_driver',
  SIDE_PASSENGER = 'side_passenger',
  REAR_34 = 'rear_34',
  FRONT_DIRECT = 'front_direct',
  REAR_DIRECT = 'rear_direct',
  DASHBOARD = 'dashboard',
  CENTER_CONSOLE = 'center_console',
  FRONT_SEATS = 'front_seats',
  REAR_SEATS = 'rear_seats',
  TRUNK = 'trunk',
  VIN = 'vin',
  ODOMETER = 'odometer',
  WINDOW_STICKER = 'window_sticker',
  TITLE = 'title',
  ENGINE = 'engine',
  UNDERCARRIAGE = 'undercarriage',
  WHEELS = 'wheels',
  FEATURES = 'features'
}

export type UploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export type ProgressCallback = (progress: UploadProgress) => void;

export const uploadVehicleImage = async (
  bucketName: string,
  file: File,
  filePath?: string,
  onProgress?: ProgressCallback
): Promise<string | null> => {
  if (!supabase) {
    console.error('Supabase client not initialized.');
    return null;
  }

  const targetPath = filePath || `${Date.now()}-${file.name}`;

  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(targetPath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error(`Error uploading image to ${bucketName}:`, error.message);
      return null;
    }

    if (data) {
      const { data: publicUrlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(data.path);

      if (publicUrlData) {
        console.log(`Image uploaded successfully to ${bucketName}: ${publicUrlData.publicUrl}`);
        return publicUrlData.publicUrl;
      }
    }
    return null;
  } catch (err) {
    console.error('Unexpected error during image upload:', err);
    return null;
  }
};

export const getPublicUrl = (bucketName: string, filePath: string): string | null => {
  if (!supabase) {
    console.error('Supabase client not initialized.');
    return null;
  }
  try {
    const { data } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);
    return data?.publicUrl ?? null;
  } catch (error) {
    console.error(`Error getting public URL for ${filePath} in ${bucketName}:`, error);
    return null;
  }
}; 