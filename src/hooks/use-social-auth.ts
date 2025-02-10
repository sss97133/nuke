
import { useState, useEffect } from "react";
import { Provider } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

export const useSocialAuth = () => {
  // All hooks must be called before any conditional logic
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  // Event handler setup
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) {
        console.error("[useSocialAuth] Origin mismatch:", event.origin);
        return;
      }

      if (event.data?.type === 'supabase:auth:callback') {
        console.log("[useSocialAuth] Received callback message:", event.data);
        
        if (event.data.error) {
          console.error("[useSocialAuth] Error in callback:", event.data.error);
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: event.data.error.message || "Failed to authenticate"
          });
          return;
        }
        
        try {
          // Get the current session
          const { data: { session }, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error("[useSocialAuth] Session error:", error);
            toast({
              variant: "destructive",
              title: "Authentication Error",
              description: error.message
            });
            return;
          }

          if (!session) {
            console.error("[useSocialAuth] No session found after callback");
            toast({
              variant: "destructive",
              title: "Authentication Error",
              description: "Failed to establish session"
            });
            return;
          }

          console.log("[useSocialAuth] Session established:", session);
          
          // After successful auth, check if user has a profile
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .single();

          if (profileError) {
            console.error("[useSocialAuth] Profile error:", profileError);
          }

          // Only redirect to onboarding if no profile exists
          if (!profile?.username) {
            console.log("[useSocialAuth] No profile found, redirecting to onboarding");
            navigate('/onboarding');
          } else {
            console.log("[useSocialAuth] Profile found, redirecting to dashboard");
            navigate('/dashboard');
          }
        } catch (error) {
          console.error("[useSocialAuth] Error processing callback:", error);
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: "An unexpected error occurred"
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [toast, navigate]);

  const handleSocialLogin = async (provider: Provider) => {
    try {
      setIsLoading(true);
      console.log("[useSocialAuth] Starting OAuth flow with provider:", provider);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: true
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
      
      const width = 600;
      const height = 800;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const popup = window.open(
        data.url,
        'Login',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
      );

      if (!popup) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Pop-up was blocked. Please allow pop-ups for this site."
        });
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
