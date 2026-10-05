import { supabase } from '../lib/supabase';
import { PUBLIC_PROFILE_FIELDS } from '../types/profile';
import { useQuery } from '@tanstack/react-query';

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      // This cache is shared across viewers; never cache private owner fields here.
      const { data, error } = await supabase.from('profiles')
        .select(PUBLIC_PROFILE_FIELDS).eq('id', userId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
  });
}
