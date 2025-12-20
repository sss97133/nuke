import { supabase } from '../../lib/supabase';

export const storageService = {
  /**
   * Upload a file to a specific bucket
   */
  upload: async (bucket: string, path: string, file: File) => {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;
    return data;
  },

  /**
   * Get the public URL for a file
   */
  getPublicUrl: (bucket: string, path: string) => {
    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);
    
    return data.publicUrl;
  },

  /**
   * Helper: Upload a vehicle image and get the public URL
   */
  uploadVehicleImage: async (vehicleId: string, file: File, userId?: string) => {
    const currentUserId = userId || (await supabase.auth.getUser()).data.user?.id;
    if (!currentUserId) throw new Error('User not authenticated');

    // Create a unique file path
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `vehicles/${vehicleId}/images/general/${fileName}`;

    // Upload
    await storageService.upload('vehicle-data', filePath, file);

    // Get URL
    return storageService.getPublicUrl('vehicle-data', filePath);
  },

  /**
   * Helper: Upload a document
   */
  uploadDocument: async (vehicleId: string, file: File, userId?: string, category = 'general') => {
    const currentUserId = userId || (await supabase.auth.getUser()).data.user?.id;
    if (!currentUserId) throw new Error('User not authenticated');

    const fileExt = file.name.split('.').pop();
    const fileName = `${category}_${Date.now()}.${fileExt}`;
    const filePath = `${vehicleId}/${currentUserId}/${fileName}`;

    await storageService.upload('vehicle-documents', filePath, file); // Assuming 'vehicle-documents' bucket
    
    return storageService.getPublicUrl('vehicle-documents', filePath);
  }
};

