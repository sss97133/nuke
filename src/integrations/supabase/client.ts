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

// Remove the import from @/fix-env - it's for local debugging only
// import { CORRECT_SUPABASE_URL, CORRECT_SUPABASE_ANON_KEY } from '@/fix-env';

// Get environment variables directly using the helper function
const supabaseUrl = getEnvValue('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnvValue('VITE_SUPABASE_ANON_KEY');

// Get current environment more reliably
const environment = import.meta.env.MODE || process.env.NODE_ENV || 'production';

// Simplified check for missing credentials
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(`⚠️ Missing Supabase credentials for environment ${environment}. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.`);
  
  // Optionally throw an error or display UI error, 
  // but avoid complex reconnection logic tied to local fallbacks here.
  // The createClient call will fail if credentials are truly missing.
}

// Use the retrieved values directly, or provide clear error placeholders if missing
const safeSupabaseUrl = (supabaseUrl || 'https://missing-url-error').replace(/\/$/, '');
const safeSupabaseAnonKey = supabaseAnonKey || 'missing-key-error';

let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null;

export const getSupabaseClient = () => {
  if (!supabaseInstance) {
    // Check again right before creation
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase client initialization failed: Missing credentials.');
      // Return null or throw, depending on how you want consuming code to handle it
      // Returning null might lead to downstream errors. Throwing might be safer.
      throw new Error('Missing Supabase credentials during client initialization');
    }

    try {
      console.log(`Initializing Supabase client for URL: ${safeSupabaseUrl.substring(0, 20)}...`); // Log safely
      supabaseInstance = createClient<Database>(safeSupabaseUrl, safeSupabaseAnonKey, {
        auth: {
          persistSession: true,
          storageKey: 'nuke.auth.token',
          // Use localStorage directly if in browser, otherwise undefined (safer for SSR/build)
          storage: typeof window !== 'undefined' ? window.localStorage : undefined, 
          detectSessionInUrl: true,
          flowType: 'pkce'
        }
      });
      console.log('Supabase client initialized successfully.');
    } catch (error) {
      console.error('Supabase createClient error:', error);
      supabaseInstance = null; // Ensure instance is null on error
      throw error; // Re-throw the error
    }
  }
  return supabaseInstance;
};

// Export a default client using the getter
export const supabase = getSupabaseClient();

// Ensure the listener is attached only if the client initialized successfully
if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('Auth state changed:', event, session?.user?.email);
    if (event === 'SIGNED_IN') {
      console.log('User signed in:', session?.user?.email);
    } else if (event === 'SIGNED_OUT') {
      console.log('User signed out');
    }
  });
} else {
  console.error('Could not attach Supabase auth listener: client not initialized.')
}

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

// Add error handling for database operations
export const handleDatabaseError = (error: unknown): string => {
  console.error('Database operation error:', error);
  
  // Check if error is an object with expected properties
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: string }).code; // Safe access with assertion
    const message = (error as { message?: string }).message; // Safe access with assertion

    if (code === '23505') { // Unique violation
      return 'This record already exists.';
    }
    if (code === '23503') { // Foreign key violation
      return 'Related record not found.';
    }
    
    // Use the message if available, otherwise a generic error
    return message || 'An unexpected database error occurred.';
  }
  
  // Handle non-object errors (e.g., strings, primitive types)
  if (error instanceof Error) {
    return error.message || 'An unexpected error occurred.';
  }
  
  // Default fallback for truly unknown error types
  return 'An unexpected error occurred.';
};
