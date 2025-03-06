
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Name of the Supabase Storage bucket for avatars
const AVATAR_BUCKET = 'avatars';

export const useAvatarUpload = (userId: string, onSuccess: (url: string) => void) => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const uploadAvatar = async (file: File) => {
    try {
      setIsUploading(true);

      if (!file) {
        throw new Error('Please select an image to upload');
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Please upload an image file');
      }

      // Validate file size (max 2MB)
      if (file.size > 2 * 1024 * 1024) {
        throw new Error('Image size should be less than 2MB');
      }

      // Create a unique filename using the user ID and a timestamp
      const fileExt = file.name.split('.').pop();
      const fileName = `avatar-${userId}-${Date.now()}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      // Check if the bucket exists, and create it if it doesn't
      try {
        const { data: buckets } = await supabase
          .storage
          .listBuckets();
        
        const bucketExists = buckets?.some(bucket => bucket.name === AVATAR_BUCKET);
        
        if (!bucketExists) {
          console.log(`Bucket '${AVATAR_BUCKET}' does not exist, creating it...`);
          // In real application, we would create the bucket here if it doesn't exist,
          // but this requires admin privileges which the client typically doesn't have.
          // For this example, we'll assume the bucket already exists or handle the error.
        }
      } catch (bucketError) {
        console.warn('Could not check bucket existence:', bucketError);
        // Continue anyway, the upload will fail if the bucket doesn't exist
      }

      // Upload the file to Supabase Storage
      const { error: uploadError, data } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, file, { 
          upsert: true,
          contentType: file.type
        });

      if (uploadError) {
        console.error('Upload error details:', uploadError);
        throw uploadError;
      }

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(filePath);

      // Update profile with new avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (updateError) throw updateError;

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
