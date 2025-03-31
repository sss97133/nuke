import { supabase } from '@/integrations/supabase/client';
import { uploadVehicleImage, getPublicUrl } from '@/lib/image-upload';

// Re-export the Supabase client instance
export { supabase };

// Re-export specific functions, potentially renaming them for clarity within this module
export { uploadVehicleImage, getPublicUrl };

/**
 * Safely invoke a Supabase Edge Function with proper error handling
 * @param functionName Name of the Edge Function to invoke
 * @param body Request body to send to the function
 * @returns Object containing data and error properties
 */
export async function invokeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    
    if (error) {
      console.error(`Error invoking ${functionName}:`, error.message);
      return { data: null, error: new Error(error.message) };
    }
    
    return { data: data as T, error: null };
  } catch (error) {
    console.error(`Failed to invoke ${functionName}:`, error);
    return { 
      data: null, 
      error: error instanceof Error 
        ? error 
        : new Error(String(error)) 
    };
  }
}

/**
 * Uploads a user's profile picture.
 * @param userId The ID of the user.
 * @param file The image file to upload.
 * @returns The public URL of the uploaded image or null.
 */
