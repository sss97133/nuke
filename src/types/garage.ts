export interface AddGarageMemberProps {
  garageId: string;
  onMemberAdded: () => void;
}

export type Profile = {
  id: string;
  email?: string;
};

export type GarageMember = {
  id: string;
  user_id: string;
  garage_id: string;
  created_at: string;
};