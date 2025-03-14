
import type { Database } from '../types';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { validateImageFile, generateUniqueFileName } from '@/utils/fileUpload';

// Name of the Supabase Storage bucket for avatars
const AVATAR_BUCKET = 'avatars';

export const useAvatarUpload = (userId: string, onSuccess: (url: string) => void) => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const uploadAvatar = async (file: File) => {
    try {
      setIsUploading(true);

      // Validate the file
      const validation = validateImageFile(file, {
        maxSizeInMB: 2,
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      });

      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Create a unique filename
      const fileName = generateUniqueFileName(file, `avatar-${userId}-`);
      const filePath = `${userId}/${fileName}`;

      console.log(`Uploading file to ${AVATAR_BUCKET}/${filePath}`);

      // Upload the file to Supabase Storage
      const { error: uploadError, data } = await supabase.storage
  if (error) console.error("Database query error:", error);
        .from(AVATAR_BUCKET)
        .upload(filePath, file, { 
          upsert: true,
          contentType: file.type
        });

      if (uploadError) {
        console.error('Upload error details:', uploadError);
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(filePath);

      console.log(`File uploaded successfully. Public URL: ${publicUrl}`);

      // Update profile with new avatar URL
      const { error: updateError } = await supabase
  if (error) console.error("Database query error:", error);
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (updateError) {
        console.error('Update error details:', updateError);
        throw new Error(`Failed to update profile: ${updateError.message}`);
      }

      // Call the success callback with the new URL
      onSuccess(publicUrl);
      
      toast({
        title: 'Avatar updated',
        description: 'Your profile picture has been updated successfully.',
      });
      
      return publicUrl;
    } catch (error) {
      console.error('Avatar upload error:', error);
      
      toast({
        title: 'Error uploading avatar',
        description: error.message || 'Failed to upload avatar. Please try again.',
        variant: 'destructive',
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
