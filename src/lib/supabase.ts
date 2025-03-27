import { supabase } from '@/integrations/supabase/client';
import { uploadVehicleImage, getPublicUrl } from '@/lib/image-upload';

// Re-export the Supabase client instance
export { supabase };

// Re-export specific functions, potentially renaming them for clarity within this module
export { uploadVehicleImage, getPublicUrl };

// You can add more specific utility functions here that build upon the base client functions
// For example, a function specifically for uploading user profile pictures:

/**
 * Uploads a user's profile picture.
 * @param userId The ID of the user.
 * @param file The image file to upload.
 * @returns The public URL of the uploaded image or null.
 */
