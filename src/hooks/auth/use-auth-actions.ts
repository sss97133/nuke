
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Provider } from "@supabase/supabase-js";
import { getRedirectBase } from "./use-auth-config";

export const useAuthActions = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSocialLogin = async (provider: Provider) => {
    try {
      const redirectTo = `${getRedirectBase()}/auth/callback`;
      
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

      if (error) throw error;
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
