/**
 * AUTHENTICATION SYSTEM CONSOLIDATION
 * 
 * This file now serves as a compatibility layer that redirects all references
 * to the old Supabase client to our single source of truth implementation.
 * 
 * DO NOT MODIFY THIS FILE OR ADD NEW FUNCTIONALITY HERE.
 * Instead, add new functionality to the main Supabase client at @/lib/supabase-client.ts
 */

import { supabase as newSupabaseClient } from "@/lib/supabase-client";
import type { Database } from "@/types/database";
import { useToast } from "@/components/ui/use-toast";

// This function now only exists for backward compatibility
// All environment logic is now centralized in the new client
const getEnvValue = (key: string): string => {
  console.warn('getEnvValue is deprecated - using centralized env management');
  return '';
};

// Type definitions preserved for backward compatibility
declare global {
  interface Window {
    __env?: Record<string, string>;
    __reconnectSupabase?: () => boolean;
  }
}

// The environment variables are now managed by the centralized client
// This code is kept for backward compatibility but doesn't actually do anything

// We'll use a type that matches the old supabaseInstance type for compatibility
import type { SupabaseClient } from '@supabase/supabase-js';

// Reference to our new singleton client
const supabaseInstance: SupabaseClient | null = newSupabaseClient;

/**
 * Returns the consolidated Supabase client.
 * This now just returns a reference to our new implementation.
 */
export const getSupabaseClient = () => {
  console.warn('Using deprecated getSupabaseClient - switch to importing from @/lib/supabase-client');
  return newSupabaseClient;
};

// Export the new Supabase client for backward compatibility
export const supabase = newSupabaseClient;

// Set up auth state change listener - but only once during the module initialization
// This setup is inside a try-catch to ensure errors here don't break the entire app
try {
  const client = getSupabaseClient();
  if (client) {
    client.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      if (event === 'SIGNED_IN') {
        console.log('User signed in:', session?.user?.email);
        // Dispatch an event that authentication has succeeded
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nuke:auth:signed-in', { detail: { session } }));
        }
      } else if (event === 'SIGNED_OUT') {
        console.log('User signed out');
        // Dispatch an event that can be used to refresh the UI
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nuke:auth:signed-out'));
        }
      }
    });
  } else {
    console.error('Could not attach Supabase auth listener: client not initialized.');
  }
} catch (error) {
  console.error('Error setting up auth state change listener:', error);
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
