import type { Database } from '@/types/database';
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PostgrestError } from '@supabase/supabase-js';

export const useAuthNavigation = () => {
  const navigate = useNavigate();

  const checkAndNavigate = async (userId: string) => {
    try {
      console.log("[useAuthNavigation] Checking profile for user:", userId);
      
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', userId)
        .single();

      if (error) {
        const pgError = error as PostgrestError;
        console.error("[useAuthNavigation] Error fetching profile:", pgError);
        // If there's an error fetching the profile, we'll still navigate to dashboard
        // This prevents getting stuck on loading
        navigate('/dashboard');
        return;
      }

      console.log("[useAuthNavigation] Profile data:", profile);

      if (!profile || !profile.onboarding_completed) {
        console.log("[useAuthNavigation] Redirecting to onboarding");
        navigate('/onboarding');
      } else {
        console.log("[useAuthNavigation] Redirecting to dashboard");
        navigate('/dashboard');
      }
    } catch (err) {
      const error = err as Error;
      console.error("[useAuthNavigation] Unexpected error:", error);
      // Fallback to dashboard in case of any unexpected errors
      navigate('/dashboard');
    }
  };

  return {
    checkAndNavigate
  };
};
