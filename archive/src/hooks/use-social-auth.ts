import { useState } from "react";
import { Provider, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useSocialAuth = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const handleSocialLogin = async (provider: Provider) => {
    try {
      setIsLoading(true);
      console.log("[useSocialAuth] Starting OAuth flow with provider:", provider);
      
      // Get the current URL to handle mobile devices properly
      const currentUrl = window.location.origin;
      const redirectUrl = `${currentUrl}/auth/callback`;
      
      console.log("[useSocialAuth] Using redirect URL:", redirectUrl);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          }
        }
      });

      if (error) {
        console.error("[useSocialAuth] OAuth error:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error.message
        });
        return;
      }

      if (!data?.url) {
        console.error("[useSocialAuth] No OAuth URL returned");
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: "Failed to start authentication process"
        });
        return;
      }

      console.log("[useSocialAuth] Opening OAuth URL:", data.url);
      // Navigate to the auth URL returned by Supabase
      window.location.href = data.url;
      
    } catch (error) {
      const authError = error as AuthError;
      console.error("[useSocialAuth] Unexpected error:", authError);
      toast({
        variant: "destructive",
        title: "Error",
        description: authError.message || "Failed to sign in. Please try again."
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    handleSocialLogin
  };
};
