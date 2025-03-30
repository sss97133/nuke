import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { AuthError, PostgrestError } from '@supabase/supabase-js';

export const useEmailAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const createUserProfile = async (userId: string, email: string, avatarUrl?: string) => {
    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([
          { 
            id: userId,
            email,
            avatar_url: avatarUrl,
            username: email.split('@')[0], // Default username from email
            full_name: '', // User can update later
            user_type: 'viewer', // Default user type
            onboarding_completed: false,
            onboarding_step: 0,
            bio: '',
            social_links: {},
            streaming_links: {},
            home_location: { lat: 40.7128, lng: -74.0060 }, // Default location
            skills: [],
            ai_analysis: {}
          }
        ]);

      if (profileError) {
        console.error("[useEmailAuth] Profile creation error:", profileError);
        throw profileError;
      }

      return true;
    } catch (error) {
      const pgError = error as PostgrestError;
      console.error("[useEmailAuth] Profile creation failed:", pgError);
      throw pgError;
    }
  };

  const handleEmailLogin = async (email: string, password: string, isSignUp: boolean, avatarUrl?: string) => {
    try {
      setIsLoading(true);
      console.log("[useEmailAuth] Attempting email authentication, mode:", isSignUp ? "signup" : "login");

      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        });

        if (error) {
          console.error("[useEmailAuth] Signup error:", error);
          let errorMessage = error.message;
          let errorTitle = "Signup Error";
          
          if (error.message.includes("User already registered")) {
            errorMessage = "This email is already registered. Please try logging in instead.";
          } else if (error.message.includes("Database error")) {
            errorTitle = "Database Connection Error";
            errorMessage = "Unable to create your account. Please try again later.";
          } else if (error.message.includes("network") || error.message.includes("timeout")) {
            errorTitle = "Network Error";
            errorMessage = "Unable to connect to the authentication service. Please check your internet connection and try again.";
          }
          
          toast({
            variant: "destructive",
            title: errorTitle,
            description: errorMessage
          });
          return;
        }

        if (data?.user) {
          // Only create profile if email is verified
          if (data.user.identities?.[0]?.identity_data?.email_verified) {
            await createUserProfile(data.user.id, email, avatarUrl);
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
          let errorTitle = "Login Error";
          let errorMessage = error.message;
          
          if (error.message.includes("Invalid login credentials")) {
            errorMessage = "Invalid email or password. Please try again.";
          } else if (error.message.includes("Email not confirmed")) {
            errorMessage = "Please verify your email before logging in.";
          } else if (error.message.includes("Database error")) {
            errorTitle = "Database Connection Error";
            errorMessage = "Unable to connect to the database. Please try again later.";
          } else if (error.message.includes("network") || error.message.includes("timeout")) {
            errorTitle = "Connection Error";
            errorMessage = "Unable to connect to the server. Please check your internet connection.";
          }
          
          toast({
            variant: "destructive",
            title: errorTitle,
            description: errorMessage
          });
          return;
        }

        if (data?.user) {
          // Check if profile exists, create if it doesn't
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', data.user.id)
            .single();

          if (profileError && profileError.code === 'PGRST116') {
            // Profile doesn't exist, create it
            await createUserProfile(data.user.id, email, avatarUrl);
          }

          toast({
            title: "Welcome Back!",
            description: "Successfully logged in"
          });
          navigate('/dashboard');
        }
      }
    } catch (error) {
      const authError = error as AuthError;
      console.error("[useEmailAuth] Unexpected error:", authError);
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: authError.message || "An unexpected error occurred. Please try again."
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (email: string) => {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login?reset=true`,
      });

      if (error) {
        console.error("[useEmailAuth] Password reset error:", error);
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
      const authError = error as AuthError;
      console.error("[useEmailAuth] Unexpected password reset error:", authError);
      toast({
        variant: "destructive",
        title: "Error",
        description: authError.message || "Failed to send password reset email. Please try again."
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    handleEmailLogin,
    handleForgotPassword,
  };
};
