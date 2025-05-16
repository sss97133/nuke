import type { Database } from '@/types/database';
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PostgrestError } from '@supabase/supabase-js';
import { toast } from '@/components/ui/use-toast';

// Vehicle-centric authentication navigation
// Following the principle that vehicles are first-class entities in our system
export const useAuthNavigation = () => {
  const navigate = useNavigate();

  const checkAndNavigate = async (userId: string) => {
    try {
      console.log("[useAuthNavigation] Checking for user:", userId);
      
      // Step 1: Check if user has a profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // Step 2: Check if user has any vehicles (core requirement for vehicle-centric app)
      const { data: vehicles, error: vehicleError } = await supabase
        .from('vehicles')
        .select('id')
        .eq('user_id', userId);
        
      console.log("[useAuthNavigation] Vehicles:", vehicles?.length || 0);
      
      // If there's no profile, create one
      if (profileError && profileError.code === 'PGRST116') {
        console.log("[useAuthNavigation] No profile found, creating one");
        
        try {
          const { error: insertError } = await supabase
            .from('profiles')
            .insert({ 
              id: userId,
              onboarding_completed: false,
              onboarding_step: 0 
            });
            
          if (insertError) {
            console.error("[useAuthNavigation] Error creating profile:", insertError);
          } else {
            console.log("[useAuthNavigation] Profile created successfully");
          }
        } catch (err) {
          console.error("[useAuthNavigation] Failed to create profile:", err);
        }
      }
      
      // VEHICLE-CENTRIC LOGIC: If user has no vehicles, send to vehicle setup
      // regardless of profile status
      if (!vehicles || vehicles.length === 0) {
        console.log("[useAuthNavigation] No vehicles found, sending to vehicle setup");
        navigate('/vehicle-setup');
        return;
      }
      
      // If we have vehicles and profile with completed onboarding
      if (profile?.onboarding_completed) {
        console.log("[useAuthNavigation] Profile complete, navigating to dashboard");
        navigate('/dashboard');
        return;
      }
      
      // If we have vehicles but onboarding is not complete
      console.log("[useAuthNavigation] Vehicles exist but onboarding not complete");
      navigate('/onboarding');
      
    } catch (err) {
      console.error("[useAuthNavigation] Unexpected error:", err);
      
      // EMERGENCY FALLBACK: Don't get stuck on loading
      toast({
        title: "Navigation Issue",
        description: "We encountered a problem. Taking you to the vehicle setup page.",
        variant: "destructive"
      });
      
      // Bypass to vehicle setup as emergency fallback 
      navigate('/vehicle-setup');
    }
  };

  return {
    checkAndNavigate
  };
};
