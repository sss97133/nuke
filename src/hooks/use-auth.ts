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
    const initializeAuth = async () => {
      try {
        console.log("[useAuth] Initializing auth...");
        
        // Configure auth redirect options
        const redirectTo = `${getRedirectBase()}/auth/callback`;
        
        // Get initial session
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        console.log("[useAuth] Initial session check:", currentSession ? "Session exists" : "No session");
        
        setSession(currentSession);
        
        if (currentSession) {
          console.log("[useAuth] Navigating with session userId:", currentSession.user.id);
          await checkAndNavigate(currentSession.user.id);
        } else {
          console.log("[useAuth] No session, staying on current page");
        }
      } catch (error) {
        console.error("[useAuth] Error initializing auth:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: "There was a problem initializing authentication. Please try refreshing the page."
        });
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[useAuth] Auth state changed:", event, session ? "Session exists" : "No session");
      
      if (event === 'SIGNED_IN' && session) {
        setSession(session);
        await checkAndNavigate(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        navigate('/login');
      }
    });

    return () => {
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
      } catch (error) {
        console.error("[useAuth] Social login error:", error);
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
      } catch (error) {
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
