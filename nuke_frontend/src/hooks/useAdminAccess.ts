import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';

type AdminAccessState = {
  loading: boolean;
  isAdmin: boolean;
  refresh: () => void;
};

export function useAdminAccess(): AdminAccessState {
  const { user } = useAuth();
  const { data: isAdmin = false, isLoading, refetch } = useQuery({
    queryKey: ['admin-status', user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from('admin_users')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000, // 10 min
  });
  return { isAdmin, loading: isLoading, refresh: refetch };
}
