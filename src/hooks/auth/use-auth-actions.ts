
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";

export const useAuthActions = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSocialLogin = async (provider: Provider) => {
    try {
      console.log("[useAuthActions] Starting social login with provider:", provider);
      const redirectTo = `${window.location.origin}/auth/callback`;
      console.log("[useAuthActions] Using redirect URL:", redirectTo);
      
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
    } catch (error: any) {
      console.error("[useAuthActions] Social login error:", error);
      toast({
        variant: "destructive",
        title: "Login Error",
        description: "Could not complete social login. Please try again."
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
      
      navigate('/login');
    } catch (error: any) {
      console.error("[useAuthActions] Logout error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to log out. Please try again."
      });
    }
  };

  return {
    handleSocialLogin,
    handleLogout
  };
};
