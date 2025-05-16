
import { Json } from '@/integrations/supabase/types';

export interface AddGarageMemberProps {
  garageId: string;
  onMemberAdded: () => void;
}

export type Profile = {
  id: string;
  email: string;
  created_at?: string;
  updated_at?: string;
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  active_garage_id?: string | null;
  default_garage_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  home_location?: Json | null;  // Changed from Record<string, any> to Json
  onboarding_completed?: boolean;
  onboarding_step?: number;
  streaming_links?: Json | null;  // Changed from Record<string, any> to Json
  social_links?: Json | null;  // Changed from Record<string, any> to Json
};

export type GarageMember = {
  id: string;
  user_id: string;
  garage_id: string;
  created_at: string;
};

export type Garage = {
  id: string;
  name: string;
  address?: string | null;
  created_at: string;
};
