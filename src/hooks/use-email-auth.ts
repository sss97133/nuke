
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const useEmailAuth = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const handleEmailLogin = async (email: string, password: string, isSignUp: boolean, avatarUrl?: string) => {
    try {
      setIsLoading(true);
      console.log("[useEmailAuth] Attempting email authentication, mode:", isSignUp ? "signup" : "login");

      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`
          }
        });

        if (error) {
          console.error("[useEmailAuth] Signup error:", error);
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
                email: data.user.email,
                avatar_url: avatarUrl
              }
            ]);

          if (profileError) {
            console.error("[useEmailAuth] Profile creation error:", profileError);
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
          console.error("[useEmailAuth] Login error:", error);
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
        }
      }
    } catch (error) {
      console.error("[useEmailAuth] Unexpected error:", error);
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
      console.error("[useEmailAuth] Unexpected password reset error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send password reset email. Please try again."
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
