
import { useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, handleSupabaseError } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useAuthState = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    console.info('[useAuthState] Setting up auth state management');

    let mounted = true;
    
    const fetchSession = async () => {
      try {
        setLoading(true);
        
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[useAuthState] Error fetching session:', error);
          if (mounted) {
            setError(error);
            toast({
              title: "Authentication Error",
              description: "We're having trouble verifying your login. Please try again.",
              variant: "destructive",
            });
          }
          return;
        }
        
        if (mounted) {
          if (data?.session) {
            console.info('[useAuthState] Auth event: INITIAL_SESSION');
            console.info('[useAuthState] Auth state changed, session:', data.session.user?.email);
            console.info('[useAuthState] Active session detected, checking navigation');
          } else {
            console.info('[useAuthState] No active session found');
          }
          
          setSession(data.session);
        }
      } catch (err) {
        console.error('[useAuthState] Unexpected error in auth state:', err);
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Unknown authentication error'));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Initialize by fetching the session
    fetchSession();

    // Set up auth state change listener
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.info('[useAuthState] Auth event:', event);
      
      if (mounted) {
        if (newSession) {
          console.info('[useAuthState] Auth state changed, session:', newSession.user?.email);
          console.info('[useAuthState] Active session detected, checking navigation');
        }
        
        setSession(newSession);
        setLoading(false);
      }
    });

    // Clean up the listener when the component unmounts
    return () => {
      console.info('[useAuthState] Cleaning up auth state');
      mounted = false;
      if (authListener) authListener.subscription.unsubscribe();
    };
  }, [toast]);

  // Return the session and loading state
  return { session, loading, error };
};
