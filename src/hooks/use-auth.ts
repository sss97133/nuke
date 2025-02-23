
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
  // Check if we're in the preview environment
  if (window.location.hostname.includes('lovable.ai')) {
    console.log("[useAuth] Using preview URL:", window.location.origin);
    return window.location.origin;
  }
  // For local development
  if (window.location.hostname === 'localhost') {
    console.log("[useAuth] Using localhost URL");
    return 'http://localhost:5173';
  }
  // Default to the current origin (for production)
  console.log("[useAuth] Using default URL:", window.location.origin);
  return window.location.origin;
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
    let isSubscribed = true; // For cleanup

    const initializeAuth = async () => {
      try {
        console.log("[useAuth] Initializing auth...");
        
        // Get initial session
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error("[useAuth] Session retrieval error:", sessionError);
          throw sessionError;
        }

        console.log("[useAuth] Initial session check:", currentSession ? "Session exists" : "No session");
        
        if (isSubscribed) {
          setSession(currentSession);
        
          if (currentSession) {
            console.log("[useAuth] Session details:", {
              userId: currentSession.user.id,
              expiresAt: currentSession.expires_at,
              provider: currentSession.user.app_metadata.provider
            });
            await checkAndNavigate(currentSession.user.id);
          } else {
            console.log("[useAuth] No active session found");
          }
        }
      } catch (error: any) {
        console.error("[useAuth] Error initializing auth:", error);
        console.error("[useAuth] Error details:", {
          message: error.message,
          status: error.status,
          name: error.name,
          stack: error.stack
        });
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: "There was a problem initializing authentication. Please try refreshing the page."
        });
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      console.log("[useAuth] Auth state changed:", event, currentSession ? "Session exists" : "No session");
      
      if (event === 'SIGNED_IN' && currentSession) {
        console.log("[useAuth] Sign in event details:", {
          userId: currentSession.user.id,
          provider: currentSession.user.app_metadata.provider,
          event: event
        });
        if (isSubscribed) {
          setSession(currentSession);
          await checkAndNavigate(currentSession.user.id);
        }
      } else if (event === 'SIGNED_OUT') {
        console.log("[useAuth] User signed out");
        if (isSubscribed) {
          setSession(null);
          navigate('/login');
        }
      } else if (event === 'TOKEN_REFRESHED') {
        console.log("[useAuth] Token refreshed");
      }
    });

    // Cleanup subscription on unmount
    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  }, [navigate, checkAndNavigate, toast]);

  return {
    isLoading: loading || isSocialLoading || isPhoneLoading || isEmailLoading,
    session,
    handleSocialLogin: async (provider: Provider) => {
      try {
        const redirectTo = `${getRedirectBase()}/auth/callback`;
        console.log("[useAuth] Initiating social login with provider:", provider);
        console.log("[useAuth] Using redirect URL:", redirectTo);

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

        if (error) {
          console.error("[useAuth] Social login error:", error);
          throw error;
        }

        console.log("[useAuth] Social login successful:", data);
        return data;
      } catch (error: any) {
        console.error("[useAuth] Social login error:", {
          message: error.message,
          status: error.status,
          name: error.name
        });
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to sign in with social provider. Please try again."
        });
      }
    },
    handleLogout: async () => {
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        console.log("[useAuth] Successfully logged out");
        toast({
          title: "Logged Out",
          description: "See you next time!"
        });
        
        navigate('/login');
      } catch (error: any) {
        console.error("[useAuth] Logout error:", {
          message: error.message,
          status: error.status,
          name: error.name
        });
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
