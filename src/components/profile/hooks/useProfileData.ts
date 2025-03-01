
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
      return data;
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
        throw error;
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
