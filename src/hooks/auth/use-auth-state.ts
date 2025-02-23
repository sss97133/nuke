
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
      
      setSession(currentSession);
      setIsLoading(false);

      if (currentSession?.user) {
        console.log("[useAuthState] Active session detected for user:", currentSession.user.email);
      } else {
        console.log("[useAuthState] No active session");
      }
    };

    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        console.log("[useAuthState] Auth state changed:", event);
        await handleAuthChange(currentSession);

        if (!isMounted) return;

        if (event === 'SIGNED_IN' && currentSession?.user) {
          console.log("[useAuthState] User signed in, checking navigation");
          await checkAndNavigate(currentSession.user.id);
        } else if (event === 'SIGNED_OUT') {
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
          return;
        }

        if (!isMounted) return;
        await handleAuthChange(initialSession);

        if (initialSession?.user) {
          console.log("[useAuthState] Initial session found, checking navigation");
          await checkAndNavigate(initialSession.user.id);
        }
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
