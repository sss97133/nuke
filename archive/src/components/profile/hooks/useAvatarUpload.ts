import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Name of the Supabase Storage bucket for avatars
const AVATAR_BUCKET = 'avatars';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_DIMENSION = 2048; // Maximum dimension for uploaded images

interface ValidationError {
  valid: false;
  error: string;
}

interface ValidationSuccess {
  valid: true;
}

type ValidationResult = ValidationError | ValidationSuccess;

const validateImageFile = (file: File): ValidationResult => {
  if (!file) {
    return {
      valid: false,
      error: 'No file selected'
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: 'File size must be less than 2MB'
    };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'File must be a JPEG, PNG, GIF, or WebP image'
    };
  }

  return { valid: true };
};

const validateImageDimensions = (file: File): Promise<ValidationResult> => {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // Clean up the object URL
      if (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION) {
        resolve({
          valid: false,
          error: `Image dimensions must be less than ${MAX_DIMENSION}x${MAX_DIMENSION} pixels`
        });
      } else {
        resolve({ valid: true });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl); // Clean up the object URL
      resolve({
        valid: false,
        error: 'Failed to load image for validation'
      });
    };

    img.src = objectUrl;
  });
};

const generateUniqueFileName = (file: File, prefix: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  return `${prefix}${timestamp}-${random}.${extension}`;
};

export const useAvatarUpload = (userId: string, onSuccess: (url: string) => void) => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const uploadAvatar = async (file: File) => {
    let uploadedFilePath: string | null = null;

    try {
      setIsUploading(true);

      // Validate the file
      const validation = validateImageFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Validate image dimensions
      const dimensionValidation = await validateImageDimensions(file);
      if (!dimensionValidation.valid) {
        throw new Error(dimensionValidation.error);
      }

      // Create a unique filename
      const fileName = generateUniqueFileName(file, `avatar-${userId}-`);
      const filePath = `${userId}/${fileName}`;
      uploadedFilePath = filePath;

      // Delete old avatar if it exists
      try {
        const { data: oldFiles } = await supabase.storage
          .from(AVATAR_BUCKET)
          .list(userId);

        if (oldFiles && oldFiles.length > 0) {
          const oldFilePaths = oldFiles.map(f => `${userId}/${f.name}`);
          await supabase.storage
            .from(AVATAR_BUCKET)
            .remove(oldFilePaths);
        }
      } catch (error) {
        console.error('Error cleaning up old avatars:', error);
        // Continue with upload even if cleanup fails
      }

      // Upload the file to Supabase Storage
      const { error: uploadError, data } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, file, { 
          upsert: true,
          contentType: file.type,
          cacheControl: '3600'
        });

      if (uploadError) {
        console.error('Upload error details:', uploadError);
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(filePath);

      // Call the success callback with the new URL
      onSuccess(publicUrl);
      
      return publicUrl;
    } catch (error) {
      console.error('Error uploading avatar:', error);
      
      // Clean up uploaded file if there was an error
      if (uploadedFilePath) {
        try {
          await supabase.storage
            .from(AVATAR_BUCKET)
            .remove([uploadedFilePath]);
        } catch (cleanupError) {
          console.error('Error cleaning up failed upload:', cleanupError);
        }
      }

      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload image',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  return {
    isUploading,
    uploadAvatar
  };
};
