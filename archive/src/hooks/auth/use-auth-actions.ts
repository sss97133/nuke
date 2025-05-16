import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider, AuthError } from "@supabase/supabase-js";

export const useAuthActions = () => {
  const { toast } = useToast();

  const handleSocialLogin = async (provider: Provider) => {
    try {
      console.log("[useAuthActions] Starting social login with provider:", provider);
      const redirectTo = `${window.location.origin}/auth/callback`;
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        }
      });

      if (error) {
        console.error("[useAuthActions] Social login error:", error);
        throw error;
      }
      
      if (data?.url) {
        window.location.href = data.url;
      }
      
      return data;
    } catch (error) {
      const authError = error as AuthError;
      console.error("[useAuthActions] Social login error:", authError);
      toast({
        variant: "destructive",
        title: "Login Error",
        description: authError.message || "Could not complete social login. Please try again."
      });
    }
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      toast({
        title: "Logged Out",
        description: "You have been successfully logged out."
      });
      
      window.location.href = '/login';
    } catch (error) {
      const authError = error as AuthError;
      console.error("[useAuthActions] Logout error:", authError);
      toast({
        variant: "destructive",
        title: "Error",
        description: authError.message || "Failed to log out. Please try again."
      });
    }
  };

  return {
    handleSocialLogin,
    handleLogout
  };
};
