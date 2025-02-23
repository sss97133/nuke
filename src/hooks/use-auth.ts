
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";
import { useSocialAuth } from "./use-social-auth";
import { usePhoneAuth } from "./use-phone-auth";
import { useEmailAuth } from "./use-email-auth";
import { useAuthNavigation } from "./use-auth-navigation";

// Get the base URL for auth redirects
const getRedirectBase = () => {
  // Using a single source of truth for host/origin
  const origin = window.location.origin;
  const hostname = window.location.hostname;
  
  console.log("[useAuth] Current origin:", origin);

  if (hostname.includes('lovable.ai')) {
    return origin;
  }
  
  if (hostname === 'localhost') {
    return 'http://localhost:5173';
  }

  return origin;
};

export const useAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { handleSocialLogin: socialLogin, isLoading: isSocialLoading } = useSocialAuth();
  const { 
    handlePhoneLogin: phoneLogin, 
    verifyOtp: verifyPhoneOtp,
    isLoading: isPhoneLoading 
  } = usePhoneAuth();
  const {
    handleEmailLogin: emailLogin,
    handleForgotPassword,
    isLoading: isEmailLoading
  } = useEmailAuth();
  const { checkAndNavigate } = useAuthNavigation();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("[useAuth] Session error:", sessionError);
          throw sessionError;
        }

        if (!mounted) return;

        setSession(currentSession);
        
        if (currentSession?.user) {
          console.log("[useAuth] User authenticated:", {
            id: currentSession.user.id,
            email: currentSession.user.email
          });
          await checkAndNavigate(currentSession.user.id);
        } else {
          console.log("[useAuth] No active session");
          if (window.location.pathname !== '/login') {
            navigate('/login');
          }
        }
      } catch (error: any) {
        console.error("[useAuth] Auth error:", error);
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
      console.log("[useAuth] Auth state changed:", event);
      
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
    isLoading: loading || isSocialLoading || isPhoneLoading || isEmailLoading,
    session,
    handleSocialLogin: async (provider: Provider) => {
      try {
        const redirectTo = `${getRedirectBase()}/auth/callback`;
        
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo,
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
          }
        });

        if (error) throw error;
        return data;
      } catch (error: any) {
        console.error("[useAuth] Social login error:", error);
        toast({
          variant: "destructive",
          title: "Login Error",
          description: "Could not complete social login. Please try again."
        });
      }
    },
    handleLogout: async () => {
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        toast({
          title: "Logged Out",
          description: "You have been successfully logged out."
        });
        
        navigate('/login');
      } catch (error: any) {
        console.error("[useAuth] Logout error:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to log out. Please try again."
        });
      }
    },
    handlePhoneLogin: phoneLogin,
    verifyOtp: verifyPhoneOtp,
    handleEmailLogin: emailLogin,
    handleForgotPassword
  };
};
