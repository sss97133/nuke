import { useState, useEffect } from "react";
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
      if (!supabase) {
        console.error("[useEmailAuth] Supabase client not available");
        throw new Error("Supabase client not available");
      }
      
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

  // Check for Supabase port conflicts and log warning if detected
  useEffect(() => {
    const checkSupabaseConnection = async () => {
      try {
        if (!supabase) {
          console.warn('[useEmailAuth] Supabase client not initialized');
          return;
        }
        // Simple health check
        const { error } = await supabase.from('profiles').select('count').limit(1);
        if (error) {
          console.warn('[useEmailAuth] Possible Supabase connection issues:', error.message);
        }
      } catch (err) {
        console.warn('[useEmailAuth] Supabase health check failed:', err);
      }
    };
    
    if (typeof window !== 'undefined' && window.location.href.includes('localhost')) {
      checkSupabaseConnection();
    }
  }, []);

  const handleEmailLogin = async (email: string, password: string, isSignUp: boolean, avatarUrl?: string) => {
    try {
      setIsLoading(true);
      console.log("[useEmailAuth] Attempting email authentication, mode:", isSignUp ? "signup" : "login");

      if (isSignUp) {
        // Handle signup process
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
          // Create profile immediately for better user experience
          try {
            await createUserProfile(data.user.id, email, avatarUrl);
            console.log("[useEmailAuth] User profile created successfully");
          } catch (profileError) {
            console.error("[useEmailAuth] Profile creation error:", profileError);
            // Non-fatal, continue with signup flow
          }

          toast({
            title: "Account Created",
            description: "Please check your email to verify your account"
          });
        }
      } else {
        // Development mode with fallback handling for Supabase connection issues
        // This ensures login works even when there are Supabase port conflicts
        const isDevelopment = typeof window !== 'undefined' && window.location.href.includes('localhost');
        const forceMockMode = isDevelopment && (window.localStorage.getItem('force_mock_auth') === 'true');
        
        // Define types for data and error
        type SupabaseAuthData = Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'];
        type MockAuthData = {
          user: { 
            id: string;
            email: string | undefined;
            app_metadata: Record<string, any>;
            // Add other required User fields if necessary, or keep minimal
          };
          session: { 
            access_token: string;
            refresh_token: string;
            // Add other required Session fields if necessary, or keep minimal
          };
        };
        type AuthData = SupabaseAuthData | MockAuthData | null;

        if (error) {
          console.error("[useEmailAuth] Login error:", error);
          let errorTitle = "Login Error";
          let errorMessage = error.message;

          if (error.message.includes('Invalid login')) {
            errorMessage = "Invalid email or password.";
          } else if (error.message.includes("Database error")) {
            errorTitle = "Connection Error";
            errorMessage = "Unable to connect to the authentication service. Please try again later.";
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

        if (!data?.user || !data?.session) {
          console.error("[useEmailAuth] No user or session data returned");
          toast({
            variant: "destructive",
            title: "Login Error",
            description: "Unable to authenticate. Please try again later."
          });
          return;
        }

        // Check if the user has a profile in the profiles table
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        // If no profile found, create one
        if ((!profileData && !profileError) || (profileError && profileError.code === 'PGRST116')) {
          console.log("[useEmailAuth] Creating profile for existing user", data.user.id);
          try {
            await createUserProfile(data.user.id, email, avatarUrl);
          } catch (createError) {
            console.error("[useEmailAuth] Error creating profile for existing user:", createError);
            // Non-fatal, continue with login
          }
        }

        toast({
          title: "Welcome Back!",
          description: "You've been logged in successfully."
        });

        // SIMPLIFIED NAVIGATION - use a single reliable method
        console.log('[useEmailAuth] Login successful. Redirecting to /explore...');
        
        // Use React Router for SPA navigation
        try {
          navigate('/explore', { replace: true });
        } catch (e) {
          console.error('Navigation failed, using fallback:', e);
          // Fallback to basic redirect if React Router fails
          window.location.href = '/explore';
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
    if (!supabase) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Unable to connect to the authentication service."
      });
      return;
    }
    
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
