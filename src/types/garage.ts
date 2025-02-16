
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
  home_location?: Record<string, any> | null;
  onboarding_completed?: boolean;
  onboarding_step?: number;
  streaming_links?: Record<string, any> | null;
  social_links?: Record<string, any> | null;
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
