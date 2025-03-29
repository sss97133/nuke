import type { Database } from '@/types/database'; 
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

export const useEmailAuth = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
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
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        });

        if (error) {
          // Log the detailed error for debugging
          console.error("[useEmailAuth] Signup error:", error);
          console.error("[useEmailAuth] Error details:", JSON.stringify(error, null, 2));
          
          // Determine a user-friendly error message based on the error type or content
          let errorMessage = error.message;
          let errorTitle = "Signup Error";
          
          if (error.message.includes("User already registered")) {
            errorMessage = "This email is already registered. Please try logging in instead.";
          } else if (error.message.includes("Database error")) {
            // Database-specific error handling
            errorTitle = "Database Connection Error";
            errorMessage = `Database error: ${error.message}. This could be due to schema issues or missing columns.`;
            
            // Log additional information about the database error
            console.error("[useEmailAuth] Database error details:", error);
          } else if (error.message.includes("network") || error.message.includes("timeout")) {
            errorTitle = "Network Error";
            errorMessage = "Unable to connect to the authentication service. Please check your internet connection and try again.";
          }
          
          // Display the error to the user
          toast({
            variant: "destructive",
            title: errorTitle,
            description: errorMessage
          });
          
          // Also show the error in the console in a more visible format
          console.error("%c[AUTHENTICATION ERROR]%c " + errorTitle + ": " + errorMessage, 
            "background: #FF0000; color: white; padding: 2px 4px; border-radius: 2px;", 
            "color: #FF0000; font-weight: bold;");
            
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
        // Enhanced logging for local development troubleshooting
        console.log('[useEmailAuth] Supabase client config:', JSON.stringify(supabase.auth)); 
        console.log('[useEmailAuth] Current environment variables:', {
          url: import.meta.env?.VITE_SUPABASE_URL,
          key: import.meta.env?.VITE_SUPABASE_ANON_KEY ? '[REDACTED]' : 'undefined',
          baseUrl: window.location.origin,
        });
        
        // Check Supabase service health before attempting login
        try {
          const response = await fetch(`${import.meta.env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'}/auth/v1/health`);
          console.log(`[useEmailAuth] Supabase health check: ${response.status}`, await response.text().catch(e => 'Error reading response'));
        } catch (healthError) {
          console.error('[useEmailAuth] Supabase health check failed:', healthError);
        }
        
        // Proceed with login attempt
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          // Log detailed error information for debugging
          console.error("[useEmailAuth] Login error:", error);
          console.error("[useEmailAuth] Full error details:", JSON.stringify(error, null, 2));
          
          // Determine a user-friendly error message based on the error
          let errorTitle = "Login Error";
          let errorMessage = error.message;
          
          if (error.message.includes("Invalid login credentials")) {
            errorMessage = "Invalid email or password. Please try again.";
          } else if (error.message.includes("Database error") || error.message.includes("finding user")) {
            errorTitle = "Database Connection Error";
            errorMessage = `Database error: ${error.message}. This may be due to:
            - Schema issues or missing tables
            - Port conflicts (check if ports 54321-54324 are available)
            - Docker container issues
            
Try running 'supabase stop' followed by 'supabase start'.`;
          } else if (error.message.includes("network") || error.message.includes("timeout") || error.message.includes("connection")) {
            errorTitle = "Connection Error";
            errorMessage = `Unable to connect to Supabase (${import.meta.env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'}).
Check if your local Supabase is running properly.`;
          }
          
          toast({
            variant: "destructive",
            title: errorTitle,
            description: errorMessage
          });
          
          // Highlight the error in console for easier debugging
          console.error("%c[SUPABASE LOGIN ERROR]%c " + errorTitle + ": " + errorMessage, 
            "background: #FF0000; color: white; padding: 2px 4px; border-radius: 2px;", 
            "color: #FF0000; font-weight: bold;");
          return;
        }

        if (data?.user) {
          toast({
            title: "Welcome Back!",
            description: "Successfully logged in"
          });
          navigate('/dashboard');
        }
      }
    } catch (error: any) {
      console.error("[useEmailAuth] Unexpected error:", error);
      
      // Create specific error message based on error type
      let errorTitle = "Authentication Error";
      let errorDescription = "An unexpected error occurred. Please try again.";
      
      // Check for network/connection issues
      if (error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('connection')) {
        errorTitle = "Supabase Connection Error";
        errorDescription = `Unable to connect to Supabase at ${import.meta.env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'}. 

Possible solutions:
- Check if Supabase is running (run 'docker ps | grep supabase')
- Check for port conflicts on 54321-54324 (run 'lsof -i :54321-54324')
- Try restarting Supabase with 'supabase stop' followed by 'supabase start'
- Verify your .env.local has the correct values`;
      } 
      // Check for Schema/DB issues
      else if (error.message?.includes('database') || error.message?.includes('relation') || error.message?.includes('column')) {
        errorTitle = "Database Schema Error";
        errorDescription = `Database schema issue detected: ${error.message}\n\nThis may indicate missing tables or columns required by your application.`;
      }
      // Check for auth configuration
      else if (error.message?.includes('configuration') || error.message?.includes('credentials')) {
        errorTitle = "Auth Configuration Error";
        errorDescription = `Authentication configuration issue: ${error.message}\n\nCheck your environment variables and Supabase setup.`;
      }
      
      // Log comprehensive debug info
      console.error("%c[AUTHENTICATION SYSTEM ERROR]%c", 
        "background: #FF0000; color: white; font-weight: bold; padding: 2px 6px; border-radius: 2px;", 
        "color: inherit;");
      console.error("Error Title:", errorTitle);
      console.error("Error Description:", errorDescription);
      console.error("Original Error:", error);
      console.error("Environment Variables:", {
        VITE_SUPABASE_URL: import.meta.env?.VITE_SUPABASE_URL || 'undefined',
        VITE_SUPABASE_ANON_KEY: import.meta.env?.VITE_SUPABASE_ANON_KEY ? '[PRESENT]' : 'undefined'
      });
      console.error("Local Development URLs (for reference):", {
        "API URL": "http://127.0.0.1:54321",
        "Database URL": "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "Studio URL": "http://127.0.0.1:54323",
        "Inbucket URL": "http://127.0.0.1:54324"
      });
      
      toast({
        variant: "destructive",
        title: errorTitle,
        description: errorDescription
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
