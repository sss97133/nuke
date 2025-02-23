
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
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Track if the component is mounted
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        // Get initial session
        const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("[useAuthState] Session error:", sessionError);
          throw sessionError;
        }

        // Only update state if component is still mounted
        if (!isMounted) return;

        setSession(initialSession);
        
        if (initialSession?.user) {
          console.log("[useAuthState] User authenticated:", {
            id: initialSession.user.id,
            email: initialSession.user.email
          });
          await checkAndNavigate(initialSession.user.id);
        } else {
          console.log("[useAuthState] No active session");
          if (window.location.pathname !== '/login') {
            navigate('/login');
          }
        }
      } catch (error: any) {
        console.error("[useAuthState] Auth error:", error);
        if (isMounted) {
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: "Please try signing in again."
          });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        console.log("[useAuthState] Auth state changed:", event);
        
        if (!isMounted) return;

        setSession(currentSession);

        if (event === 'SIGNED_IN' && currentSession?.user) {
          await checkAndNavigate(currentSession.user.id);
        } else if (event === 'SIGNED_OUT') {
          navigate('/login');
        }
      }
    );

    // Initialize auth state
    initializeAuth();

    // Cleanup function
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, checkAndNavigate, toast]);

  return {
    loading,
    session
  };
};
