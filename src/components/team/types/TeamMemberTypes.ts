
// Define valid member types according to the database schema
export type MemberType = "employee" | "contractor" | "intern" | "partner" | "collaborator";

export type TeamMemberStatus = "active" | "inactive" | "pending";

export interface TeamMemberFormData {
  fullName: string;
  email: string;
  position: string;
  memberType: MemberType;
  department: string;
  status: TeamMemberStatus;
}

export interface AddTeamMemberFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}
