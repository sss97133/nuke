import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import type { User, Session } from '@supabase/supabase-js';

export const useAuthState = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[useAuthState] Auth state changed:', event);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      if (event === 'SIGNED_IN') {
        // Check if profile exists
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', session?.user.id)
          .single();

        if (profileError && profileError.code === 'PGRST116') {
          // Profile doesn't exist, create it
          const { error: createError } = await supabase
            .from('profiles')
            .insert([
              {
                id: session?.user.id,
                email: session?.user.email,
                username: session?.user.email?.split('@')[0],
                full_name: '',
                user_type: 'viewer',
                onboarding_completed: false,
                onboarding_step: 0,
                bio: '',
                social_links: {},
                streaming_links: {},
                home_location: { lat: 40.7128, lng: -74.0060 },
                skills: [],
                ai_analysis: {}
              }
            ]);

          if (createError) {
            console.error('[useAuthState] Profile creation error:', createError);
            toast({
              variant: 'destructive',
              title: 'Profile Creation Failed',
              description: 'Unable to create your profile. Please try again.'
            });
          }
        }

        toast({
          title: 'Welcome Back!',
          description: 'Successfully logged in'
        });
        navigate('/dashboard');
      } else if (event === 'SIGNED_OUT') {
        toast({
          title: 'Signed Out',
          description: 'You have been successfully signed out'
        });
        navigate('/');
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('[useAuthState] Session refreshed');
      }
    });

    // Set up session refresh interval
    const refreshInterval = setInterval(async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (currentSession) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          console.error('[useAuthState] Session refresh error:', refreshError);
          // If refresh fails, sign out the user
          await supabase.auth.signOut();
        }
      }
    }, 1000 * 60 * 30); // Refresh every 30 minutes

    return () => {
      subscription.unsubscribe();
      clearInterval(refreshInterval);
    };
  }, [navigate, toast]);

  return {
    user,
    session,
    loading,
  };
};
