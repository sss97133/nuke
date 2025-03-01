
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SocialLinks, StreamingLinks } from '../types';

// Define JSON type for type safety
type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// Define interface for profile data from DB
interface ProfileFromDB {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  user_type: 'viewer' | 'professional' | string;
  reputation_score: number;
  social_links: Json;
  streaming_links: Json;
  created_at?: string;
  updated_at?: string;
}

// Define the return type of the hook for better type safety
interface ProfileDataResult {
  profile: {
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
    bio: string | null;
    user_type: 'viewer' | 'professional' | string;
    reputation_score: number;
    social_links: SocialLinks;
    streaming_links: StreamingLinks;
    achievements_count: number;
  } | null;
  achievements: {
    id: string;
    achievement_type: string;
    earned_at: string;
    achievement_data?: any;
  }[] | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export const useProfileData = (): ProfileDataResult => {
  const { toast } = useToast();
  
  const { 
    data: profile, 
    isLoading: profileLoading, 
    error: profileError, 
    refetch: refetchProfile 
  } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      console.log('🔍 Fetching user profile...');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('❌ No authenticated user found');
        throw new Error('You must be logged in to view this profile');
      }
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      
      if (error) {
        console.error('❌ Error fetching profile:', error);
        throw error;
      }
      
      console.log('✅ Profile data received:', data);
      
      // If data is null, return null (user not found)
      if (!data) return null;
      
      // Type casting and safe handling of JSON fields
      const profileData = data as ProfileFromDB;
      
      // Transform JSON fields to proper typed objects with safe fallbacks
      const parsedProfile = {
        ...profileData,
        social_links: parseSocialLinks(profileData.social_links),
        streaming_links: parseStreamingLinks(profileData.streaming_links),
      };
      
      return parsedProfile;
    },
  });

  const { 
    data: achievements, 
    isLoading: achievementsLoading,
    error: achievementsError
  } = useQuery({
    queryKey: ['achievements'],
    queryFn: async () => {
      console.log('🔍 Fetching user achievements...');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('user_achievements')
        .select('*')
        .eq('user_id', user.id)
        .order('earned_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error fetching achievements:', error);
        toast({
          title: 'Error loading achievements',
          description: error.message,
          variant: 'destructive',
        });
        return null;
      }

      console.log('✅ Achievements data received:', data);
      return data || null;
    },
    // Only fetch achievements if we have a profile
    enabled: !!profile,
  });

  // Helper function to safely parse social links
  const parseSocialLinks = (jsonData: Json): SocialLinks => {
    try {
      if (typeof jsonData === 'object' && jsonData !== null && !Array.isArray(jsonData)) {
        return {
          twitter: (jsonData as any).twitter || '',
          instagram: (jsonData as any).instagram || '',
          linkedin: (jsonData as any).linkedin || '',
          github: (jsonData as any).github || '',
        };
      }
      return { twitter: '', instagram: '', linkedin: '', github: '' };
    } catch (e) {
      console.error('Error parsing social links:', e);
      return { twitter: '', instagram: '', linkedin: '', github: '' };
    }
  };

  // Helper function to safely parse streaming links
  const parseStreamingLinks = (jsonData: Json): StreamingLinks => {
    try {
      if (typeof jsonData === 'object' && jsonData !== null && !Array.isArray(jsonData)) {
        return {
          twitch: (jsonData as any).twitch || '',
          youtube: (jsonData as any).youtube || '',
          tiktok: (jsonData as any).tiktok || '',
        };
      }
      return { twitch: '', youtube: '', tiktok: '' };
    } catch (e) {
      console.error('Error parsing streaming links:', e);
      return { twitch: '', youtube: '', tiktok: '' };
    }
  };

  // Combine errors
  const error = profileError || achievementsError || null;

  // Determine if we're loading any data
  const isLoading = profileLoading || achievementsLoading;

  // Combine the profile with the achievement count
  const enrichedProfile = profile ? {
    ...profile,
    achievements_count: achievements?.length || 0
  } : null;

  return {
    profile: enrichedProfile,
    achievements,
    isLoading,
    error: error as Error | null,
    refetch: refetchProfile
  };
};

