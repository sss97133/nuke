import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { useToast } from "@/components/ui/use-toast";

// Get environment variables based on the current environment
const getEnvValue = (key: string): string => {
  let value = '';
  let source = '';
  
  // For Vite builds
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    value = import.meta.env[key];
    source = 'import.meta.env';
  }
  
  // For production builds where import.meta might not be available
  if (!value && typeof process !== 'undefined' && process.env && process.env[key]) {
    value = process.env[key];
    source = 'process.env';
  }
  
  // For browser environments where window.__env might be set
  if (!value && typeof window !== 'undefined' && window.__env && window.__env[key]) {
    value = window.__env[key];
    source = 'window.__env';
  }
  
  // Hard-coded emergency fallback values for critical production deployments
  // If we couldn't find the value through normal channels, use safer fallback approach
  if (!value) {
    const criticalKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_SERVICE_KEY'];
    
    if (criticalKeys.includes(key)) {
      console.warn(`Missing critical environment variable: ${key}`);
      
      // Instead of hardcoding credentials, handle the missing variable gracefully
      if (typeof window !== 'undefined') {
        // Show a user-friendly error in the UI if in browser context
        const errorEvent = new CustomEvent('env-error', { detail: { key } });
        window.dispatchEvent(errorEvent);
      }
      
      // Return an empty string - the app's error boundaries will handle the failure
      // when Supabase client initialization fails
    }
  }
  
  if (value) {
    console.log(`Environment variable ${key} found in ${source}`);
    return value;
  }
  
  console.error(`Environment variable ${key} not found in any source`);
  return '';
};

// Add type definition for window.__env and reconnection function
declare global {
  interface Window {
    __env?: Record<string, string>;
    __reconnectSupabase?: () => boolean;
  }
}

const supabaseUrl = getEnvValue('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnvValue('VITE_SUPABASE_ANON_KEY');

// Get current environment
const environment = typeof process !== 'undefined' && process.env && process.env.NODE_ENV 
  ? process.env.NODE_ENV 
  : (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.MODE) 
    ? import.meta.env.MODE 
    : 'production';

// More resilient handling of missing credentials
if (!supabaseUrl || !supabaseAnonKey) {
  // Log warning but don't crash the app immediately
  console.warn(`⚠️ Missing Supabase credentials for environment ${environment}`);
  console.warn('VITE_SUPABASE_URL present:', !!supabaseUrl);
  console.warn('VITE_SUPABASE_ANON_KEY present:', !!supabaseAnonKey);
  
  // In browser environments, add a hidden error state
  // but let the app attempt to load
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    // Create a global reconnection function
    window.__reconnectSupabase = () => {
      try {
        // Try to get values again (may be set by async scripts)
        const retryUrl = getEnvValue('VITE_SUPABASE_URL');
        const retryKey = getEnvValue('VITE_SUPABASE_ANON_KEY');
        
        if (retryUrl && retryKey) {
          console.log('Found Supabase credentials, reconnecting...');
          window.location.reload();
          return true;
        }
      } catch (e) {
        console.error('Reconnection failed:', e);
      }
      return false;
    };
    
    // Try reconnection after a delay (env vars might be set async)
    setTimeout(() => {
      if (window.__reconnectSupabase) {
        window.__reconnectSupabase();
      }
    }, 1000);
  }
  
  // In non-browser environments or development, throw error
  if (environment !== 'production' || typeof document === 'undefined') {
    throw new Error(`Invalid Supabase configuration: missing credentials for environment ${environment}`);
  }
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
    message: "An unknown error occurred",
    details: String(error),
  };
};

export const isSupabaseError = (error: unknown): error is SupabaseError => {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as SupabaseError).message === "string"
  );
};

// Utility function for safe database selects
export async function safeSelect<T extends Record<string, unknown>>(
  table: string,
  select?: string,
): Promise<T[] | null> {
  try {
    const { data, error } = await supabase.from(table).select(select || "*");
    if (error) console.error("Database query error:", error);
    return data as T[] | null;
  } catch (error) {
    const supaError = handleSupabaseError(error);
    console.error("Database select error:", supaError);
    return null;
  }
}

// Types for image upload progress tracking
type ProgressState = {
  file: string;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
};

