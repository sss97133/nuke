
import { useState } from "react";
import { Provider } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useSocialAuth = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const handleSocialLogin = async (provider: Provider) => {
    try {
      setIsLoading(true);
      console.log("[useSocialAuth] Starting OAuth flow with provider:", provider);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: 'read:user user:email',
          skipBrowserRedirect: true
        }
      });

      if (error) {
        console.error("[useSocialAuth] OAuth error details:", {
          message: error.message,
          status: error.status,
          name: error.name,
          stack: error.stack
        });
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: `${error.message} (Status: ${error.status})`,
        });
      } else {
        console.log("[useSocialAuth] OAuth response data:", data);
        console.log("[useSocialAuth] Provider URL:", data?.url);
        
        if (data?.url) {
          const width = 600;
          const height = 800;
          const left = window.screenX + (window.outerWidth - width) / 2;
          const top = window.screenY + (window.outerHeight - height) / 2;
          
          window.open(
            data.url,
            'Login',
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
          );
        }
      }
    } catch (error) {
      console.error("[useSocialAuth] Unexpected error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to sign in. Please try again.",
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
