
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuthNavigation } from "../use-auth-navigation";
import { Session } from "@supabase/supabase-js";

export const useAuthState = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { checkAndNavigate } = useAuthNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let isMounted = true;
    console.log("[useAuthState] Setting up auth state management");

    const handleAuthChange = async (currentSession: Session | null) => {
      if (!isMounted) return;
      
      console.log("[useAuthState] Auth state changed, session:", currentSession?.user?.email);
      
      setSession(currentSession);
      setIsLoading(false);

      // Only proceed with navigation if mounted
      if (currentSession?.user) {
        console.log("[useAuthState] Active session detected, checking navigation");
        try {
          await checkAndNavigate(currentSession.user.id);
        } catch (error) {
          console.error("[useAuthState] Navigation check failed:", error);
          // Don't throw - handle gracefully and stay on current page
          toast({
            variant: "destructive",
            title: "Navigation Error",
            description: "There was an error loading your profile. Please try refreshing the page."
          });
        }
      }
    };

    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        console.log("[useAuthState] Auth event:", event);

        if (!isMounted) return;

        await handleAuthChange(currentSession);

        if (event === 'SIGNED_OUT') {
          console.log("[useAuthState] User signed out, redirecting to login");
          navigate('/login');
        }
      }
    );

    // Get initial session
    supabase.auth.getSession().then(
      async ({ data: { session: initialSession }, error }) => {
        if (error) {
          console.error("[useAuthState] Error getting initial session:", error);
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: "Please try signing in again."
          });
          setIsLoading(false);
          return;
        }

        if (!isMounted) return;
        await handleAuthChange(initialSession);
      }
    );

    return () => {
      console.log("[useAuthState] Cleaning up auth state");
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, checkAndNavigate, toast]);

  return {
    loading: isLoading,
    session
  };
};

