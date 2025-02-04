export interface SocialLinks {
  twitter: string;
  instagram: string;
  linkedin: string;
  github: string;
}

export interface StreamingLinks {
  twitch: string;
  youtube: string;
  tiktok: string;
}

export interface TeamMember {
  id: string;
  profile_id: string;
  member_type: 'employee' | 'contractor' | 'intern' | 'partner' | 'collaborator';
  department?: string;
  position?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}