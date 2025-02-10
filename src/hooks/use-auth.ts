
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";
import { useSocialAuth } from "./use-social-auth";
import { usePhoneAuth } from "./use-phone-auth";

export const useAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { handleSocialLogin: socialLogin, isLoading: isSocialLoading } = useSocialAuth();
  const { 
    handlePhoneLogin: phoneLogin, 
    verifyOtp: verifyPhoneOtp,
    isLoading: isPhoneLoading 
  } = usePhoneAuth();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Handle initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        console.log("[useAuth] Initial session found:", session);
        navigate('/dashboard');
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[useAuth] Auth state changed:", event, session ? "Session exists" : "No session");
      
      if (event === 'SIGNED_IN' && session) {
        navigate('/dashboard');
      } else if (event === 'SIGNED_OUT') {
        navigate('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleEmailLogin = async (email: string, password: string, isSignUp: boolean) => {
    try {
      setIsLoading(true);
      console.log("[useAuth] Attempting email authentication...");

      const { data, error } = isSignUp 
        ? await supabase.auth.signUp({
            email,
            password,
          })
        : await supabase.auth.signInWithPassword({
            email,
            password,
          });

      if (error) {
        console.error("[useAuth] Email auth error:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error.message
        });
        return;
      }

      if (isSignUp && data?.user) {
        toast({
          title: "Account created",
          description: "Please check your email to verify your account"
        });
      }

      console.log("[useAuth] Email authentication successful:", data);
      
    } catch (error) {
      console.error("[useAuth] Unexpected error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again."
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      console.log("[useAuth] Successfully logged out");
      toast({
        title: "Logged out",
        description: "Successfully logged out",
      });
      
      localStorage.clear();
      sessionStorage.clear();
      
      navigate('/login');
      
    } catch (error) {
      console.error("[useAuth] Logout error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to log out. Please try again.",
      });
    }
  };

  return {
    isLoading: isLoading || isSocialLoading || isPhoneLoading,
    handleSocialLogin: socialLogin,
    handleLogout,
    handlePhoneLogin: phoneLogin,
    verifyOtp: verifyPhoneOtp,
    handleEmailLogin
  };
};
