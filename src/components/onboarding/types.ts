/**
 * Types for the onboarding module
 */

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
          avatar_url: string;
          user_type: 'viewer' | 'professional';
          social_links: {
            twitter: string;
            instagram: string;
            linkedin: string;
            github: string;
          };
          streaming_links: {
            twitch: string;
            youtube: string;
            tiktok: string;
          };
          skills: string[];
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
          avatar_url: string;
          user_type: 'viewer' | 'professional';
          social_links: {
            twitter: string;
            instagram: string;
            linkedin: string;
            github: string;
          };
          streaming_links: {
            twitch: string;
            youtube: string;
            tiktok: string;
          };
          skills: string[];
          onboarding_completed: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          username?: string;
          avatar_url?: string;
          user_type?: 'viewer' | 'professional';
          social_links?: {
            twitter: string;
            instagram: string;
            linkedin: string;
            github: string;
          };
          streaming_links?: {
            twitch: string;
            youtube: string;
            tiktok: string;
          };
          skills?: string[];
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
} 