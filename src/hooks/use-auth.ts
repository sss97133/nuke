
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";
import { useSocialAuth } from "./use-social-auth";
import { usePhoneAuth } from "./use-phone-auth";

export const useAuth = () => {
  // All hooks must be called at the top level
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
      console.log("[useAuth] Attempting email authentication, mode:", isSignUp ? "signup" : "login");

      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        });

        if (error) {
          console.error("[useAuth] Signup error:", error);
          let errorMessage = error.message;
          if (error.message.includes("User already registered")) {
            errorMessage = "This email is already registered. Please try logging in instead.";
          }
          toast({
            variant: "destructive",
            title: "Signup Error",
            description: errorMessage
          });
          return;
        }

        if (data?.user) {
          toast({
            title: "Signup Successful",
            description: "Please check your email to verify your account"
          });
          return;
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          console.error("[useAuth] Login error:", error);
          let errorMessage = error.message;
          if (error.message.includes("Invalid login credentials")) {
            errorMessage = "Invalid email or password. Please try again.";
          }
          toast({
            variant: "destructive",
            title: "Login Error",
            description: errorMessage
          });
          return;
        }

        if (data?.user) {
          toast({
            title: "Login Successful",
            description: "Welcome back!"
          });
        }
      }
      
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

  const handleForgotPassword = async (email: string) => {
    try {
      setIsLoading(true);
      console.log("[useAuth] Sending password reset email to:", email);

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        console.error("[useAuth] Password reset error:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message
        });
        return;
      }

      toast({
        title: "Password Reset Email Sent",
        description: "Check your email for password reset instructions"
      });
      
      console.log("[useAuth] Password reset email sent successfully");
      
    } catch (error) {
      console.error("[useAuth] Unexpected error during password reset:", error);
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
    handleEmailLogin,
    handleForgotPassword
  };
};
