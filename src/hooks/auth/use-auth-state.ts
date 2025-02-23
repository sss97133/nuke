
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuthNavigation } from "../use-auth-navigation";

export const useAuthState = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { checkAndNavigate } = useAuthNavigation();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("[useAuthState] Session error:", sessionError);
          throw sessionError;
        }

        if (!mounted) return;

        setSession(currentSession);
        
        if (currentSession?.user) {
          console.log("[useAuthState] User authenticated:", {
            id: currentSession.user.id,
            email: currentSession.user.email
          });
          await checkAndNavigate(currentSession.user.id);
        } else {
          console.log("[useAuthState] No active session");
          if (window.location.pathname !== '/login') {
            navigate('/login');
          }
        }
      } catch (error: any) {
        console.error("[useAuthState] Auth error:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: "Please try signing in again."
        });
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      console.log("[useAuthState] Auth state changed:", event);
      
      if (!mounted) return;

      if (event === 'SIGNED_IN' && currentSession) {
        setSession(currentSession);
        await checkAndNavigate(currentSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        navigate('/login');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, checkAndNavigate, toast]);

  return {
    loading,
    session
  };
};
