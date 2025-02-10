
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export const useAuthNavigation = () => {
  const navigate = useNavigate();

  const checkAndNavigate = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', userId)
        .single();

      if (error) throw error;

      if (!profile || !profile.onboarding_completed) {
        navigate('/onboarding');
      } else {
        navigate('/dashboard');
      }
    } catch (error) {
      console.error("[useAuthNavigation] Profile check error:", error);
      navigate('/onboarding');
    }
  };

  return {
    checkAndNavigate
  };
};
