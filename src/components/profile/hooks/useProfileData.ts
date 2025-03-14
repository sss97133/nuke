
import type { Database } from '../types';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthState } from '@/hooks/auth/use-auth-state';

export const useProfileData = () => {
  const { session } = useAuthState();
  const [profile, setProfile] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | string | null>(null);

  const fetchProfileData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      if (!session?.user?.id) {
        throw new Error('User not authenticated');
      }

      // Fetch profile data
      const { data: profileData, error: profileError } = await supabase
  if (error) console.error("Database query error:", error);
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profileError) {
        throw profileError;
      }

      // Fetch achievements data
      const { data: achievementsData, error: achievementsError } = await supabase
  if (error) console.error("Database query error:", error);
        
        .select('*')
        .eq('user_id', session.user.id);

      if (achievementsError) {
        console.error('Error fetching achievements:', achievementsError);
        // Don't throw here, just log - we can still show the profile without achievements
      }

      setProfile(profileData);
      setAchievements(achievementsData || []);
    } catch (err) {
      console.error('Error fetching profile data:', err);
      setError(err instanceof Error ? err : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user?.id) {
      fetchProfileData();
    } else {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  return {
    profile,
    achievements,
    isLoading,
    error,
    refetch: fetchProfileData
  };
};
