
import { supabase } from '@/integrations/supabase/client';

export interface CarImportData {
  id?: string;
  make: string;
  model: string;
  year: number | string;
  color?: string;
  purchase_date?: string;
  purchase_price?: number | string;
  current_value?: number | string;
  mileage?: number | string;
  condition?: string;
  location?: string;
  vin?: string;
  license_plate?: string;
  insurance_policy?: string;
  notes?: string;
  icloud_album_link?: string;
  icloud_folder_id?: string;
}

export interface CarImageData {
  car_id: string;
  file_path: string;
  public_url?: string;
  file_name: string;
  is_primary?: boolean;
  image_type?: string;
  source: 'supabase' | 'icloud';
}

export type SupabaseClient = typeof supabase;
