import { getSupabaseClient } from '@/integrations/supabase/client';

// Define the return type for the upload function
interface UploadResult {
  path: string | null;
  publicUrl: string | null; // Keep publicUrl required for successful uploads
  error: Error | null;
}

export const uploadFileToSupabase = async (
  file: File,
  bucket: string = 'vehicle-uploads',
  // Removed default path, should be provided by caller
  path: string 
): Promise<UploadResult> => {
  const supabase = getSupabaseClient();

  if (!path) {
    console.error('Upload path cannot be empty');
    return { path: null, publicUrl: null, error: new Error('Upload path missing') };
  }

  try {
    // Use the provided path directly
    const filePath = path;

    // Upload the file
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false, 
      });

    if (uploadError) {
      console.error('Error uploading file:', uploadError);
      const error = uploadError instanceof Error ? uploadError : new Error(String(uploadError));
      // Return the path attempted even on error, useful for debugging
      return { path: filePath, publicUrl: null, error }; 
    }

    // Get the public URL
    const finalPath = uploadData?.path || filePath; // Should ideally always be filePath
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(finalPath);

    // Ensure publicUrl is not null or undefined on success
    if (!urlData?.publicUrl) {
      console.error('Failed to get public URL after upload');
      return { path: finalPath, publicUrl: null, error: new Error('Failed to get public URL') };
    }

    return { 
      path: finalPath, 
      publicUrl: urlData.publicUrl, 
      error: null 
    };
    
  } catch (err) {
    console.error('Exception during file upload:', err);
    const error = err instanceof Error ? err : new Error(String(err));
    // Return the attempted path if available
    return { path: path, publicUrl: null, error }; 
  }
};

// Update utility function to remove single or multiple files from storage
export const removeFileFromSupabase = async (
  bucket: string = 'vehicle-uploads',
  paths: string | string[] // Accept single path or array of paths
): Promise<{ error: Error | null }> => {
  const supabase = getSupabaseClient();
  
  // Ensure we have paths and convert single path to array if necessary
  const pathsToRemove = Array.isArray(paths) ? paths : (paths ? [paths] : []);
  
  if (pathsToRemove.length === 0) {
    console.warn('No paths provided for file removal');
    return { error: null }; // No error, nothing to do
  }
  
  console.log(`Attempting to remove ${pathsToRemove.length} file(s) from bucket ${bucket}:`, pathsToRemove);
  
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove(pathsToRemove); // Pass the array of paths
      
    if (error) {
      console.error('Error removing file(s):', error);
      return { error: error instanceof Error ? error : new Error(String(error)) };
    }
    
    console.log(`Successfully removed file(s): ${pathsToRemove.join(', ')}`);
    return { error: null };
    
  } catch (err) {
    console.error('Exception during file removal:', err);
    const error = err instanceof Error ? err : new Error(String(err));
    return { error };
  }
}; 