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

// Add Authentication Debugging function
export const checkAuthentication = async () => {
  // Use the re-exported supabase client
  try {
    const { data, error } = await supabase.auth.getUser();
    
    console.log('Auth check result:', { 
      isAuthenticated: !!data?.user,
      userId: data?.user?.id || 'Not authenticated',
      error: error ? `${error.name}: ${error.message}` : null
    });
    
    return { 
      isAuthenticated: !!data?.user,
      userId: data?.user?.id,
      error 
    };
  } catch (err) {
    console.error('Authentication check failed:', err);
    const error = err instanceof Error ? err : new Error(String(err));
    return { isAuthenticated: false, userId: null, error };
  }
};

/**
 * Uploads a user's profile picture.
 * @param userId The ID of the user.
 * @param file The image file to upload.
 * @returns The public URL of the uploaded image or null.
 */

// Implement Connection Retry Logic
export const queryWithRetry = async (
  queryFn: () => Promise<any>, // Function that returns the Supabase query promise
  maxRetries: number = 3,
  baseDelay: number = 1000 // milliseconds
) => {
  let lastError: Error | unknown = new Error('Query failed after multiple retries');
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Attempt the query
      const result = await queryFn();
      
      // Check for Supabase-specific error within the result if applicable
      // Supabase client typically returns { data, error }
      if (result && typeof result === 'object' && result.error) {
         throw result.error; // Throw the Supabase error to trigger retry
      }
      
      // If successful (no error thrown), return the result
      return result;
      
    } catch (err) {
      console.warn(`Query attempt ${attempt + 1} of ${maxRetries} failed:`, err);
      lastError = err;
      
      // If this was the last attempt, break the loop
      if (attempt === maxRetries - 1) break;
      
      // Exponential backoff with jitter (optional but good practice)
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay * 0.1;
      console.log(`Retrying query in ${delay.toFixed(0)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // All retries failed
  console.error(`All ${maxRetries} query attempts failed.`);
  // Throw the last encountered error
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
