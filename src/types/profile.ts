import { Json } from '@/integrations/supabase/types';

export interface Profile {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  user_type: 'viewer' | 'professional';
  reputation_score: number | null;
  created_at: string;
  updated_at: string;
  social_links: SocialLinks | null;
  streaming_links: StreamingLinks | null;
}

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

// Helper functions to safely convert Json to our types
export const toSocialLinks = (json: Json | null): SocialLinks => {
  const defaultLinks: SocialLinks = {
    twitter: '',
    instagram: '',
    linkedin: '',
    github: ''
  };
  
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return defaultLinks;
  }

  return {
    twitter: (json as any).twitter || '',
    instagram: (json as any).instagram || '',
    linkedin: (json as any).linkedin || '',
    github: (json as any).github || ''
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