import { Json } from '@/integrations/supabase/types';

export interface SocialLinks {
  twitter?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  website?: string;
}

export interface StreamingLinks {
  twitch?: string;
  youtube?: string;
  instagram?: string;
  tiktok?: string;
}

export interface Profile {
  id: string;
  username: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  user_type: 'viewer' | 'professional' | null;
  reputation_score: number | null;
  created_at: string;
  updated_at: string;
  social_links: SocialLinks | null;
  streaming_links: StreamingLinks | null;
  skills: string[] | null;
  onboarding_completed: boolean | null;
  onboarding_step: number | null;
}

export type ProfileInsert = Omit<Profile, 'created_at' | 'updated_at'>;
export type ProfileUpdate = Partial<ProfileInsert>;

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

// Helper functions to safely convert Json to our types
export const toSocialLinks = (json: Json | null): SocialLinks => {
  const defaultLinks: SocialLinks = {
    twitter: '',
    instagram: '',
    facebook: '',
    linkedin: '',
    website: ''
  };
  
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return defaultLinks;
  }

  return {
    twitter: (json as any).twitter || '',
    instagram: (json as any).instagram || '',
    facebook: (json as any).facebook || '',
    linkedin: (json as any).linkedin || '',
    website: (json as any).website || ''
  };
};

export const toStreamingLinks = (json: Json | null): StreamingLinks => {
  const defaultLinks: StreamingLinks = {
    twitch: '',
    youtube: '',
    tiktok: ''
  };
  
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return defaultLinks;
  }

  return {
    twitch: (json as any).twitch || '',
    youtube: (json as any).youtube || '',
    tiktok: (json as any).tiktok || ''
  };
};

export const toJson = (obj: unknown): Json => {
  return JSON.parse(JSON.stringify(obj)) as Json;
};
