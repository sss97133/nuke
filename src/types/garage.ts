
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
