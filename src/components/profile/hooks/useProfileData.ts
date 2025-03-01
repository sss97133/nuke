
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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

export const useProfileData = () => {
  const { toast } = useToast();
  
  const { data: profile, isLoading, error, refetch } = useQuery({
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
      return data as ProfileFromDB;
    },
  });

  const { data: achievements, isLoading: achievementsLoading } = useQuery({
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
        return [];
      }

      console.log('✅ Achievements data received:', data);
      return data || [];
    },
  });

  return {
    profile,
    achievements,
    isLoading: isLoading || achievementsLoading,
    error,
    refetch
  };
};
