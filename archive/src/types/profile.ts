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

interface JsonObject {
  [key: string]: string | number | boolean | null | JsonObject | JsonObject[];
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

  const obj = json as JsonObject;
  return {
    twitter: typeof obj.twitter === 'string' ? obj.twitter : '',
    instagram: typeof obj.instagram === 'string' ? obj.instagram : '',
    facebook: typeof obj.facebook === 'string' ? obj.facebook : '',
    linkedin: typeof obj.linkedin === 'string' ? obj.linkedin : '',
    website: typeof obj.website === 'string' ? obj.website : ''
  };
};

export const toStreamingLinks = (json: Json | null): StreamingLinks => {
  const defaultLinks: StreamingLinks = {
    twitch: '',
    youtube: '',
    instagram: '',
    tiktok: ''
  };
  
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return defaultLinks;
  }

  const obj = json as JsonObject;
  return {
    twitch: typeof obj.twitch === 'string' ? obj.twitch : '',
    youtube: typeof obj.youtube === 'string' ? obj.youtube : '',
    instagram: typeof obj.instagram === 'string' ? obj.instagram : '',
    tiktok: typeof obj.tiktok === 'string' ? obj.tiktok : ''
  };
};

export const toJson = (obj: unknown): Json => {
  return JSON.parse(JSON.stringify(obj)) as Json;
};
