
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";
import { useSocialAuth } from "./use-social-auth";
import { usePhoneAuth } from "./use-phone-auth";
import { useEmailAuth } from "./use-email-auth";
import { useAuthNavigation } from "./use-auth-navigation";

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
    handleEmailLogin,
    handleForgotPassword,
    isLoading: isEmailLoading
  } = useEmailAuth();
  const { checkAndNavigate } = useAuthNavigation();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        console.log("[useAuth] Initial session found:", session);
        checkAndNavigate(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[useAuth] Auth state changed:", event, session ? "Session exists" : "No session");
      
      if (event === 'SIGNED_IN' && session) {
        await checkAndNavigate(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        navigate('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleSocialLogin = async (provider: Provider) => {
    console.log("[useAuth] Initiating social login with provider:", provider);
    await socialLogin(provider);
  };

  const handleLogout = async () => {
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
  };

  return {
    isLoading: isLoading || isSocialLoading || isPhoneLoading || isEmailLoading,
    handleSocialLogin,
    handleLogout,
    handlePhoneLogin: phoneLogin,
    verifyOtp: verifyPhoneOtp,
    handleEmailLogin,
    handleForgotPassword,
  };
};
