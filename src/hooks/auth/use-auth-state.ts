import { useState, useEffect, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, handleSupabaseError } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useAuthState = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  const fetchSession = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('[useAuthState] Error fetching session:', error);
        setError(error);
        toast({
          title: "Authentication Error",
          description: "We're having trouble verifying your login. Please try again.",
          variant: "destructive",
        });
        setSession(null);
        return;
      }
      
      if (data?.session) {
        console.info('[useAuthState] Active session detected, user:', data.session.user?.email);
        setSession(data.session);
      } else {
        console.info('[useAuthState] No active session found');
        setSession(null);
      }
    } catch (err) {
      console.error('[useAuthState] Unexpected error in auth state:', err);
      setError(err instanceof Error ? err : new Error('Unknown authentication error'));
      toast({
        title: "Authentication Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
      setSession(null);
    }
  }, [toast]);

  useEffect(() => {
    console.info('[useAuthState] Setting up auth state management');
    let mounted = true;
    const timeoutId = setTimeout(() => {
      if (mounted && loading) {
        console.warn('[useAuthState] Loading timeout reached, forcing state update');
        setLoading(false);
        setError(new Error('Authentication timed out. Please refresh the page.'));
        toast({
          title: "Authentication Timeout",
          description: "Taking longer than expected. Please refresh the page.",
          variant: "destructive",
        });
      }
    }, 10000); // 10 second timeout

    // Initialize by fetching the session
    fetchSession().finally(() => {
      if (mounted) setLoading(false);
    });

    // Set up auth state change listener
    const { data } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.info('[useAuthState] Auth event:', event);
      
      if (mounted) {
        if (newSession) {
          console.info('[useAuthState] Auth state changed, user:', newSession.user?.email);
          setSession(newSession);
        } else {
          setSession(null);
        }
        setLoading(false);
      }
    });



    // Clean up
    return () => {
      console.info('[useAuthState] Cleaning up auth state');
      mounted = false;
      clearTimeout(timeoutId);
      if (data) data.subscription.unsubscribe();
    };
  }, [fetchSession, toast]);

  return { session, loading, error };
};
