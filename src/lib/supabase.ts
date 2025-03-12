
// Re-export the enhanced Supabase client with proper environment handling
export { 
  supabase,
  safeSelect,
  uploadVehicleImage,
  VehicleImageCategory,
  ImagePosition,
  type UploadProgress,
  type ProgressCallback
} from '@/integrations/supabase/client';
