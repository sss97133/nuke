
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SocialLinks, StreamingLinks, toSocialLinks, toStreamingLinks } from '@/types/profile';

export const useProfileData = () => {
  const { toast } = useToast();
  
  const { data: profile, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (error) {
        toast({
          title: 'Error loading profile',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      
      return data;
    },
  });

  const { data: achievements } = useQuery({
    queryKey: ['achievements'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('user_achievements')
        .select('*')
        .eq('user_id', user.id)
        .order('earned_at', { ascending: false });
      
      if (error) {
        toast({
          title: 'Error loading achievements',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data || [];
    },
  });

  return {
    profile,
    achievements,
    refetch
  };
};