// Hook for using Supabase with toast notifications
export function useSupabaseWithToast() {
  const { toast } = useToast();

  const handleError = (error: unknown) => {
    const supaError = handleSupabaseError(error);
    toast({
      title: "Error",
      description: supaError.message,
      variant: "destructive",
    });
    return supaError;
  };

  const handleSuccess = (message: string) => {
    toast({
      title: "Success",
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
  maxSizeMB: number = 10,
): Promise<string[]> {
  const uploadProgress: Record<string, ProgressState> = {};
  const imageUrls: string[] = [];

  // Initialize progress for each file
  files.forEach((file) => {
    uploadProgress[file.name] = {
      file: file.name,
      progress: 0,
      status: "pending",
    };
  });

  try {
    // Upload each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const position = positions[i];

      // Check file size
      if (file.size > maxSizeMB * 10024 * 10024) {
        uploadProgress[file.name] = {
          file: file.name,
          progress: 0,
          status: "error",
          error: `File size exceeds ${maxSizeMB}MB limit`,
        };
        onProgress({ ...uploadProgress });
        continue;
      }

      // Update status to uploading
      uploadProgress[file.name] = {
        file: file.name,
        progress: 0,
        status: "uploading",
      };
      onProgress({ ...uploadProgress });

      try {
        // Upload to storage bucket
        const fileName = `${vehicleId}/${category}/${position}/${Date.now()}-${file.name}`;

        // Upload to storage bucket
        // Get public URL first (synchronous)
        const { data: urlData } = supabase.storage
          .from("vehicle-images")
          .getPublicUrl(fileName);

        // Then do the upload (async)
        try {
          const { data, error } = await supabase.storage
            .from("vehicle-images")
            .upload(fileName, file, { cacheControl: "3600", upsert: false });
          
          if (error) {
            console.error("Vehicle image upload error:", error);
            // Track vehicle data failures for the multi-source connector framework
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                detail: { 
                  vehicleId, 
                  operation: 'uploadVehicleImage', 
                  source: 'supabase/client.ts',
                  error,
                  timestamp: new Date().toISOString() 
                } 
              }));
            }
            
            // Update progress to error state
            uploadProgress[file.name] = {
              file: file.name,
              progress: 0,
              status: "error",
              error: error.message
            };
            onProgress({ ...uploadProgress });
            continue; // Skip this file and move to the next one
          }
          
          if (!urlData?.publicUrl) {
            throw new Error("Failed to get public URL");
          }
          
          // Update progress and store URL
          uploadProgress[file.name] = {
            file: file.name,
            progress: 100,
            status: "success"
          };
          onProgress({ ...uploadProgress });
          imageUrls.push(urlData.publicUrl);
        } catch (error) {
          console.error("Public URL error:", handleSupabaseError(error));
          
          // Track vehicle data failures for the multi-source connector framework
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
              detail: { 
                vehicleId, 
                operation: 'uploadVehicleImage', 
                source: 'supabase/client.ts',
                error,
                timestamp: new Date().toISOString() 
              } 
            }));
          }
          
          // Update progress to error state
          uploadProgress[file.name] = {
            file: file.name,
            progress: 0,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error"
          };
          onProgress({ ...uploadProgress });
        }

        // Progress is handled inside the try/catch block above
      } catch (error) {
        uploadProgress[file.name] = {
          file: file.name,
          progress: 0,
          status: "error",
          error: error instanceof Error ? error.message : "Upload failed",
        };
      }

      onProgress({ ...uploadProgress });
    }

    return imageUrls;
  } catch (error) {
    // Handle any unexpected errors
    Object.keys(uploadProgress).forEach((fileName) => {
      if (
        uploadProgress[fileName].status === "pending" ||
        uploadProgress[fileName].status === "uploading"
      ) {
        uploadProgress[fileName] = {
          file: fileName,
          progress: 0,
          status: "error",
          error: error instanceof Error ? error.message : "Upload failed",
        };
      }
    });
    onProgress({ ...uploadProgress });
    throw error;
  }
}

export type VehicleImageCategory = 'exterior' | 'interior' | 'engine' | 'other';
export type ImagePosition = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export type UploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export type ProgressCallback = (progress: UploadProgress) => void;

export const uploadImage = async (
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
