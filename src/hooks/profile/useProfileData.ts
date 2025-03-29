import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import type { Profile, ProfileInsert, ProfileUpdate } from '@/types/profile';
import { useToast } from '@/hooks/use-toast';

export const useProfileData = () => {
  const { session } = useAuthState();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfile = async () => {
    if (!session?.user?.id) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (fetchError) throw fetchError;
      setProfile(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch profile'));
    } finally {
      setIsLoading(false);
    }
  };

  const updateProfile = async (updates: ProfileUpdate) => {
    if (!session?.user?.id) {
      throw new Error('No authenticated user');
    }

    try {
      // First, check if profile exists
      const { data: existingProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "not found"
        throw fetchError;
      }

      if (!existingProfile) {
        // Create new profile if it doesn't exist
        const { data, error: createError } = await supabase
          .from('profiles')
          .insert([{
            id: session.user.id,
            ...updates,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (createError) throw createError;
        setProfile(data);
      } else {
        // Update existing profile
        const { data, error: updateError } = await supabase
          .from('profiles')
          .update({
            ...updates,
            updated_at: new Date().toISOString()
          })
          .eq('id', session.user.id)
          .select()
          .single();

        if (updateError) throw updateError;
        setProfile(data);
      }

      toast({
        title: 'Profile Updated',
        description: 'Your profile has been successfully updated.'
      });
    } catch (err) {
      console.error('Error updating profile:', err);
      toast({
        title: 'Update Failed',
        description: err instanceof Error ? err.message : 'Failed to update profile. Please try again.',
        variant: 'destructive'
      });
      throw err;
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [session?.user?.id]);

  return {
    profile,
    isLoading,
    error,
    updateProfile,
    refetch: fetchProfile
  };
}; 