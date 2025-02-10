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

  const checkAndNavigate = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', userId)
        .single();

      if (error) throw error;

      if (!profile || !profile.onboarding_completed) {
        navigate('/onboarding');
      } else {
        navigate('/dashboard');
      }
    } catch (error) {
      console.error("[useAuth] Profile check error:", error);
      navigate('/onboarding');
    }
  };

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
          toast({
            variant: "destructive",
            title: "Signup Error",
            description: error.message.includes("User already registered") 
              ? "This email is already registered. Please try logging in instead."
              : error.message
          });
          return;
        }

        if (data?.user) {
          const { error: profileError } = await supabase
            .from('profiles')
            .insert([
              { 
                id: data.user.id,
                email: data.user.email
              }
            ]);

          if (profileError) {
            console.error("[useAuth] Profile creation error:", profileError);
          }

          toast({
            title: "Account Created",
            description: "Please check your email to verify your account"
          });
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          console.error("[useAuth] Login error:", error);
          toast({
            variant: "destructive",
            title: "Login Error",
            description: error.message.includes("Invalid login credentials")
              ? "Invalid email or password. Please try again."
              : error.message
          });
          return;
        }

        if (data?.user) {
          toast({
            title: "Welcome Back!",
            description: "Successfully logged in"
          });
          await checkAndNavigate(data.user.id);
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
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?reset=true`,
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
        description: "Please check your email for password reset instructions"
      });
    } catch (error) {
      console.error("[useAuth] Unexpected password reset error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send password reset email. Please try again."
      });
    } finally {
      setIsLoading(false);
    }
  };

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
    isLoading: isLoading || isSocialLoading || isPhoneLoading,
    handleSocialLogin,
    handleLogout,
    handlePhoneLogin: phoneLogin,
    verifyOtp: verifyPhoneOtp,
    handleEmailLogin,
    handleForgotPassword,
  };
};
