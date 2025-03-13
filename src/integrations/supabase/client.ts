import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { useToast } from '@/components/ui/use-toast';

export enum VehicleImageCategory {
  PRIMARY = 'primary',
  EXTERIOR = 'exterior',
  INTERIOR = 'interior',
  TECHNICAL = 'technical',
  DOCUMENTATION = 'documentation'
}

export enum ImagePosition {
  // Exterior positions
  FRONT_34 = 'front_34',
  SIDE_DRIVER = 'side_driver',
  SIDE_PASSENGER = 'side_passenger',
  REAR_34 = 'rear_34',
  FRONT_DIRECT = 'front_direct',
  REAR_DIRECT = 'rear_direct',

  // Interior positions
  DASHBOARD = 'dashboard',
  CENTER_CONSOLE = 'center_console',
  FRONT_SEATS = 'front_seats',
  REAR_SEATS = 'rear_seats',
  TRUNK = 'trunk',

  // Documentation positions
  VIN = 'vin',
  ODOMETER = 'odometer',
  WINDOW_STICKER = 'window_sticker',
  TITLE = 'title',

  // Technical positions
  ENGINE = 'engine',
  UNDERCARRIAGE = 'undercarriage',
  WHEELS = 'wheels',
  FEATURES = 'features'
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

export type SupabaseError = {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
};

export const handleSupabaseError = (error: unknown): SupabaseError => {
  if (error instanceof Error) {
    return {
      message: error.message,
      details: error.stack,
    };
  }
  
  return {
    message: 'An unknown error occurred',
    details: String(error),
  };
};

export const isSupabaseError = (error: unknown): error is SupabaseError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as SupabaseError).message === 'string'
  );
};

// Utility function for safe database selects
export async function safeSelect<T>(
  query: Promise<{ data: T | null; error: Error | null }>
): Promise<T | null> {
  try {
    const { data, error } = await query;
    if (error) {
      console.error('Database select error:', error);
      throw error;
    }
    return data;
  } catch (error) {
    const supaError = handleSupabaseError(error);
    console.error('Database select error:', supaError);
    return null;
  }
}

// Types for image upload progress tracking
type ProgressState = {
  file: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
};

// Hook for using Supabase with toast notifications
export function useSupabaseWithToast() {
  const { toast } = useToast();

  const handleError = (error: unknown) => {
    const supaError = handleSupabaseError(error);
    toast({
      title: 'Error',
      description: supaError.message,
      variant: 'destructive',
    });
    return supaError;
  };

  const handleSuccess = (message: string) => {
    toast({
      title: 'Success',
      description: message,
    });
  };

  return {
    handleError,
    handleSuccess,
  };
}

export async function uploadVehicleImages(
  vehicleId: string,
  files: File[],
  category: VehicleImageCategory,
  positions: ImagePosition[],
  onProgress: (progress: Record<string, ProgressState>) => void,
  maxSizeMB: number = 10
): Promise<string[]> {
  const uploadProgress: Record<string, ProgressState> = {};
  const imageUrls: string[] = [];

  // Initialize progress for each file
  files.forEach(file => {
    uploadProgress[file.name] = {
      file: file.name,
      progress: 0,
      status: 'pending'
    };
  });

  try {
    // Upload each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const position = positions[i];

      // Check file size
      if (file.size > maxSizeMB * 1024 * 1024) {
        uploadProgress[file.name] = {
          file: file.name,
          progress: 0,
          status: 'error',
          error: `File size exceeds ${maxSizeMB}MB limit`
        };
        onProgress({ ...uploadProgress });
        continue;
      }

      // Update status to uploading
      uploadProgress[file.name] = {
        file: file.name,
        progress: 0,
        status: 'uploading'
      };
      onProgress({ ...uploadProgress });

      try {
        // Upload to storage bucket
        const fileName = `${vehicleId}/${category}/${position}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage
          .from('vehicle-images')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false
          });
        if (error) throw error;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(fileName);
        if (!urlData?.publicUrl) {
          const error = new Error('Failed to get public URL');
          console.error('Public URL error:', error);
          throw error;
        }

        imageUrls.push(urlData.publicUrl);

        // Update progress
        uploadProgress[file.name] = {
          file: file.name,
          progress: 100,
          status: 'success'
        };
      } catch (error) {
        uploadProgress[file.name] = {
          file: file.name,
          progress: 0,
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed'
        };
      }

      onProgress({ ...uploadProgress });
    }

    return imageUrls;
  } catch (error) {
    // Handle any unexpected errors
    Object.keys(uploadProgress).forEach(fileName => {
      if (uploadProgress[fileName].status === 'pending' || uploadProgress[fileName].status === 'uploading') {
        uploadProgress[fileName] = {
          file: fileName,
          progress: 0,
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed'
        };
      }
    });
    onProgress({ ...uploadProgress });
    throw error;
  }
} 