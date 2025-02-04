import type { Database } from "@/integrations/supabase/types";

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type GarageMember = Database['public']['Tables']['garage_members']['Row'];

export interface AddGarageMemberProps {
  garageId: string;
  onMemberAdded: () => void;
}