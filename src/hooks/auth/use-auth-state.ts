
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
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let isMounted = true;
    console.log("[useAuthState] Initializing auth state, current pathname:", window.location.pathname);

    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("[useAuthState] Session error:", sessionError);
          throw sessionError;
        }

        if (!isMounted) return;

        console.log("[useAuthState] Initial session:", initialSession ? "exists" : "null");
        setSession(initialSession);

        if (initialSession?.user) {
          console.log("[useAuthState] User authenticated:", {
            id: initialSession.user.id,
            email: initialSession.user.email
          });
          if (window.location.pathname === '/login') {
            console.log("[useAuthState] Redirecting from login to dashboard");
            navigate('/dashboard');
          }
        } else {
          console.log("[useAuthState] No active session");
          if (window.location.pathname !== '/login') {
            console.log("[useAuthState] Redirecting to login");
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
          navigate('/login');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        console.log("[useAuthState] Auth state changed:", event, "Session:", currentSession ? "exists" : "null");
        
        if (!isMounted) return;

        setSession(currentSession);

        if (event === 'SIGNED_IN' && currentSession?.user) {
          console.log("[useAuthState] User signed in, navigating to dashboard");
          navigate('/dashboard');
        } else if (event === 'SIGNED_OUT') {
          console.log("[useAuthState] User signed out, navigating to login");
          navigate('/login');
        }
      }
    );

    // Initialize auth state
    initializeAuth();

    return () => {
      console.log("[useAuthState] Cleaning up auth state");
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, checkAndNavigate, toast]);

  return {
    loading: loading && !initialized,
    session
  };
};

