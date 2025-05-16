import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface UploadProgress {
  percentage: number;
  loaded: number;
  total: number;
}

export interface UploadOptions {
  bucket: string;
  path: string;
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadResult {
  url: string;
  path: string;
}

export const uploadImage = async (
  file: File,
  options: UploadOptions
): Promise<UploadResult> => {
  const { bucket, path } = options;

  try {
    // Upload the file
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw error;
    }

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return {
      url: publicUrl,
      path: path
    };
  } catch (error) {
    // Cleanup on error
    await supabase.storage
      .from(bucket)
      .remove([path]);

    throw error;
  }
};

export const deleteImage = async (bucket: string, path: string): Promise<void> => {
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([path]);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};

export const moveImage = async (
  bucket: string,
  oldPath: string,
  newPath: string
): Promise<void> => {
  try {
    // Copy the file to the new location
    const { error: copyError } = await supabase.storage
      .from(bucket)
      .copy(oldPath, newPath);

    if (copyError) {
      throw copyError;
    }

    // Delete the old file
    const { error: deleteError } = await supabase.storage
      .from(bucket)
      .remove([oldPath]);

    if (deleteError) {
      // If delete fails, try to delete the new file to maintain consistency
      await supabase.storage
        .from(bucket)
        .remove([newPath]);
      throw deleteError;
    }
  } catch (error) {
    console.error('Error moving image:', error);
    throw error;
  }
};

export const generateUniqueFilename = (originalFilename: string): string => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);
  const extension = originalFilename.split('.').pop();
  return `${timestamp}-${randomString}.${extension}`;
}; 