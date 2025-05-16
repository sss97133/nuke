import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from '@/hooks/use-toast';
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
        .maybeSingle();

      if (error) {
        console.error("[useAuthNavigation] Error fetching profile:", error);
        toast({
          title: "Navigation Error",
          description: "There was an issue checking your profile status. Redirecting to dashboard.",
          variant: "destructive",
        });
        // If there's an error fetching the profile, we'll still navigate to dashboard
        // This prevents getting stuck on loading
        navigate('/dashboard');
        return;
      }

      console.log("[useAuthNavigation] Profile data:", profile);

      if (!profile || profile.onboarding_completed === false) {
        console.log("[useAuthNavigation] Redirecting to onboarding");
        navigate('/onboarding');
      } else {
        console.log("[useAuthNavigation] Redirecting to dashboard");
        navigate('/dashboard');
      }
    } catch (error) {
      const pgError = error as PostgrestError;
      console.error("[useAuthNavigation] Unexpected error:", pgError);
      toast({
        title: "Navigation Error",
        description: pgError.message || "An unexpected error occurred. Redirecting to dashboard.",
        variant: "destructive",
      });
      // Fallback to dashboard in case of any unexpected errors
      navigate('/dashboard');
    }
  };

  return {
    checkAndNavigate
  };
};
