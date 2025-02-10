
import { useState, useEffect } from "react";
import { Provider } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useSocialAuth = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Listen for the message from the popup
    const handleMessage = async (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'supabase:auth:callback') {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error("[useSocialAuth] Session error:", error);
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: error.message
          });
        } else if (session) {
          console.log("[useSocialAuth] Session established:", session);
          // The AuthCallback component will handle the redirection
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [toast]);

  const handleSocialLogin = async (provider: Provider) => {
    try {
      setIsLoading(true);
      console.log("[useSocialAuth] Starting OAuth flow with provider:", provider);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: true // Always skip for popup handling
        }
      });

      if (error) {
        console.error("[useSocialAuth] OAuth error:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: error.message
        });
      } else if (data?.url) {
        console.log("[useSocialAuth] Opening OAuth URL:", data.url);
        
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
    } catch (error) {
      console.error("[useSocialAuth] Unexpected error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to sign in. Please try again."
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

